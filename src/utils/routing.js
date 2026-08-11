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
  const byId = new Map(active.map((b) => [String(b.id || b._id), b]))

  // No campaign / inactive → all active buyers, ranked by stored priority
  if (!campaign?.active) {
    return active
      .map((b) => ({ ...b, _rank: 1000 - Number(b.priority || 0) }))
      .sort((a, b) => a._rank - b._rank || String(a.id || a._id).localeCompare(String(b.id || b._id)))
  }

  const ids = (campaign.buyerIds || []).map(String)
  // Empty buyerIds = all active (legacy), ranked by priority field
  if (!ids.length) {
    return active
      .map((b) => ({ ...b, _rank: 1000 - Number(b.priority || 0) }))
      .sort((a, b) => a._rank - b._rank || String(a.id || a._id).localeCompare(String(b.id || b._id)))
  }

  // Campaign list order IS the priority (1st = highest). Do not rely on buyer.priority alone.
  const ordered = []
  ids.forEach((id, index) => {
    const buyer = byId.get(id)
    if (buyer) ordered.push({ ...buyer, _rank: index })
  })
  return ordered
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

/** Lower _rank = higher priority (campaign buyer order). */
function sortByCampaignPriority(pool) {
  return [...pool].sort((a, b) => {
    const rankA = Number.isFinite(a._rank) ? a._rank : 1000 - Number(a.priority || 0)
    const rankB = Number.isFinite(b._rank) ? b._rank : 1000 - Number(b.priority || 0)
    if (rankA !== rankB) return rankA - rankB
    const aActive = Number(a._activeCalls || 0)
    const bActive = Number(b._activeCalls || 0)
    if (aActive !== bActive) return aActive - bActive
    return String(a.id || a._id).localeCompare(String(b.id || b._id))
  })
}

function pickFromPool(pool, strategy, campaignId, state, caller, stickyMap) {
  if (!pool.length) return null

  if (strategy === 'Sticky') {
    const stickyId = stickyMap[caller]
    if (stickyId) {
      const sticky = pool.find((b) => String(b.id || b._id) === String(stickyId))
      if (sticky) return sticky
    }
    return sortByCampaignPriority(pool)[0]
  }

  if (strategy === 'Priority') {
    return sortByCampaignPriority(pool)[0]
  }

  if (strategy === 'Random') {
    return pool[Math.floor(Math.random() * pool.length)]
  }

  if (strategy === 'Round Robin') {
    const key = campaignId ? String(campaignId) : '__global__'
    const idx = Number(state.roundRobinIndex?.[key] || 0)
    const ordered = sortByCampaignPriority(pool)
    const buyer = ordered[idx % ordered.length]
    state.roundRobinIndex = { ...state.roundRobinIndex, [key]: idx + 1 }
    return buyer
  }

  return sortByCampaignPriority(pool)[0]
}

export async function getBuyerCallCountsToday(userId) {
  const start = startOfToday()
  // Call CDRs are stored under the tenant (master) userId.
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

/**
 * Resolve buyer for an inbound DID.
 * - Unassigned / admin DIDs → master (tenant) buyers & campaigns
 * - DIDs assigned to a customer who has buyers → that customer's buyers & campaigns
 * - Assigned but customer has no buyers yet → fall back to master routing
 */
export async function resolveBuyer({
  userId,
  did,
  caller,
  activeCallsByBuyer = {},
}) {
  const tenantUserId = String(userId)
  const didDigits = normalizeDigits(did)
  const callerDigits = normalizeDigits(caller)

  const dids = await DID.find({ userId: tenantUserId }).lean()
  const didRecord = dids.find((d) => normalizeDigits(d.number) === didDigits)
  if (didRecord && didRecord.status === 'Inactive') {
    return { buyer: null, reason: 'did_inactive' }
  }

  let routingOwnerId = tenantUserId
  if (didRecord?.assignedCustomerId) {
    const customerId = String(didRecord.assignedCustomerId)
    const customerBuyerCount = await Buyer.countDocuments({
      userId: customerId,
      status: 'Active',
    })
    if (customerBuyerCount > 0) {
      routingOwnerId = customerId
    }
  }

  const [buyers, stateDoc] = await Promise.all([
    Buyer.find({ userId: routingOwnerId }).lean(),
    RoutingState.findOneAndUpdate(
      { userId: routingOwnerId },
      { $setOnInsert: { userId: routingOwnerId } },
      { upsert: true, new: true }
    ),
  ])

  const buyerJson = buyers.map((b) => ({ ...b, id: b._id.toString() }))
  // Daily caps use tenant CDR store (Asterisk posts under master userId)
  const callsToday = await getBuyerCallCountsToday(tenantUserId)

  let campaign = null
  if (didRecord?.campaignId) {
    campaign = await Campaign.findOne({
      _id: didRecord.campaignId,
      userId: routingOwnerId,
    }).lean()
  }
  // Customer DID may still point at an old master campaign id — pick their active campaign.
  if (!campaign && routingOwnerId !== tenantUserId) {
    campaign = await Campaign.findOne({ userId: routingOwnerId, active: true })
      .sort({ updatedAt: -1 })
      .lean()
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
        routingOwnerId,
      }
    }
  }

  let pool = buyerPool(
    campaign ? { ...campaign, id: campaign._id.toString(), buyerIds: campaign.buyerIds || [] } : null,
    buyerJson
  )
  pool = pool.filter(eligibility)

  pool = pool.map((b) => ({
    ...b,
    _activeCalls: Number(activeCallsByBuyer[String(b._id || b.id)] || 0),
  }))

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

  if (picked && JSON.stringify(state.roundRobinIndex) !== JSON.stringify(stateDoc.roundRobinIndex || {})) {
    stateDoc.roundRobinIndex = state.roundRobinIndex
    await stateDoc.save()
  }

  if (!picked) {
    return { buyer: null, reason: 'no_eligible_buyer', routingOwnerId }
  }

  return {
    buyer: picked,
    campaignId: campaign?._id?.toString() || null,
    campaignName: campaign?.name || null,
    strategy,
    routingOwnerId,
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
