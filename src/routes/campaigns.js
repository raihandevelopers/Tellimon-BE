import express from 'express'
import Campaign from '../models/Campaign.js'
import Buyer from '../models/Buyer.js'
import User from '../models/User.js'
import { authRequired } from '../middleware/auth.js'
import {
  personalDataUserId,
  tenantDataUserIds,
  visibleUserIdFilter,
} from '../middleware/requireMaster.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'

const router = express.Router()

router.use(authRequired)

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Campaign names must be unique across the whole tenant (case-insensitive). */
async function assertUniqueCampaignName(req, name, excludeId = null) {
  const trimmed = String(name || '').trim()
  if (!trimmed) {
    const err = new Error('Campaign name is required')
    err.status = 400
    throw err
  }

  const ownerIds = await tenantDataUserIds(req)
  const filter = {
    userId: { $in: ownerIds },
    name: { $regex: `^${escapeRegex(trimmed)}$`, $options: 'i' },
  }
  if (excludeId) filter._id = { $ne: excludeId }

  const existing = await Campaign.findOne(filter).select('_id name').lean()
  if (existing) {
    const err = new Error('Campaign name already exists. Please choose a unique name.')
    err.status = 409
    throw err
  }
  return trimmed
}

/** 1st in list = highest priority number for routing. */
async function applyBuyerPriorityOrder(userId, buyerIds = []) {
  const ids = [...new Set(buyerIds.map(String))].filter(Boolean)
  await Promise.all(
    ids.map((id, index) =>
      Buyer.updateOne({ _id: id, userId }, { $set: { priority: ids.length - index } })
    )
  )
}

router.get('/', async (req, res) => {
  try {
    const scope = await visibleUserIdFilter(req)
    const campaigns = await Campaign.find(scope).sort({ createdAt: -1 })
    res.json(toJSONList(campaigns))
  } catch (err) {
    console.error('List campaigns error:', err)
    res.status(500).json({ error: 'Failed to fetch campaigns' })
  }
})

router.post('/', async (req, res) => {
  try {
    const userId = personalDataUserId(req)
    const { name, strategy, duplicateHandling, active, buyerIds } = req.body
    const uniqueName = await assertUniqueCampaignName(req, name)

    const requestedBuyerIds = Array.isArray(buyerIds) ? buyerIds.map(String) : []
    const ownedBuyers = requestedBuyerIds.length
      ? await Buyer.find({ _id: { $in: requestedBuyerIds }, userId }).select('_id')
      : []
    const ownedSet = new Set(ownedBuyers.map((b) => String(b._id)))
    const orderedBuyerIds = requestedBuyerIds.filter((id) => ownedSet.has(id))

    const campaign = await Campaign.create({
      userId,
      name: uniqueName,
      strategy: strategy || 'Sticky',
      duplicateHandling: duplicateHandling || 'Normal',
      active: active !== false,
      buyerIds: orderedBuyerIds,
    })

    if (orderedBuyerIds.length) {
      await applyBuyerPriorityOrder(userId, orderedBuyerIds)
    }

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId,
      actorName: user?.name,
      action: 'campaign_created',
      category: 'campaign',
      description: `Created campaign "${uniqueName}"`,
      metadata: { campaignId: campaign._id, strategy },
    })

    res.status(201).json(toJSON(campaign))
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('Create campaign error:', err)
    res.status(500).json({ error: 'Failed to create campaign' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const scope = await visibleUserIdFilter(req)
    const campaign = await Campaign.findOne({ _id: req.params.id, ...scope })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    const ownerUserId = String(campaign.userId)
    if (req.body.name !== undefined) {
      campaign.name = await assertUniqueCampaignName(req, req.body.name, campaign._id)
    }
    const fields = ['strategy', 'duplicateHandling', 'active']
    for (const field of fields) {
      if (req.body[field] !== undefined) campaign[field] = req.body[field]
    }
    if (req.body.buyerIds !== undefined) {
      const requestedBuyerIds = Array.isArray(req.body.buyerIds)
        ? req.body.buyerIds.map(String)
        : []
      const ownedBuyers = requestedBuyerIds.length
        ? await Buyer.find({ _id: { $in: requestedBuyerIds }, userId: ownerUserId }).select('_id')
        : []
      const ownedSet = new Set(ownedBuyers.map((b) => String(b._id)))
      campaign.buyerIds = requestedBuyerIds.filter((id) => ownedSet.has(id))
      if (campaign.buyerIds.length) {
        await applyBuyerPriorityOrder(ownerUserId, campaign.buyerIds)
      }
    }

    await campaign.save()

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId: ownerUserId,
      actorName: user?.name,
      action: 'campaign_updated',
      category: 'campaign',
      description: `Updated campaign "${campaign.name}"`,
    })

    res.json(toJSON(campaign))
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('Update campaign error:', err)
    res.status(500).json({ error: 'Failed to update campaign' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const scope = await visibleUserIdFilter(req)
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, ...scope })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId: String(campaign.userId),
      actorName: user?.name,
      action: 'campaign_deleted',
      category: 'campaign',
      description: `Deleted campaign "${campaign.name}"`,
    })

    res.json({ success: true })
  } catch (err) {
    console.error('Delete campaign error:', err)
    res.status(500).json({ error: 'Failed to delete campaign' })
  }
})

export default router
