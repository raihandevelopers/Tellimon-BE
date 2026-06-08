import express from 'express'
import Campaign from '../models/Campaign.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'

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
    const { name, strategy, duplicateHandling, active } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' })
    }

    const campaign = await Campaign.create({
      userId: req.userId,
      name: name.trim(),
      strategy: strategy || 'Sticky',
      duplicateHandling: duplicateHandling || 'Normal',
      active: active !== false,
    })

    res.status(201).json(toJSON(campaign))
  } catch (err) {
    console.error('Create campaign error:', err)
    res.status(500).json({ error: 'Failed to create campaign' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete campaign error:', err)
    res.status(500).json({ error: 'Failed to delete campaign' })
  }
})

export default router
