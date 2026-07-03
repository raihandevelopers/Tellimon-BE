import mongoose from 'mongoose'

const activityLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorName: { type: String, default: '' },
    action: { type: String, required: true },
    category: {
      type: String,
      enum: ['auth', 'buyer', 'campaign', 'blocked', 'call', 'did', 'wallet', 'system'],
      default: 'system',
    },
    description: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
)

export default mongoose.model('ActivityLog', activityLogSchema)
