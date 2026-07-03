import express from 'express'
import mongoose from 'mongoose'
import CallRecord from '../models/CallRecord.js'
import LiveCall from '../models/LiveCall.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { updateRoutingAfterCall } from '../utils/routing.js'
import Campaign from '../models/Campaign.js'
import { customerCallFilter } from '../utils/roles.js'

const router = express.Router()

function dedupeLiveCalls(calls) {
  const map = new Map()
  for (const call of calls) {
    const did = String(call.did || '').replace(/\D/g, '')
    const caller = String(call.caller || '').replace(/\D/g, '')
    const key = (did && caller ? `${did}:${caller}` : '') || call.channelId || call.id
    const existing = map.get(key)
    const hasDid = Boolean(did)

    if (!existing) {
      map.set(key, call)
      continue
    }

    const existingHasDid = Boolean(String(existing.did || '').replace(/\D/g, ''))
    if (hasDid && !existingHasDid) {
      map.set(key, call)
      continue
    }

    // Keep the older startedAt so duration never jumps backward.
    const started = call.startedAt ? new Date(call.startedAt).getTime() : Infinity
    const existingStarted = existing.startedAt ? new Date(existing.startedAt).getTime() : Infinity
    if (started < existingStarted) map.set(key, call)
  }

  return [...map.values()].filter((call) => Boolean(String(call.did || '').replace(/\D/g, '')))
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const RECORDINGS_BASE =
  process.env.RECORDINGS_BASE_URL || 'http://91.108.104.221/recordings'

function istDayStart(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const d = new Date(`${dateStr}T00:00:00+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

function istDayEnd(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const d = new Date(`${dateStr}T23:59:59.999+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

function buildCallListFilter({ status, from, to, number }) {
  const filter = {}

  if (status === 'missed') {
    filter.status = { $in: ['missed', 'no-answer', 'busy'] }
  } else if (status === 'unanswered') {
    filter.status = { $in: ['no-answer', 'busy'] }
  } else if (status === 'missed-only') {
    filter.status = { $in: ['missed', 'failed'] }
  } else if (status === 'answered') {
    filter.status = 'answered'
  } else if (status) {
    filter.status = status
  }

  const dateParts = []
  const start = from ? istDayStart(from) : null
  const end = to ? istDayEnd(to) : null
  if (start) {
    dateParts.push({ $gte: [{ $ifNull: ['$startedAt', '$createdAt'] }, start] })
  }
  if (end) {
    dateParts.push({ $lte: [{ $ifNull: ['$startedAt', '$createdAt'] }, end] })
  }
  if (dateParts.length) {
    filter.$expr = dateParts.length === 1 ? dateParts[0] : { $and: dateParts }
  }

  const digits = String(number || '').replace(/\D/g, '')
  if (digits) {
    const regex = new RegExp(digits)
    filter.$or = [{ caller: regex }, { did: regex }, { buyerNumber: regex }]
  }

  return filter
}

router.get('/recordings/:filename', authRequired, async (req, res) => {
  try {
    const filename = String(req.params.filename || '')
    if (!/^[\w.-]+\.wav$/i.test(filename)) {
      return res.status(400).json({ error: 'Invalid recording filename' })
    }

    const ownsRecording = await CallRecord.findOne({
      userId: req.userId,
      recordingUrl: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
      ...(await customerCallFilter(req.userId, req.userRole, req.authUserId)),
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
    const { status, from, to, number, page = 1, limit = 20 } = req.query
    const filter = {
      userId: req.userId,
      ...(await customerCallFilter(req.userId, req.userRole, req.authUserId)),
      ...buildCallListFilter({ status, from, to, number }),
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit)
    const [calls, total] = await Promise.all([
      CallRecord.find(filter)
        .sort({ startedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      CallRecord.countDocuments(filter),
    ])

    res.json({
      calls: toJSONList(calls).map((c) => ({ ...c, durationFormatted: formatDuration(c.billsec || c.duration) })),
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    })
  } catch (err) {
    console.error('List calls error:', err)
    res.status(500).json({ error: 'Failed to fetch call reports' })
  }
})

router.get('/stats', authRequired, async (req, res) => {
  try {
    const userId = req.userId
    const extra = await customerCallFilter(userId, req.userRole, req.authUserId)
    const base = { userId, ...extra }
    const [totalCalls, answered, missed, agg] = await Promise.all([
      CallRecord.countDocuments(base),
      CallRecord.countDocuments({ ...base, status: 'answered' }),
      CallRecord.countDocuments({ ...base, status: { $in: ['missed', 'no-answer', 'busy'] } }),
      CallRecord.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), ...extra } },
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
    const cutoff = new Date(Date.now() - 150 * 1000)
    const extra = await customerCallFilter(req.userId, req.userRole, req.authUserId)
    const calls = await LiveCall.find({
      userId: req.userId,
      updatedAt: { $gte: cutoff },
      ...extra,
    }).sort({ startedAt: -1 })
    const visible = dedupeLiveCalls(calls)
    res.json({ calls: toJSONList(visible), active: visible.length })
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
      const incomingStart = c.startedAt ? new Date(c.startedAt) : new Date()
      const existing = await LiveCall.findOne({ userId, channelId: c.channelId })
      let startedAt = incomingStart
      if (existing?.startedAt) {
        const prevMs = new Date(existing.startedAt).getTime()
        const prevAge = Date.now() - prevMs
        const incomingAge = Date.now() - incomingStart.getTime()
        const prevValid = Number.isFinite(prevAge) && prevAge >= 0 && prevAge < 6 * 60 * 60 * 1000
        const incomingValid = Number.isFinite(incomingAge) && incomingAge >= 0 && incomingAge < 6 * 60 * 60 * 1000
        if (prevValid) {
          startedAt = existing.startedAt
        } else if (incomingValid) {
          startedAt = incomingStart
        } else {
          startedAt = new Date()
        }
      }
      await LiveCall.findOneAndUpdate(
        { userId, channelId: c.channelId },
        {
          $set: {
            caller: c.caller || '',
            did: c.did || '',
            buyerNumber: c.buyerNumber || '',
            route: c.route || 'xolo-endpoint',
            startedAt,
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

    const seconds = Math.max(0, Number(billsec ?? duration ?? 0))
    const end = endedAt ? new Date(endedAt) : new Date()
    const start = startedAt ? new Date(startedAt) : new Date(end.getTime() - seconds * 1000)

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
      startedAt: start,
      endedAt: end,
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
