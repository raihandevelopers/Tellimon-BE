import User from '../models/User.js'
import DID from '../models/DID.js'
import Buyer from '../models/Buyer.js'
import { isMaster, normalizeDidNumber, didNumberVariants } from './roles.js'

/**
 * Build maps so reports can show which customer a buyer/DID/call belongs to.
 * tenantUserId = master account id (req.userId).
 */
export async function loadCustomerLabelMaps(tenantUserId) {
  const users = await User.find({
    $or: [{ _id: tenantUserId }, { ownerId: tenantUserId, role: 'customer' }],
  })
    .select('name email role')
    .lean()

  const ownerIds = users.map((u) => u._id)
  const [dids, buyers] = await Promise.all([
    DID.find({ userId: tenantUserId }).select('number assignedCustomerId').lean(),
    Buyer.find({ userId: { $in: ownerIds } }).select('userId number').lean(),
  ])

  const usersById = new Map()
  let masterName = 'Admin'
  for (const u of users) {
    const id = String(u._id)
    usersById.set(id, u)
    if (id === String(tenantUserId)) {
      masterName = u.name || 'Admin'
    }
  }

  function labelForOwnerId(ownerId) {
    if (!ownerId) {
      return { customerId: '', customerName: masterName, isAdminOwned: true }
    }
    const id = String(ownerId)
    if (id === String(tenantUserId)) {
      return { customerId: '', customerName: masterName, isAdminOwned: true }
    }
    const user = usersById.get(id)
    if (!user || user.role !== 'customer') {
      return { customerId: '', customerName: masterName, isAdminOwned: true }
    }
    return {
      customerId: id,
      customerName: user.name || user.email || 'Customer',
      isAdminOwned: false,
    }
  }

  const customerByDid = new Map()
  for (const d of dids) {
    if (!d.assignedCustomerId) continue
    const label = labelForOwnerId(d.assignedCustomerId)
    for (const key of didNumberVariants(d.number)) {
      customerByDid.set(key, label)
    }
  }

  const customerByBuyerId = new Map()
  const customerByBuyerNumber = new Map()
  for (const b of buyers) {
    const label = labelForOwnerId(b.userId)
    customerByBuyerId.set(String(b._id), label)
    for (const key of didNumberVariants(b.number)) {
      if (!customerByBuyerNumber.has(key)) customerByBuyerNumber.set(key, label)
    }
  }

  return {
    masterName,
    labelForOwnerId,
    customerByDid,
    customerByBuyerId,
    customerByBuyerNumber,
  }
}

export function resolveCallCustomer(maps, call = {}) {
  const didDigits = normalizeDidNumber(call.did)
  if (didDigits) {
    for (const key of didNumberVariants(didDigits)) {
      if (maps.customerByDid.has(key)) return maps.customerByDid.get(key)
    }
  }

  const buyerId = String(call.buyerId || '').trim()
  if (buyerId && maps.customerByBuyerId.has(buyerId)) {
    return maps.customerByBuyerId.get(buyerId)
  }

  const buyerDigits = normalizeDidNumber(call.buyerNumber)
  if (buyerDigits) {
    for (const key of didNumberVariants(buyerDigits)) {
      if (maps.customerByBuyerNumber.has(key)) return maps.customerByBuyerNumber.get(key)
    }
  }

  return {
    customerId: '',
    customerName: maps.masterName || 'Admin',
    isAdminOwned: true,
  }
}

export async function attachCustomerToCalls(tenantUserId, calls) {
  if (!calls?.length) return calls || []
  const maps = await loadCustomerLabelMaps(tenantUserId)
  return calls.map((call) => {
    const label = resolveCallCustomer(maps, call)
    return {
      ...call,
      customerId: label.customerId,
      customerName: label.customerName,
      isAdminOwned: label.isAdminOwned,
    }
  })
}

/** Only masters need customer labels on the UI; customers already know it's theirs. */
export function shouldExposeCustomerLabels(userRole) {
  return isMaster(userRole)
}
