import express from 'express'
import ActivityLog from '../models/ActivityLog.js'
import { authRequired } from '../middleware/auth.js'
import { personalDataUserId } from '../middleware/requireMaster.js'
import { toJSONList } from '../config/db.js'

const router = express.Router()

router.use(authRequired)

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10))
    const skip = (page - 1) * limit

    const filter = { userId: personalDataUserId(req) }
    if (req.query.category && req.query.category !== 'all') {
      filter.category = req.query.category
    }
    if (req.query.search?.trim()) {
      const q = req.query.search.trim()
      filter.$or = [
        { description: { $regex: q, $options: 'i' } },
        { action: { $regex: q, $options: 'i' } },
        { actorName: { $regex: q, $options: 'i' } },
      ]
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ActivityLog.countDocuments(filter),
    ])

    res.json({
      logs: toJSONList(logs),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (err) {
    console.error('Activity logs error:', err)
    res.status(500).json({ error: 'Failed to fetch activity logs' })
  }
})

export default router
