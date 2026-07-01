import express from 'express'
import DID from '../models/DID.js'
import CallRecord from '../models/CallRecord.js'
import Campaign from '../models/Campaign.js'
import Buyer from '../models/Buyer.js'
import User from '../models/User.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { isMaster, normalizeDidNumber, customerDidQuery } from '../utils/roles.js'
import { syncAsteriskConfig } from '../utils/syncAsterisk.js'

const router = express.Router()

router.use(authRequired)

function requireMaster(req, res, next) {
  if (!isMaster(req.userRole)) {
    return res.status(403).json({ error: 'DID management is only available to master accounts' })
  }
  next()
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

function assertCanAccessMainDid(req, did) {
  return !(did.isMain && !isMaster(req.userRole))
}

async function validateAssignedCustomer(req, customerId) {
  if (!customerId) return null
  const customer = await User.findOne({
    _id: customerId,
    role: 'customer',
    ownerId: req.authUserId,
  })
  if (!customer) throw new Error('INVALID_CUSTOMER')
  return customer
}

router.get('/', async (req, res) => {
  try {
    const dids = await DID.find({
      userId: req.userId,
      ...customerDidQuery(req.userRole, req.authUserId),
    }).sort({ createdAt: -1 })

    const enriched = await Promise.all(
      dids.map(async (d) => {
        const json = toJSON(d)
        const campaign = d.campaignId
          ? await Campaign.findOne({ _id: d.campaignId, userId: req.userId })
          : null
        const buyer = d.buyerId
          ? await Buyer.findOne({ _id: d.buyerId, userId: req.userId })
          : null
        const customer = d.assignedCustomerId
          ? await User.findById(d.assignedCustomerId).select('name email')
          : null
        json.campaignName = campaign?.name || null
        json.buyerName = buyer?.name || null
        json.customerName = customer?.name || null
        json.customerEmail = customer?.email || null
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

router.post('/', requireMaster, async (req, res) => {
  try {
    const { number, status, trunk, campaignId, buyerId, isMain, assignedCustomerId } = req.body
    const normalized = normalizeDidNumber(number)
    if (!normalized) {
      return res.status(400).json({ error: 'DID number is required' })
    }

    if (isMain && !isMaster(req.userRole)) {
      return res.status(403).json({ error: 'Only master accounts can mark a DID as main' })
    }

    if (campaignId) {
      const campaign = await Campaign.findOne({ _id: campaignId, userId: req.userId })
      if (!campaign) return res.status(400).json({ error: 'Campaign not found' })
    }
    if (buyerId) {
      const buyer = await Buyer.findOne({ _id: buyerId, userId: req.userId })
      if (!buyer) return res.status(400).json({ error: 'Buyer not found' })
    }

    let assignedCustomer = null
    if (assignedCustomerId) {
      assignedCustomer = await validateAssignedCustomer(req, assignedCustomerId)
    }

    const isMainDid = Boolean(isMain) && isMaster(req.userRole)

    const did = await DID.create({
      userId: req.userId,
      number: normalized,
      status: status || 'Active',
      trunk: trunk?.trim() || '8138073157',
      campaignId: campaignId || undefined,
      buyerId: buyerId || undefined,
      isMain: isMainDid,
      assignedCustomerId: isMainDid ? undefined : assignedCustomer?._id,
    })

    const user = await User.findById(req.authUserId || req.userId)
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_created',
      category: 'did',
      description: `DID ${normalized} added`,
    })

    await syncAsteriskConfig()

    res.status(201).json(toJSON(did))
  } catch (err) {
    if (err.message === 'INVALID_CUSTOMER') {
      return res.status(400).json({ error: 'Customer not found' })
    }
    if (err.code === 11000) {
      return res.status(409).json({ error: 'DID already exists' })
    }
    console.error('Create DID error:', err)
    res.status(500).json({ error: 'Failed to create DID' })
  }
})

router.put('/:id', requireMaster, async (req, res) => {
  try {
    const { status, trunk, campaignId, buyerId, isMain, assignedCustomerId } = req.body
    const did = await DID.findOne({ _id: req.params.id, userId: req.userId })
    if (!did) return res.status(404).json({ error: 'DID not found' })
    if (!assertCanAccessMainDid(req, did)) {
      return res.status(403).json({ error: 'Main DIDs are only visible to master accounts' })
    }

    if (isMain !== undefined) {
      if (!isMaster(req.userRole)) {
        return res.status(403).json({ error: 'Only master accounts can change main DID status' })
      }
      did.isMain = Boolean(isMain)
      if (did.isMain) did.assignedCustomerId = undefined
    }

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
    if (assignedCustomerId !== undefined) {
      if (assignedCustomerId) {
        const customer = await validateAssignedCustomer(req, assignedCustomerId)
        did.assignedCustomerId = customer._id
      } else {
        did.assignedCustomerId = undefined
      }
    }
    if (status) did.status = status
    if (trunk !== undefined) did.trunk = trunk

    await did.save()

    const user = await User.findById(req.authUserId || req.userId)
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_updated',
      category: 'did',
      description: `DID ${did.number} updated`,
    })

    await syncAsteriskConfig()

    res.json(toJSON(did))
  } catch (err) {
    if (err.message === 'INVALID_CUSTOMER') {
      return res.status(400).json({ error: 'Customer not found' })
    }
    console.error('Update DID error:', err)
    res.status(500).json({ error: 'Failed to update DID' })
  }
})

router.delete('/:id', requireMaster, async (req, res) => {
  try {
    const did = await DID.findOne({ _id: req.params.id, userId: req.userId })
    if (!did) return res.status(404).json({ error: 'DID not found' })
    if (!assertCanAccessMainDid(req, did)) {
      return res.status(403).json({ error: 'Main DIDs are only visible to master accounts' })
    }

    await DID.findOneAndDelete({ _id: req.params.id, userId: req.userId })

    const user = await User.findById(req.authUserId || req.userId)
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_deleted',
      category: 'did',
      description: `DID ${did.number} removed`,
    })

    await syncAsteriskConfig()

    res.json({ success: true })
  } catch (err) {
    console.error('Delete DID error:', err)
    res.status(500).json({ error: 'Failed to delete DID' })
  }
})

export default router
