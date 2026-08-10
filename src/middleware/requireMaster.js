import User from '../models/User.js'
import { isMaster } from '../utils/roles.js'

/** Master-only tenant config (DID / customer admin, etc.). */
export function requireMaster(req, res, next) {
  if (!isMaster(req.userRole)) {
    return res.status(403).json({ error: 'This resource is only available to master accounts' })
  }
  next()
}

/**
 * Owner id for creating personal resources:
 * - master → tenant id (req.userId)
 * - customer → their own account id (personal data, not shared)
 */
export function personalDataUserId(req) {
  if (isMaster(req.userRole)) return req.userId
  return req.authUserId
}

/**
 * Visibility scope for lists / reports:
 * - master (admin) → own account + every customer under the tenant
 * - customer → only their own account
 */
export async function visibleDataUserIds(req) {
  if (!isMaster(req.userRole)) {
    return [String(req.authUserId)]
  }
  const customers = await User.find({
    role: 'customer',
    ownerId: req.userId,
  })
    .select('_id')
    .lean()
  return [String(req.userId), ...customers.map((c) => String(c._id))]
}

/** Mongo filter for userId scoped by visibleDataUserIds. */
export async function visibleUserIdFilter(req) {
  const ids = await visibleDataUserIds(req)
  if (ids.length === 1) return { userId: ids[0] }
  return { userId: { $in: ids } }
}
