import DID from '../models/DID.js'

export function isMaster(role) {
  return role === 'master'
}

export function normalizeDidNumber(raw) {
  return String(raw || '').replace(/\D/g, '')
}

export function resolveDataUserId(user) {
  if (!user) return null
  if (user.role === 'customer' && user.ownerId) {
    return String(user.ownerId)
  }
  return String(user._id)
}

export function didNumberVariants(number) {
  const variants = new Set()
  const n = normalizeDidNumber(number)
  if (!n) return []
  variants.add(n)
  variants.add(`+${n}`)
  if (n.length === 11 && n.startsWith('1')) {
    variants.add(n.slice(1))
  }
  return [...variants]
}

export async function getMainDidNumbers(userId) {
  const dids = await DID.find({ userId, isMain: true }).select('number')
  const variants = new Set()
  for (const d of dids) {
    for (const v of didNumberVariants(d.number)) variants.add(v)
  }
  return [...variants]
}

export async function getAssignedDidNumbers(userId, authUserId) {
  const dids = await DID.find({ userId, assignedCustomerId: authUserId }).select('number')
  const variants = new Set()
  for (const d of dids) {
    for (const v of didNumberVariants(d.number)) variants.add(v)
  }
  return [...variants]
}

export function customerDidQuery(role, authUserId) {
  if (isMaster(role)) return {}
  return { assignedCustomerId: authUserId, isMain: { $ne: true } }
}

export async function customerCallFilter(userId, userRole, authUserId) {
  if (userRole === 'master') return {}

  const assigned = await getAssignedDidNumbers(userId, authUserId)
  if (!assigned.length) {
    return { did: { $in: ['__no_assigned_did__'] } }
  }
  return { did: { $in: assigned } }
}
