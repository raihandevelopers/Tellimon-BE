import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { resolveDataUserId } from '../utils/roles.js'

export function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(payload.userId)
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.authUserId = String(user._id)
    req.userRole = user.role || 'master'
    req.userId = resolveDataUserId(user)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
