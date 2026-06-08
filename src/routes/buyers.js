import express from 'express'
import Buyer from '../models/Buyer.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'

const router = express.Router()

router.use(authRequired)

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

    res.status(201).json(toJSON(buyer))
  } catch (err) {
    console.error('Create buyer error:', err)
    res.status(500).json({ error: 'Failed to create buyer' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const buyer = await Buyer.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!buyer) return res.status(404).json({ error: 'Buyer not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete buyer error:', err)
    res.status(500).json({ error: 'Failed to delete buyer' })
  }
})

export default router
