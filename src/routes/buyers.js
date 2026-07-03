import express from 'express'
import mongoose from 'mongoose'
import Buyer from '../models/Buyer.js'
import CallRecord from '../models/CallRecord.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { customerCallFilter } from '../utils/roles.js'
import { buildCallDateFilter } from '../utils/callFilters.js'

const router = express.Router()

router.use(authRequired)

function buyerNumberKeys(number) {
  const digits = String(number || '').replace(/\D/g, '')
  if (!digits) return []
  const keys = new Set([digits])
  if (digits.length === 11 && digits.startsWith('1')) keys.add(digits.slice(1))
  return [...keys]
}

function formatTalkTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${String(r).padStart(2, '0')}`
}

router.get('/reports', async (req, res) => {
  try {
    const { from, to } = req.query
    const userId = req.userId
    const customerFilter = await customerCallFilter(userId, req.userRole, req.authUserId)
    const dateFilter = buildCallDateFilter({ from, to })

    const match = {
      userId: new mongoose.Types.ObjectId(userId),
      ...customerFilter,
    }
    if (dateFilter.$expr) match.$expr = dateFilter.$expr

    const [buyers, grouped] = await Promise.all([
      Buyer.find({ userId }).sort({ priority: 1, name: 1, createdAt: -1 }),
      CallRecord.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              buyerId: '$buyerId',
              buyerNumber: '$buyerNumber',
            },
            totalCalls: { $sum: 1 },
            answered: { $sum: { $cond: [{ $eq: ['$status', 'answered'] }, 1, 0] } },
            missed: {
              $sum: {
                $cond: [{ $in: ['$status', ['missed', 'no-answer', 'busy', 'failed']] }, 1, 0],
              },
            },
            talkTimeSec: { $sum: { $ifNull: ['$billsec', 0] } },
          },
        },
      ]),
    ])

    const statsByKey = new Map()
    for (const row of grouped) {
      const stats = {
        totalCalls: row.totalCalls,
        answered: row.answered,
        missed: row.missed,
        talkTimeSec: row.talkTimeSec,
      }
      if (row._id.buyerId) {
        statsByKey.set(String(row._id.buyerId), stats)
      }
      for (const key of buyerNumberKeys(row._id.buyerNumber)) {
        if (!statsByKey.has(key)) statsByKey.set(key, stats)
      }
    }

    const reports = buyers.map((buyer) => {
      const idKey = String(buyer._id)
      let row = statsByKey.get(idKey)
      if (!row) {
        for (const key of buyerNumberKeys(buyer.number)) {
          if (statsByKey.has(key)) {
            row = statsByKey.get(key)
            break
          }
        }
      }

      const talkTimeSec = row?.talkTimeSec || 0
      return {
        buyerId: idKey,
        name: buyer.name,
        number: buyer.number,
        status: buyer.status,
        totalCalls: row?.totalCalls || 0,
        answered: row?.answered || 0,
        missed: row?.missed || 0,
        talkTimeSec,
        talkTimeFormatted: formatTalkTime(talkTimeSec),
      }
    })

    res.json({
      reports,
      from: from || null,
      to: to || null,
      totalCalls: reports.reduce((sum, r) => sum + r.totalCalls, 0),
    })
  } catch (err) {
    console.error('Buyer reports error:', err)
    res.status(500).json({ error: 'Failed to fetch buyer reports' })
  }
})

router.get('/', async (req, res) => {
  try {
    const buyers = await Buyer.find({ userId: req.userId }).sort({ createdAt: -1 })
    res.json(toJSONList(buyers))
  } catch (err) {
    console.error('List buyers error:', err)
    res.status(500).json({ error: 'Failed to fetch buyers' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, number, dailyCap, priority, ringTimeout, concurrentCalls, status } = req.body
    if (!number?.trim()) {
      return res.status(400).json({ error: 'Buyer number is required' })
    }

    const buyer = await Buyer.create({
      userId: req.userId,
      name: name?.trim() || '',
      number: number.trim(),
      dailyCap: dailyCap ?? 0,
      priority: priority ?? 1,
      ringTimeout: ringTimeout || 60,
      concurrentCalls: concurrentCalls ?? 1,
      status: status || 'Active',
    })

    await logActivity(req.userId, {
      action: 'buyer_created',
      category: 'buyer',
      description: `Buyer ${buyer.name || buyer.number} created`,
    })

    res.status(201).json(toJSON(buyer))
  } catch (err) {
    console.error('Create buyer error:', err)
    res.status(500).json({ error: 'Failed to create buyer' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const buyer = await Buyer.findOne({ _id: req.params.id, userId: req.userId })
    if (!buyer) return res.status(404).json({ error: 'Buyer not found' })

    const fields = ['name', 'number', 'dailyCap', 'priority', 'ringTimeout', 'concurrentCalls', 'status']
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        buyer[field] = field === 'name' ? String(req.body[field]).trim() : req.body[field]
      }
    }
    if (req.body.number) buyer.number = req.body.number.trim()

    await buyer.save()

    await logActivity(req.userId, {
      action: 'buyer_updated',
      category: 'buyer',
      description: `Buyer ${buyer.name || buyer.number} updated`,
    })

    res.json(toJSON(buyer))
  } catch (err) {
    console.error('Update buyer error:', err)
    res.status(500).json({ error: 'Failed to update buyer' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const buyer = await Buyer.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!buyer) return res.status(404).json({ error: 'Buyer not found' })

    await logActivity(req.userId, {
      action: 'buyer_deleted',
      category: 'buyer',
      description: `Buyer ${buyer.name || buyer.number} deleted`,
    })

    res.json({ success: true })
  } catch (err) {
    console.error('Delete buyer error:', err)
    res.status(500).json({ error: 'Failed to delete buyer' })
  }
})

export default router
