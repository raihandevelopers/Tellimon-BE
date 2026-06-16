import ActivityLog from '../models/ActivityLog.js'

export async function logActivity({ userId, actorName, action, category, description, metadata = {} }) {
  try {
    await ActivityLog.create({
      userId,
      actorName: actorName || 'System',
      action,
      category,
      description,
      metadata,
    })
  } catch (err) {
    console.error('Failed to write activity log:', err)
  }
}
