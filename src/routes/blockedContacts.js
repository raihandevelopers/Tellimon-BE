import express from 'express'
import BlockedContact from '../models/BlockedContact.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'

const router = express.Router()

router.use(authRequired)

router.get('/', async (req, res) => {
  try {
    const contacts = await BlockedContact.find({ userId: req.userId }).sort({ createdAt: -1 })
    res.json(toJSONList(contacts))
  } catch (err) {
    console.error('List blocked contacts error:', err)
    res.status(500).json({ error: 'Failed to fetch blocked contacts' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { number } = req.body
    if (!number?.trim()) {
      return res.status(400).json({ error: 'Number is required' })
    }

    const existing = await BlockedContact.findOne({ userId: req.userId, number: number.trim() })
    if (existing) {
      return res.status(409).json({ error: 'Number already blocked' })
    }

    const contact = await BlockedContact.create({
      userId: req.userId,
      number: number.trim(),
      status: 'Active',
    })

    res.status(201).json(toJSON(contact))
  } catch (err) {
    console.error('Create blocked contact error:', err)
    res.status(500).json({ error: 'Failed to block contact' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const contact = await BlockedContact.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!contact) return res.status(404).json({ error: 'Contact not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete blocked contact error:', err)
    res.status(500).json({ error: 'Failed to remove blocked contact' })
  }
})

export default router
