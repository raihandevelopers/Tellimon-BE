import express from 'express'
import Buyer from '../models/Buyer.js'
import Campaign from '../models/Campaign.js'
import DID from '../models/DID.js'
import RoutingState from '../models/RoutingState.js'
import { authRequired } from '../middleware/auth.js'
import { toJSONList } from '../config/db.js'
import { getBuyerCallCountsToday, normalizeDigits, resolveBuyer } from '../utils/routing.js'

const router = express.Router()

function checkAsteriskSecret(req, res) {
  const secret = process.env.ASTERISK_WEBHOOK_SECRET
  if (secret && req.headers['x-asterisk-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

router.get('/snapshot', authRequired, async (req, res) => {
  try {
    const userId = req.userId
    const [buyers, campaigns, dids, state, callsToday] = await Promise.all([
      Buyer.find({ userId }),
      Campaign.find({ userId }),
      DID.find({ userId }),
      RoutingState.findOne({ userId }),
      getBuyerCallCountsToday(userId),
    ])

    res.json({
      buyers: toJSONList(buyers),
      campaigns: toJSONList(campaigns),
      dids: toJSONList(dids),
      state: state
        ? {
            roundRobinIndex: state.roundRobinIndex || {},
            stickyMap: state.stickyMap || {},
            callerLastBuyer: state.callerLastBuyer || {},
          }
        : { roundRobinIndex: {}, stickyMap: {}, callerLastBuyer: {} },
      callsToday,
    })
  } catch (err) {
    console.error('Routing snapshot error:', err)
    res.status(500).json({ error: 'Failed to build routing snapshot' })
  }
})

router.post('/resolve', async (req, res) => {
  try {
    if (!checkAsteriskSecret(req, res)) return

    const { userId, did, caller, activeCallsByBuyer = {} } = req.body
    if (!userId || !did) {
      return res.status(400).json({ error: 'userId and did are required' })
    }

    const result = await resolveBuyer({
      userId,
      did,
      caller: caller || '',
      activeCallsByBuyer,
    })

    if (!result.buyer) {
      return res.status(404).json({ error: 'No eligible buyer', reason: result.reason })
    }

    const number = normalizeDigits(result.buyer.number)
    const ringTimeout = Math.max(1, Number(result.buyer.ringTimeout) || 60)

    res.json({
      buyerId: result.buyer.id || result.buyer._id?.toString(),
      buyerNumber: number,
      ringTimeout,
      campaignId: result.campaignId || '',
      campaignName: result.campaignName || '',
      strategy: result.strategy || '',
    })
  } catch (err) {
    console.error('Routing resolve error:', err)
    res.status(500).json({ error: 'Failed to resolve buyer' })
  }
})

export default router
