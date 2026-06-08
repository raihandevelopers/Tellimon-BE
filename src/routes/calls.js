import express from 'express'
import mongoose from 'mongoose'
import CallRecord from '../models/CallRecord.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'

const router = express.Router()

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

router.get('/', authRequired, async (req, res) => {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query
    const filter = { userId: req.userId }

    if (status) filter.status = status
    if (from || to) {
      filter.createdAt = {}
      if (from) filter.createdAt.$gte = new Date(from)
      if (to) filter.createdAt.$lte = new Date(to)
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit)
    const [calls, total] = await Promise.all([
      CallRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      CallRecord.countDocuments(filter),
    ])

    res.json({
      calls: toJSONList(calls).map((c) => ({ ...c, durationFormatted: formatDuration(c.billsec || c.duration) })),
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    })
  } catch (err) {
    console.error('List calls error:', err)
    res.status(500).json({ error: 'Failed to fetch call reports' })
  }
})

router.get('/stats', authRequired, async (req, res) => {
  try {
    const userId = req.userId
    const [totalCalls, answered, missed, agg] = await Promise.all([
      CallRecord.countDocuments({ userId }),
      CallRecord.countDocuments({ userId, status: 'answered' }),
      CallRecord.countDocuments({ userId, status: { $in: ['missed', 'no-answer', 'busy'] } }),
      CallRecord.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, totalSeconds: { $sum: '$billsec' } } },
      ]),
    ])

    res.json({
      totalCalls,
      answered,
      missed,
      totalTalkTime: agg[0]?.totalSeconds || 0,
    })
  } catch (err) {
    console.error('Call stats error:', err)
    res.status(500).json({ error: 'Failed to fetch call stats' })
  }
})

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.ASTERISK_WEBHOOK_SECRET
    if (secret && req.headers['x-asterisk-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const {
      userId,
      caller,
      did,
      buyerId,
      buyerNumber,
      campaignId,
      status,
      duration,
      billsec,
      recordingUrl,
      recordingPath,
      uniqueId,
      startedAt,
      endedAt,
    } = req.body

    if (!userId || !caller) {
      return res.status(400).json({ error: 'userId and caller are required' })
    }

    if (uniqueId) {
      const existing = await CallRecord.findOne({ uniqueId })
      if (existing) {
        return res.json({ call: toJSON(existing), duplicate: true })
      }
    }

    const call = await CallRecord.create({
      userId,
      caller,
      did: did || '',
      buyerId: buyerId || undefined,
      buyerNumber: buyerNumber || '',
      campaignId: campaignId || undefined,
      status: status || 'missed',
      duration: duration ?? 0,
      billsec: billsec ?? duration ?? 0,
      recordingUrl: recordingUrl || '',
      recordingPath: recordingPath || '',
      uniqueId: uniqueId || '',
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      endedAt: endedAt ? new Date(endedAt) : new Date(),
    })

    res.status(201).json({ call: toJSON(call) })
  } catch (err) {
    console.error('Call webhook error:', err)
    res.status(500).json({ error: 'Failed to save call record' })
  }
})

export default router
