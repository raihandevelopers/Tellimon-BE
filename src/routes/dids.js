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
import {
  loadCustomerDidDisplayMap,
  maskCallForCustomer,
  sanitizeDidJsonForCustomer,
  sanitizeDidJsonForMaster,
} from '../utils/customerDidDisplay.js'
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
        const routingOwnerIds = [req.userId]
        if (d.assignedCustomerId) routingOwnerIds.push(d.assignedCustomerId)
        const campaign = d.campaignId
          ? await Campaign.findOne({ _id: d.campaignId, userId: { $in: routingOwnerIds } })
          : null
        const buyer = d.buyerId
          ? await Buyer.findOne({ _id: d.buyerId, userId: { $in: routingOwnerIds } })
          : null
        const customer = d.assignedCustomerId
          ? await User.findById(d.assignedCustomerId).select('name email')
          : null
        json.campaignName = campaign?.name || null
        json.buyerName = buyer?.name || null
        json.customerName = customer?.name || null
        json.customerEmail = customer?.email || null
        json.callsToday = await callsTodayForDid(req.userId, d.number)
        if (isMaster(req.userRole)) {
          return sanitizeDidJsonForMaster(json)
        }
        return sanitizeDidJsonForCustomer(json)
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
    const { number, status, trunk, campaignId, buyerId, isMain, assignedCustomerId, customerDisplayNumber } =
      req.body
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

    // Assigned customer DIDs start without master campaign/buyer — customer attaches their own.
    const useCustomerRouting = Boolean(assignedCustomer) && !isMainDid

    const did = await DID.create({
      userId: req.userId,
      number: normalized,
      status: status || 'Active',
      trunk: trunk?.trim() || '8138073157',
      campaignId: useCustomerRouting ? undefined : campaignId || undefined,
      buyerId: useCustomerRouting ? undefined : buyerId || undefined,
      isMain: isMainDid,
      assignedCustomerId: isMainDid ? undefined : assignedCustomer?._id,
      customerDisplayNumber:
        !isMainDid && assignedCustomer && customerDisplayNumber
          ? String(customerDisplayNumber).trim()
          : '',
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
    const { status, trunk, campaignId, buyerId, isMain, assignedCustomerId, customerDisplayNumber } =
      req.body
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
      if (did.isMain) {
        did.assignedCustomerId = undefined
        did.customerDisplayNumber = ''
      }
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
        const wasSame =
          did.assignedCustomerId && String(did.assignedCustomerId) === String(customer._id)
        did.assignedCustomerId = customer._id
        // New customer assignment: clear master routing so the customer uses their own campaigns/buyers.
        if (!wasSame) {
          did.campaignId = undefined
          did.buyerId = undefined
        }
      } else {
        did.assignedCustomerId = undefined
        did.customerDisplayNumber = ''
      }
    }
    if (customerDisplayNumber !== undefined) {
      did.customerDisplayNumber = String(customerDisplayNumber || '').trim()
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

async function findCustomerAssignedDid(req) {
  return DID.findOne({
    _id: req.params.id,
    userId: req.userId,
    assignedCustomerId: req.authUserId,
    isMain: { $ne: true },
  })
}

async function customerDidResponse(did, authUserId) {
  const json = toJSON(did)
  const campaign = did.campaignId
    ? await Campaign.findOne({ _id: did.campaignId, userId: authUserId })
    : null
  json.campaignName = campaign?.name || null
  return sanitizeDidJsonForCustomer(json)
}

/** Customer: campaign/buyer + activate/deactivate on an assigned DID. */
router.put('/:id/my-routing', async (req, res) => {
  try {
    if (isMaster(req.userRole)) {
      return res.status(400).json({ error: 'Masters should update DIDs via DID management' })
    }

    const { campaignId, buyerId, status } = req.body
    const did = await findCustomerAssignedDid(req)
    if (!did) return res.status(404).json({ error: 'Assigned DID not found' })

    if (status !== undefined) {
      const next = String(status)
      if (next !== 'Active' && next !== 'Inactive') {
        return res.status(400).json({ error: 'Status must be Active or Inactive' })
      }
      did.status = next
    }
    if (campaignId !== undefined) {
      if (campaignId) {
        const campaign = await Campaign.findOne({ _id: campaignId, userId: req.authUserId })
        if (!campaign) return res.status(400).json({ error: 'Campaign not found' })
        did.campaignId = campaignId
      } else {
        did.campaignId = undefined
      }
    }
    if (buyerId !== undefined) {
      if (buyerId) {
        const buyer = await Buyer.findOne({ _id: buyerId, userId: req.authUserId })
        if (!buyer) return res.status(400).json({ error: 'Buyer not found' })
        did.buyerId = buyerId
      } else {
        did.buyerId = undefined
      }
    }

    await did.save()

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId: req.authUserId,
      actorName: user?.name,
      action: status !== undefined ? 'did_status_updated' : 'did_routing_updated',
      category: 'did',
      description:
        status !== undefined
          ? `Assigned DID set to ${did.status}`
          : `Routing updated for assigned DID`,
    })

    await syncAsteriskConfig()

    res.json(await customerDidResponse(did, req.authUserId))
  } catch (err) {
    console.error('Customer DID routing error:', err)
    res.status(500).json({ error: 'Failed to update DID routing' })
  }
})

/** Customer delete: unassign DID back to admin pool (not assigned to anyone). */
router.delete('/:id/my-assignment', async (req, res) => {
  try {
    if (isMaster(req.userRole)) {
      return res.status(400).json({ error: 'Masters should delete DIDs via DID management' })
    }

    const did = await findCustomerAssignedDid(req)
    if (!did) return res.status(404).json({ error: 'Assigned DID not found' })

    const display = String(did.customerDisplayNumber || did.number || '').trim()
    did.assignedCustomerId = undefined
    did.customerDisplayNumber = ''
    did.campaignId = undefined
    did.buyerId = undefined
    did.status = 'Active'
    await did.save()

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId: req.authUserId,
      actorName: user?.name,
      action: 'did_unassigned',
      category: 'did',
      description: `Customer released assigned DID ${display}`,
    })
    await logActivity({
      userId: req.userId,
      actorName: user?.name,
      action: 'did_unassigned',
      category: 'did',
      description: `DID ${did.number} returned to unassigned pool`,
    })

    await syncAsteriskConfig()

    res.json({ success: true })
  } catch (err) {
    console.error('Customer DID unassign error:', err)
    res.status(500).json({ error: 'Failed to release assigned DID' })
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
