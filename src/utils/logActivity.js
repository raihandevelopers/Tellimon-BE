import ActivityLog from '../models/ActivityLog.js'
import User from '../models/User.js'

export async function logActivity(userId, { action, category, description, actorName, metadata }) {
  try {
    let name = actorName
    if (!name && userId) {
      const user = await User.findById(userId).select('name')
      name = user?.name || 'System'
    }
    await ActivityLog.create({
      userId,
      actorName: name || 'System',
      action,
      category,
      description,
      metadata,
    })
  } catch (err) {
    console.error('logActivity error:', err)
  }
}

export function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
