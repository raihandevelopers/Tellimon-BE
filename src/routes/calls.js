import express from 'express'
import mongoose from 'mongoose'
import CallRecord from '../models/CallRecord.js'
import LiveCall from '../models/LiveCall.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { updateRoutingAfterCall } from '../utils/routing.js'
import Campaign from '../models/Campaign.js'

const router = express.Router()

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const RECORDINGS_BASE =
  process.env.RECORDINGS_BASE_URL || 'http://91.108.104.221/recordings'

router.get('/recordings/:filename', authRequired, async (req, res) => {
  try {
    const filename = String(req.params.filename || '')
    if (!/^[\w.-]+\.wav$/i.test(filename)) {
      return res.status(400).json({ error: 'Invalid recording filename' })
    }

    const ownsRecording = await CallRecord.findOne({
      userId: req.userId,
      recordingUrl: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
    })
    if (!ownsRecording) {
      return res.status(404).json({ error: 'Recording not found' })
    }

    const upstream = `${RECORDINGS_BASE.replace(/\/$/, '')}/${filename}`
    const audioRes = await fetch(upstream)
    if (!audioRes.ok) {
      return res.status(404).json({ error: 'Recording file not found on server' })
    }

    const buffer = Buffer.from(await audioRes.arrayBuffer())
    res.set('Content-Type', 'audio/wav')
    res.set('Content-Disposition', `inline; filename="${filename}"`)
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(buffer)
  } catch (err) {
    console.error('Recording proxy error:', err)
    res.status(500).json({ error: 'Failed to fetch recording' })
  }
})

router.get('/', authRequired, async (req, res) => {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query
    const filter = { userId: req.userId }

    if (status) filter.status = status
    if (from || to) {
      filter.createdAt = {}
      if (from) filter.createdAt.$gte = new Date(from)
      if (to) filter.createdAt.$lte = new Date(to)
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit)
    const [calls, total] = await Promise.all([
      CallRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      CallRecord.countDocuments(filter),
    ])

    res.json({
      calls: toJSONList(calls).map((c) => ({ ...c, durationFormatted: formatDuration(c.billsec || c.duration) })),
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    })
  } catch (err) {
    console.error('List calls error:', err)
    res.status(500).json({ error: 'Failed to fetch call reports' })
  }
})

router.get('/stats', authRequired, async (req, res) => {
  try {
    const userId = req.userId
    const [totalCalls, answered, missed, agg] = await Promise.all([
      CallRecord.countDocuments({ userId }),
      CallRecord.countDocuments({ userId, status: 'answered' }),
      CallRecord.countDocuments({ userId, status: { $in: ['missed', 'no-answer', 'busy'] } }),
      CallRecord.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, totalSeconds: { $sum: '$billsec' } } },
      ]),
    ])

    res.json({
      totalCalls,
      answered,
      missed,
      totalTalkTime: agg[0]?.totalSeconds || 0,
    })
  } catch (err) {
    console.error('Call stats error:', err)
    res.status(500).json({ error: 'Failed to fetch call stats' })
  }
})

router.get('/live', authRequired, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 45 * 1000)
    const calls = await LiveCall.find({
      userId: req.userId,
      updatedAt: { $gte: cutoff },
    }).sort({ startedAt: -1 })
    res.json({ calls: toJSONList(calls), active: calls.length })
  } catch (err) {
    console.error('Live calls error:', err)
    res.status(500).json({ error: 'Failed to fetch live calls' })
  }
})

router.post('/live-sync', async (req, res) => {
  try {
    const secret = process.env.ASTERISK_WEBHOOK_SECRET
    if (secret && req.headers['x-asterisk-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { userId, calls = [] } = req.body
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }

    const channelIds = calls.map((c) => c.channelId).filter(Boolean)

    await LiveCall.deleteMany({
      userId,
      channelId: { $nin: channelIds },
    })

    for (const c of calls) {
      if (!c.channelId) continue
      await LiveCall.findOneAndUpdate(
        { userId, channelId: c.channelId },
        {
          $set: {
            caller: c.caller || '',
            did: c.did || '',
            buyerNumber: c.buyerNumber || '',
            route: c.route || 'xolo-endpoint',
            startedAt: c.startedAt ? new Date(c.startedAt) : new Date(),
          },
        },
        { upsert: true, new: true }
      )
    }

    res.json({ success: true, active: channelIds.length })
  } catch (err) {
    console.error('Live sync error:', err)
    res.status(500).json({ error: 'Failed to sync live calls' })
  }
})

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.ASTERISK_WEBHOOK_SECRET
    if (secret && req.headers['x-asterisk-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const {
      userId,
      caller,
      did,
      buyerId,
      buyerNumber,
      campaignId,
      status,
      duration,
      billsec,
      recordingUrl,
      recordingPath,
      uniqueId,
      startedAt,
      endedAt,
    } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }

    const callerDigits = String(caller || '').replace(/\D/g, '') || 'unknown'

    if (uniqueId) {
      const existing = await CallRecord.findOne({ uniqueId })
      if (existing) {
        if (recordingUrl && recordingUrl !== existing.recordingUrl) {
          existing.recordingUrl = recordingUrl
          if (billsec != null) existing.billsec = billsec
          if (duration != null) existing.duration = duration
          if (status) existing.status = status
          await existing.save()
        }
        return res.json({ call: toJSON(existing), duplicate: true })
      }
    }

    const call = await CallRecord.create({
      userId,
      caller: callerDigits,
      did: did || '',
      buyerId: buyerId && /^[a-f0-9]{24}$/i.test(buyerId) ? buyerId : undefined,
      buyerNumber: buyerNumber || '',
      campaignId: campaignId && /^[a-f0-9]{24}$/i.test(campaignId) ? campaignId : undefined,
      status: status || 'missed',
      duration: duration ?? 0,
      billsec: billsec ?? duration ?? 0,
      recordingUrl: recordingUrl || '',
      recordingPath: recordingPath || '',
      uniqueId: uniqueId || '',
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      endedAt: endedAt ? new Date(endedAt) : new Date(),
    })

    await logActivity({
      userId,
      actorName: 'System',
      action: 'call_completed',
      category: 'call',
      description: `Call from ${caller} — ${status || 'completed'} (${billsec ?? duration ?? 0}s)`,
      metadata: { callId: call._id, caller, did },
    })

    let strategy = ''
    let duplicateHandling = 'Normal'
    if (campaignId) {
      const campaign = await Campaign.findOne({ _id: campaignId, userId })
      if (campaign) {
        strategy = campaign.strategy
        duplicateHandling = campaign.duplicateHandling
      }
    }

    await updateRoutingAfterCall({
      userId,
      caller,
      buyerId: buyerId || call.buyerId,
      campaignId,
      status: status || 'missed',
      strategy,
      duplicateHandling,
    })

    res.status(201).json({ call: toJSON(call) })
  } catch (err) {
    console.error('Call webhook error:', err)
    res.status(500).json({ error: 'Failed to save call record' })
  }
})

export default router
