import { isMaster } from '../utils/roles.js'

/** Master-only tenant config (DID / customer admin, etc.). */
export function requireMaster(req, res, next) {
  if (!isMaster(req.userRole)) {
    return res.status(403).json({ error: 'This resource is only available to master accounts' })
  }
  next()
}

/**
 * Scope for buyers / campaigns / blocked contacts:
 * - master → tenant id (req.userId)
 * - customer → their own account id (personal data, not shared)
 */
export function personalDataUserId(req) {
  if (isMaster(req.userRole)) return req.userId
  return req.authUserId
}
