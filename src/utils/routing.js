import mongoose from 'mongoose'
import Buyer from '../models/Buyer.js'
import Campaign from '../models/Campaign.js'
import DID from '../models/DID.js'
import CallRecord from '../models/CallRecord.js'
import RoutingState from '../models/RoutingState.js'

export function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function isBuyerEligible(buyer, { callsToday = 0, activeCalls = 0 } = {}) {
  if (!buyer || buyer.status !== 'Active') return false
  const cap = Number(buyer.dailyCap) || 0
  if (cap > 0 && callsToday >= cap) return false
  const maxConcurrent = Number(buyer.concurrentCalls)
  if (Number.isFinite(maxConcurrent) && maxConcurrent > 0 && activeCalls >= maxConcurrent) return false
  return Boolean(normalizeDigits(buyer.number))
}

function buyerPool(campaign, allBuyers) {
  const active = allBuyers.filter((b) => b.status === 'Active')
  if (!campaign?.active) return active
  const ids = (campaign.buyerIds || []).map(String)
  if (!ids.length) return active
  return active.filter((b) => ids.includes(String(b.id || b._id)))
}

function applyDuplicateHandling(pool, duplicateHandling, caller, callerLastBuyer) {
  const lastId = callerLastBuyer[caller]
  if (!lastId || !pool.length) return pool

  if (duplicateHandling === 'Same Buyer') {
    const sticky = pool.find((b) => String(b.id || b._id) === String(lastId))
    return sticky ? [sticky] : pool
  }

  if (duplicateHandling === 'Different Buyer') {
    const filtered = pool.filter((b) => String(b.id || b._id) !== String(lastId))
    return filtered.length ? filtered : pool
  }

  return pool
}

function pickFromPool(pool, strategy, campaignId, state, caller, stickyMap) {
  if (!pool.length) return null

  if (strategy === 'Sticky') {
    const stickyId = stickyMap[caller]
    if (stickyId) {
      const sticky = pool.find((b) => String(b.id || b._id) === String(stickyId))
      if (sticky) return sticky
    }
    return [...pool].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0]
  }

  if (strategy === 'Priority') {
    return [...pool].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0]
  }

  if (strategy === 'Random') {
    return pool[Math.floor(Math.random() * pool.length)]
  }

  if (strategy === 'Round Robin') {
    const key = campaignId ? String(campaignId) : '__global__'
    const idx = Number(state.roundRobinIndex?.[key] || 0)
    const buyer = pool[idx % pool.length]
    state.roundRobinIndex = { ...state.roundRobinIndex, [key]: idx + 1 }
    return buyer
  }

  return [...pool].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0]
}

export async function getBuyerCallCountsToday(userId) {
  const start = startOfToday()
  const rows = await CallRecord.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: start },
        buyerId: { $exists: true, $ne: null },
      },
    },
    { $group: { _id: '$buyerId', count: { $sum: 1 } } },
  ])
  const map = {}
  for (const row of rows) {
    map[String(row._id)] = row.count
  }
  return map
}

export async function resolveBuyer({
  userId,
  did,
  caller,
  activeCallsByBuyer = {},
}) {
  const didDigits = normalizeDigits(did)
  const callerDigits = normalizeDigits(caller)

  const [buyers, dids, stateDoc] = await Promise.all([
    Buyer.find({ userId }).lean(),
    DID.find({ userId }).lean(),
    RoutingState.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    ),
  ])

  const buyerJson = buyers.map((b) => ({ ...b, id: b._id.toString() }))
  const callsToday = await getBuyerCallCountsToday(userId)

  const didRecord = dids.find((d) => normalizeDigits(d.number) === didDigits)
  if (didRecord && didRecord.status === 'Inactive') {
    return { buyer: null, reason: 'did_inactive' }
  }

  let campaign = null
  if (didRecord?.campaignId) {
    campaign = await Campaign.findOne({ _id: didRecord.campaignId, userId }).lean()
  }

  const eligibility = (buyer) =>
    isBuyerEligible(
      { ...buyer, id: buyer._id?.toString() || buyer.id },
      {
        callsToday: callsToday[String(buyer._id || buyer.id)] || 0,
        activeCalls: activeCallsByBuyer[String(buyer._id || buyer.id)] || 0,
      }
    )

  if (didRecord?.buyerId) {
    const direct = buyerJson.find((b) => String(b.id) === String(didRecord.buyerId))
    if (direct && eligibility(direct)) {
      return {
        buyer: direct,
        campaignId: campaign?._id?.toString() || null,
        campaignName: campaign?.name || null,
        strategy: 'Direct',
      }
    }
  }

  let pool = buyerPool(
    campaign ? { ...campaign, id: campaign._id.toString(), buyerIds: campaign.buyerIds || [] } : null,
    buyerJson
  )
  pool = pool.filter(eligibility)

  const state = {
    roundRobinIndex: { ...(stateDoc.roundRobinIndex || {}) },
    stickyMap: stateDoc.stickyMap || {},
    callerLastBuyer: stateDoc.callerLastBuyer || {},
  }

  pool = applyDuplicateHandling(
    pool,
    campaign?.duplicateHandling || 'Normal',
    callerDigits,
    state.callerLastBuyer
  )

  const strategy = campaign?.active ? campaign.strategy || 'Priority' : 'Priority'
  const picked = pickFromPool(
    pool,
    strategy,
    campaign?._id?.toString(),
    state,
    callerDigits,
    state.stickyMap
  )

  if (picked && state.roundRobinIndex !== stateDoc.roundRobinIndex) {
    stateDoc.roundRobinIndex = state.roundRobinIndex
    await stateDoc.save()
  }

  if (!picked) {
    return { buyer: null, reason: 'no_eligible_buyer' }
  }

  return {
    buyer: picked,
    campaignId: campaign?._id?.toString() || null,
    campaignName: campaign?.name || null,
    strategy,
  }
}

export async function updateRoutingAfterCall({
  userId,
  caller,
  buyerId,
  campaignId,
  status,
  strategy,
  duplicateHandling,
}) {
  if (!userId || !caller || !buyerId) return

  const callerDigits = normalizeDigits(caller)
  const stateDoc = await RoutingState.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true }
  )

  stateDoc.callerLastBuyer = { ...(stateDoc.callerLastBuyer || {}), [callerDigits]: String(buyerId) }

  if (status === 'answered' && strategy === 'Sticky') {
    stateDoc.stickyMap = { ...(stateDoc.stickyMap || {}), [callerDigits]: String(buyerId) }
  }

  if (duplicateHandling === 'Different Buyer' && status === 'answered') {
    // callerLastBuyer already updated; next call will exclude this buyer
  }

  await stateDoc.save()
}
