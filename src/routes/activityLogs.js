import express from 'express'
import ActivityLog from '../models/ActivityLog.js'
import { authRequired } from '../middleware/auth.js'
import { toJSONList } from '../config/db.js'

const router = express.Router()

router.use(authRequired)

router.get('/', async (req, res) => {
  try {
    const { category, action, search, page = 1, limit = 20 } = req.query
    const filter = { userId: req.userId }

    if (category) filter.category = category
    if (action) filter.action = action
    if (search?.trim()) {
      const q = search.trim()
      filter.$or = [
        { description: { $regex: q, $options: 'i' } },
        { actorName: { $regex: q, $options: 'i' } },
        { action: { $regex: q, $options: 'i' } },
      ]
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit)
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      ActivityLog.countDocuments(filter),
    ])

    res.json({
      logs: toJSONList(logs),
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    })
  } catch (err) {
    console.error('List activity logs error:', err)
    res.status(500).json({ error: 'Failed to fetch activity logs' })
  }
})

export default router
