import mongoose from 'mongoose'

const activityLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorName: { type: String, default: 'System' },
    action: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ['auth', 'buyer', 'campaign', 'blocked', 'call', 'system'],
      default: 'system',
    },
    description: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

activityLogSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.model('ActivityLog', activityLogSchema)
