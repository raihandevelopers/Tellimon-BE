import express from 'express'
import BlockedContact from '../models/BlockedContact.js'
import { authRequired } from '../middleware/auth.js'
import { personalDataUserId, visibleUserIdFilter } from '../middleware/requireMaster.js'
import { isMaster } from '../utils/roles.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { normalizePhoneNumber, syncAsteriskConfig } from '../utils/syncAsterisk.js'

const router = express.Router()

router.use(authRequired)

router.get('/', async (req, res) => {
  try {
    const scope = await visibleUserIdFilter(req)
    const contacts = await BlockedContact.find(scope).sort({ createdAt: -1 })
    res.json(toJSONList(contacts))
  } catch (err) {
    console.error('List blocked contacts error:', err)
    res.status(500).json({ error: 'Failed to fetch blocked contacts' })
  }
})

router.post('/', async (req, res) => {
  try {
    const userId = personalDataUserId(req)
    const number = normalizePhoneNumber(req.body?.number)
    if (!number) {
      return res.status(400).json({ error: 'Number is required' })
    }

    const existing = await BlockedContact.findOne({ userId, number })
    if (existing) {
      return res.status(409).json({ error: 'Number already blocked' })
    }

    const contact = await BlockedContact.create({
      userId,
      number,
      status: 'Active',
    })

    await logActivity(userId, {
      action: 'contact_blocked',
      category: 'blocked',
      description: `Blocked ${contact.number}`,
    })

    // Only master block list is synced to Asterisk (live call blocking).
    const synced = isMaster(req.userRole) ? await syncAsteriskConfig() : false

    res.status(201).json({ ...toJSON(contact), asteriskSynced: synced })
  } catch (err) {
    console.error('Create blocked contact error:', err)
    res.status(500).json({ error: 'Failed to block contact' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const scope = await visibleUserIdFilter(req)
    const contact = await BlockedContact.findOneAndDelete({ _id: req.params.id, ...scope })
    if (!contact) return res.status(404).json({ error: 'Contact not found' })

    await logActivity(String(contact.userId), {
      action: 'contact_unblocked',
      category: 'blocked',
      description: `Unblocked ${contact.number}`,
    })

    const synced = isMaster(req.userRole) ? await syncAsteriskConfig() : false

    res.json({ success: true, asteriskSynced: synced })
  } catch (err) {
    console.error('Delete blocked contact error:', err)
    res.status(500).json({ error: 'Failed to remove blocked contact' })
  }
})

export default router
