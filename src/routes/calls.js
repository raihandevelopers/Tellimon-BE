import express from 'express'
import mongoose from 'mongoose'
import CallRecord from '../models/CallRecord.js'
import LiveCall from '../models/LiveCall.js'
import Buyer from '../models/Buyer.js'
import DID from '../models/DID.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { updateRoutingAfterCall } from '../utils/routing.js'
import Campaign from '../models/Campaign.js'
import { customerCallFilter, isMaster, normalizeDidNumber } from '../utils/roles.js'
import { loadCustomerDidDisplayMap, maskCallForCustomer } from '../utils/customerDidDisplay.js'
import { debitForCall } from '../utils/wallet.js'
import { buildCallListFilter } from '../utils/callFilters.js'
import { hangupAsteriskChannel, isSafeChannelId } from '../utils/hangupChannel.js'
import User from '../models/User.js'
import { attachCustomerToCalls, shouldExposeCustomerLabels } from '../utils/customerLabels.js'

const router = express.Router()

function buyerNumberKeys(number) {
  const digits = normalizeDidNumber(number)
  if (!digits) return []
  const keys = new Set([digits])
  if (digits.length === 11 && digits.startsWith('1')) keys.add(digits.slice(1))
  if (digits.length === 10) keys.add(`1${digits}`)
  return [...keys]
}

async function loadLiveCallLookup(userId) {
  const dids = await DID.find({ userId }).select('number campaignId assignedCustomerId').lean()
  const ownerIds = [
    userId,
    ...new Set(
      dids
        .map((d) => (d.assignedCustomerId ? String(d.assignedCustomerId) : null))
        .filter(Boolean)
    ),
  ]
  const [buyers, campaigns] = await Promise.all([
    Buyer.find({ userId: { $in: ownerIds } }).select('name number').lean(),
    Campaign.find({ userId: { $in: ownerIds } }).select('name buyerIds active').lean(),
  ])

  const buyersById = new Map()
  const buyersByNumber = new Map()
  for (const b of buyers) {
    const id = String(b._id)
    buyersById.set(id, b)
    for (const key of buyerNumberKeys(b.number)) {
      if (!buyersByNumber.has(key)) buyersByNumber.set(key, b)
    }
  }

  const campaignsById = new Map()
  for (const c of campaigns) {
    campaignsById.set(String(c._id), c)
  }

  const campaignIdByDid = new Map()
  for (const d of dids) {
    if (!d.campaignId) continue
    for (const key of buyerNumberKeys(d.number)) {
      campaignIdByDid.set(key, String(d.campaignId))
    }
  }

  return { buyersById, buyersByNumber, campaignsById, campaignIdByDid }
}

function resolveLiveCallMeta(lookup, call = {}) {
  let buyer = null
  const buyerId = String(call.buyerId || '').trim()
  if (buyerId && lookup.buyersById.has(buyerId)) buyer = lookup.buyersById.get(buyerId)
  if (!buyer) {
    for (const key of buyerNumberKeys(call.buyerNumber)) {
      if (lookup.buyersByNumber.has(key)) {
        buyer = lookup.buyersByNumber.get(key)
        break
      }
    }
  }

  const resolvedBuyerId = buyer ? String(buyer._id) : buyerId || ''
  let campaignId = String(call.campaignId || '').trim()
  if (!campaignId || campaignId === 'none') {
    for (const key of buyerNumberKeys(call.did)) {
      if (lookup.campaignIdByDid.has(key)) {
        campaignId = lookup.campaignIdByDid.get(key)
        break
      }
    }
  }

  const campaign =
    campaignId && campaignId !== 'none' ? lookup.campaignsById.get(campaignId) : null
  // Do not label a call with a campaign just because the buyer is in it.
  // If the DID's campaign has a selected list, only those buyers belong to it.
  const selectedIds = (campaign?.buyerIds || []).map(String)
  const campaignActive = campaign ? campaign.active !== false : false
  const buyerAllowed =
    !campaign ||
    !selectedIds.length ||
    !resolvedBuyerId ||
    selectedIds.includes(resolvedBuyerId)
  const campaignForCall = campaign && campaignActive && buyerAllowed ? campaign : null

  return {
    buyerId: resolvedBuyerId,
    buyerName: (buyer?.name || call.buyerName || '').trim(),
    buyerNumber: normalizeDidNumber(call.buyerNumber) || normalizeDidNumber(buyer?.number) || '',
    campaignId: campaignForCall ? String(campaignForCall._id) : '',
    campaignName: campaignForCall ? String(campaignForCall.name || '').trim() : '',
  }
}

async function enrichLiveCalls(userId, calls) {
  if (!calls?.length) return calls || []
  const lookup = await loadLiveCallLookup(userId)
  return calls.map((call) => {
    const json = typeof call.toObject === 'function' ? call.toObject() : { ...call }
    const meta = resolveLiveCallMeta(lookup, json)
    return {
      ...json,
      buyerId: meta.buyerId || json.buyerId || '',
      buyerName: meta.buyerName || json.buyerName || '',
      buyerNumber: meta.buyerNumber || json.buyerNumber || '',
      campaignId: meta.campaignId || json.campaignId || '',
      campaignName: meta.campaignName || json.campaignName || '',
    }
  })
}

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

    let list = toJSONList(calls).map((c) => ({
      ...c,
      durationFormatted: formatDuration(c.billsec || c.duration),
    }))
    list = await enrichLiveCalls(req.userId, list)
    if (shouldExposeCustomerLabels(req.userRole)) {
      list = await attachCustomerToCalls(req.userId, list)
    }
    if (!isMaster(req.userRole)) {
      const displayMap = await loadCustomerDidDisplayMap(req.userId, req.authUserId)
      list = list.map((c) => maskCallForCustomer(c, displayMap))
    }

    res.json({
      calls: list,
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
    let list = await enrichLiveCalls(req.userId, toJSONList(visible))
    if (shouldExposeCustomerLabels(req.userRole)) {
      list = await attachCustomerToCalls(req.userId, list)
    }
    if (!isMaster(req.userRole)) {
      const displayMap = await loadCustomerDidDisplayMap(req.userId, req.authUserId)
      list = list.map((c) => maskCallForCustomer(c, displayMap))
    }
    res.json({ calls: list, active: visible.length })
  } catch (err) {
    console.error('Live calls error:', err)
    res.status(500).json({ error: 'Failed to fetch live calls' })
  }
})

/** Disconnect an active live call (Asterisk channel hangup). */
router.post('/live/:id/hangup', authRequired, async (req, res) => {
  try {
    const extra = await customerCallFilter(req.userId, req.userRole, req.authUserId)
    const live = await LiveCall.findOne({
      _id: req.params.id,
      userId: req.userId,
      ...extra,
    })
    if (!live) {
      return res.status(404).json({ error: 'Live call not found' })
    }

    const channelId = String(live.channelId || '').trim()
    if (!isSafeChannelId(channelId)) {
      return res.status(400).json({ error: 'Invalid channel for hangup' })
    }

    try {
      await hangupAsteriskChannel(channelId)
    } catch (err) {
      if (err.message === 'INVALID_CHANNEL') {
        return res.status(400).json({ error: 'Invalid channel for hangup' })
      }
      console.error('Asterisk hangup failed:', err)
      return res.status(502).json({ error: 'Failed to hang up call on Asterisk' })
    }

    await LiveCall.deleteOne({ _id: live._id })

    const actor = await User.findById(req.authUserId || req.userId).select('name')
    await logActivity({
      userId: isMaster(req.userRole) ? req.userId : req.authUserId,
      actorName: actor?.name,
      action: 'live_call_hangup',
      category: 'call',
      description: `Disconnected live call ${channelId} (caller ${live.caller || 'unknown'} → DID ${live.did || '—'})`,
      metadata: { channelId, caller: live.caller, did: live.did, buyerNumber: live.buyerNumber },
    })

    res.json({ success: true, channelId })
  } catch (err) {
    console.error('Live hangup error:', err)
    res.status(500).json({ error: 'Failed to disconnect live call' })
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
    const lookup = await loadLiveCallLookup(userId)

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
      const meta = resolveLiveCallMeta(lookup, c)
      await LiveCall.findOneAndUpdate(
        { userId, channelId: c.channelId },
        {
          $set: {
            caller: c.caller || '',
            did: c.did || '',
            buyerId: meta.buyerId,
            buyerName: meta.buyerName,
            buyerNumber: meta.buyerNumber || c.buyerNumber || '',
            campaignId: meta.campaignId,
            campaignName: meta.campaignName,
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
      buyerName,
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

    const lookup = await loadLiveCallLookup(userId)
    const meta = resolveLiveCallMeta(lookup, { buyerId, buyerNumber, buyerName, did, campaignId })

    const call = await CallRecord.create({
      userId,
      caller: callerDigits,
      did: did || '',
      buyerId: meta.buyerId && /^[a-f0-9]{24}$/i.test(meta.buyerId) ? meta.buyerId : undefined,
      buyerName: meta.buyerName || '',
      buyerNumber: meta.buyerNumber || buyerNumber || '',
      campaignId: meta.campaignId && /^[a-f0-9]{24}$/i.test(meta.campaignId) ? meta.campaignId : undefined,
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

    try {
      await debitForCall({
        tenantUserId: userId,
        did,
        callId: call._id,
        billsec: billsec ?? duration ?? 0,
        status: status || 'missed',
        uniqueId,
      })
    } catch (walletErr) {
      console.error('Wallet debit error:', walletErr)
    }

    let strategy = ''
    let duplicateHandling = 'Normal'
    let routingOwnerId = userId
    if (buyerId || call.buyerId) {
      const buyerDoc = await Buyer.findById(buyerId || call.buyerId).select('userId').lean()
      if (buyerDoc?.userId) routingOwnerId = String(buyerDoc.userId)
    }
    if (campaignId) {
      const campaign = await Campaign.findById(campaignId).lean()
      if (campaign) {
        strategy = campaign.strategy
        duplicateHandling = campaign.duplicateHandling
        if (campaign.userId) routingOwnerId = String(campaign.userId)
      }
    }

    await updateRoutingAfterCall({
      userId: routingOwnerId,
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
