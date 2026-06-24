import express from 'express'
import Campaign from '../models/Campaign.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import User from '../models/User.js'
import { logActivity } from '../utils/logActivity.js'

const router = express.Router()

router.use(authRequired)

router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.userId }).sort({ createdAt: -1 })
    res.json(toJSONList(campaigns))
  } catch (err) {
    console.error('List campaigns error:', err)
    res.status(500).json({ error: 'Failed to fetch campaigns' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, strategy, duplicateHandling, active, buyerIds } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' })
    }

    const campaign = await Campaign.create({
      userId: req.userId,
      name: name.trim(),
      strategy: strategy || 'Sticky',
      duplicateHandling: duplicateHandling || 'Normal',
      active: active !== false,
      buyerIds: Array.isArray(buyerIds) ? buyerIds : [],
    })

    const user = await User.findById(req.userId)
    await logActivity({
      userId: req.userId,
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
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    const fields = ['name', 'strategy', 'duplicateHandling', 'active']
    for (const field of fields) {
      if (req.body[field] !== undefined) campaign[field] = req.body[field]
    }
    if (req.body.buyerIds !== undefined) {
      campaign.buyerIds = Array.isArray(req.body.buyerIds) ? req.body.buyerIds : []
    }
    if (req.body.name) campaign.name = req.body.name.trim()

    await campaign.save()

    const user = await User.findById(req.userId)
    await logActivity({
      userId: req.userId,
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
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    const user = await User.findById(req.userId)
    await logActivity({
      userId: req.userId,
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
