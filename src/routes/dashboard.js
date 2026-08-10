import express from 'express'
import Campaign from '../models/Campaign.js'
import Target from '../models/Target.js'
import BlockedContact from '../models/BlockedContact.js'
import CallRecord from '../models/CallRecord.js'
import { authRequired } from '../middleware/auth.js'
import { visibleUserIdFilter } from '../middleware/requireMaster.js'
import { customerCallFilter, isMaster } from '../utils/roles.js'
import { getIstBusinessDayBounds, callPeriodExprFilter } from '../utils/istDayBounds.js'

const router = express.Router()

router.use(authRequired)

router.get('/stats', async (req, res) => {
  try {
    const tenantUserId = req.userId
    const ownerScope = await visibleUserIdFilter(req)
    const callFilter = await customerCallFilter(tenantUserId, req.userRole, req.authUserId)
    const period = getIstBusinessDayBounds()
    const periodFilter = callPeriodExprFilter(period.start, period.end)
    const base = { userId: tenantUserId, ...callFilter, ...periodFilter }

    const [campaigns, targets, blocked, totalCalls, answered, missed] = await Promise.all([
      Campaign.countDocuments(ownerScope),
      isMaster(req.userRole) ? Target.countDocuments({ userId: tenantUserId }) : Promise.resolve(0),
      BlockedContact.countDocuments(ownerScope),
      CallRecord.countDocuments(base),
      CallRecord.countDocuments({ ...base, status: 'answered' }),
      CallRecord.countDocuments({
        ...base,
        status: { $in: ['missed', 'no-answer', 'failed'] },
      }),
    ])

    res.json({
      campaigns,
      targets,
      blocked,
      totalCalls,
      answered,
      missed,
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
        resetHour: period.resetHour,
      },
    })
  } catch (err) {
    console.error('Dashboard stats error:', err)
    res.status(500).json({ error: 'Failed to fetch dashboard stats' })
  }
})

export default router
