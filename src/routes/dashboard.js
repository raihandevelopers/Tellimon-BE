import express from 'express'
import Campaign from '../models/Campaign.js'
import Target from '../models/Target.js'
import BlockedContact from '../models/BlockedContact.js'
import CallRecord from '../models/CallRecord.js'
import { authRequired } from '../middleware/auth.js'

const router = express.Router()

router.use(authRequired)

router.get('/stats', async (req, res) => {
  try {
    const userId = req.userId
    const [campaigns, targets, blocked, totalCalls, answered, missed] = await Promise.all([
      Campaign.countDocuments({ userId }),
      Target.countDocuments({ userId }),
      BlockedContact.countDocuments({ userId }),
      CallRecord.countDocuments({ userId }),
      CallRecord.countDocuments({ userId, status: 'answered' }),
      CallRecord.countDocuments({ userId, status: { $in: ['missed', 'no-answer', 'busy'] } }),
    ])

    res.json({
      campaigns,
      targets,
      blocked,
      totalCalls,
      answered,
      missed,
    })
  } catch (err) {
    console.error('Dashboard stats error:', err)
    res.status(500).json({ error: 'Failed to fetch dashboard stats' })
  }
})

export default router
