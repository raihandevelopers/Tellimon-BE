import ActivityLog from '../models/ActivityLog.js'
import User from '../models/User.js'

function normalizeArgs(userIdOrPayload, maybePayload) {
  if (
    userIdOrPayload &&
    typeof userIdOrPayload === 'object' &&
    userIdOrPayload.userId != null &&
    maybePayload === undefined
  ) {
    const { userId, ...rest } = userIdOrPayload
    return { userId, payload: rest }
  }
  return { userId: userIdOrPayload, payload: maybePayload || {} }
}

export async function logActivity(userIdOrPayload, maybePayload) {
  const { userId, payload } = normalizeArgs(userIdOrPayload, maybePayload)
  const { action, category, description, actorName, metadata } = payload

  if (!userId || !action) return

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
    console.error('Failed to write activity log:', err)
  }
}

export function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
