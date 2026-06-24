import express from 'express'
import DID from '../models/DID.js'
import CallRecord from '../models/CallRecord.js'
import Campaign from '../models/Campaign.js'
import Buyer from '../models/Buyer.js'
import User from '../models/User.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'

const router = express.Router()

router.use(authRequired)

function normalizeDidNumber(raw) {
  return String(raw || '').replace(/\D/g, '')
}

async function callsTodayForDid(userId, number) {
  const digits = normalizeDidNumber(number)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return CallRecord.countDocuments({
    userId,
    createdAt: { $gte: start },
    $or: [{ did: digits }, { did: number }, { did: `+${digits}` }],
  })
}

router.get('/', async (req, res) => {
  try {
    const dids = await DID.find({ userId: req.userId }).sort({ createdAt: -1 })
    const enriched = await Promise.all(
      dids.map(async (d) => {
        const json = toJSON(d)
        const campaign = d.campaignId
          ? await Campaign.findOne({ _id: d.campaignId, userId: req.userId })
          : null
        const buyer = d.buyerId
          ? await Buyer.findOne({ _id: d.buyerId, userId: req.userId })
          : null
        json.campaignName = campaign?.name || null
        json.buyerName = buyer?.name || null
        json.callsToday = await callsTodayForDid(req.userId, d.number)
        return json
      })
    )
    res.json(enriched)
  } catch (err) {
    console.error('List DIDs error:', err)
    res.status(500).json({ error: 'Failed to fetch DIDs' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { number, status, trunk, campaignId, buyerId } = req.body
    const normalized = normalizeDidNumber(number)
    if (!normalized) {
      return res.status(400).json({ error: 'DID number is required' })
    }

    if (campaignId) {
      const campaign = await Campaign.findOne({ _id: campaignId, userId: req.userId })
      if (!campaign) return res.status(400).json({ error: 'Campaign not found' })
    }
    if (buyerId) {
      const buyer = await Buyer.findOne({ _id: buyerId, userId: req.userId })
      if (!buyer) return res.status(400).json({ error: 'Buyer not found' })
    }

    const did = await DID.create({
      userId: req.userId,
      number: normalized,
      status: status || 'Active',
      trunk: trunk?.trim() || '8138073157',
      campaignId: campaignId || undefined,
      buyerId: buyerId || undefined,
    })

    const user = await User.findById(req.userId)
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_created',
      category: 'did',
      description: `DID ${normalized} added`,
    })

    res.status(201).json(toJSON(did))
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'DID already exists' })
    }
    console.error('Create DID error:', err)
    res.status(500).json({ error: 'Failed to create DID' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const { status, trunk, campaignId, buyerId } = req.body
    const did = await DID.findOne({ _id: req.params.id, userId: req.userId })
    if (!did) return res.status(404).json({ error: 'DID not found' })

    if (campaignId !== undefined) {
      if (campaignId) {
        const campaign = await Campaign.findOne({ _id: campaignId, userId: req.userId })
        if (!campaign) return res.status(400).json({ error: 'Campaign not found' })
        did.campaignId = campaignId
      } else {
        did.campaignId = undefined
      }
    }
    if (buyerId !== undefined) {
      if (buyerId) {
        const buyer = await Buyer.findOne({ _id: buyerId, userId: req.userId })
        if (!buyer) return res.status(400).json({ error: 'Buyer not found' })
        did.buyerId = buyerId
      } else {
        did.buyerId = undefined
      }
    }
    if (status) did.status = status
    if (trunk !== undefined) did.trunk = trunk

    await did.save()

    const user = await User.findById(req.userId)
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_updated',
      category: 'did',
      description: `DID ${did.number} updated`,
    })

    res.json(toJSON(did))
  } catch (err) {
    console.error('Update DID error:', err)
    res.status(500).json({ error: 'Failed to update DID' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const did = await DID.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!did) return res.status(404).json({ error: 'DID not found' })

    const user = await User.findById(req.userId)
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_deleted',
      category: 'did',
      description: `DID ${did.number} removed`,
    })

    res.json({ success: true })
  } catch (err) {
    console.error('Delete DID error:', err)
    res.status(500).json({ error: 'Failed to delete DID' })
  }
})

export default router
