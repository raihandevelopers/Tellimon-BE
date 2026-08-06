import express from 'express'
import Campaign from '../models/Campaign.js'
import Buyer from '../models/Buyer.js'
import User from '../models/User.js'
import { authRequired } from '../middleware/auth.js'
import { personalDataUserId } from '../middleware/requireMaster.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'

const router = express.Router()

router.use(authRequired)

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
    const userId = personalDataUserId(req)
    const campaigns = await Campaign.find({ userId }).sort({ createdAt: -1 })
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
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' })
    }

    const orderedBuyerIds = Array.isArray(buyerIds) ? buyerIds : []

    const campaign = await Campaign.create({
      userId,
      name: name.trim(),
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
      description: `Created campaign "${name.trim()}"`,
      metadata: { campaignId: campaign._id, strategy },
    })

    res.status(201).json(toJSON(campaign))
  } catch (err) {
    console.error('Create campaign error:', err)
    res.status(500).json({ error: 'Failed to create campaign' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const userId = personalDataUserId(req)
    const campaign = await Campaign.findOne({ _id: req.params.id, userId })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    const fields = ['name', 'strategy', 'duplicateHandling', 'active']
    for (const field of fields) {
      if (req.body[field] !== undefined) campaign[field] = req.body[field]
    }
    if (req.body.buyerIds !== undefined) {
      campaign.buyerIds = Array.isArray(req.body.buyerIds) ? req.body.buyerIds : []
      if (campaign.buyerIds.length) {
        await applyBuyerPriorityOrder(userId, campaign.buyerIds)
      }
    }
    if (req.body.name) campaign.name = req.body.name.trim()

    await campaign.save()

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId,
      actorName: user?.name,
      action: 'campaign_updated',
      category: 'campaign',
      description: `Updated campaign "${campaign.name}"`,
    })

    res.json(toJSON(campaign))
  } catch (err) {
    console.error('Update campaign error:', err)
    res.status(500).json({ error: 'Failed to update campaign' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const userId = personalDataUserId(req)
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, userId })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    const user = await User.findById(req.authUserId)
    await logActivity({
      userId,
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
