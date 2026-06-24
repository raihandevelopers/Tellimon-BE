import mongoose from 'mongoose'

const liveCallSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: String, required: true },
    caller: { type: String, default: '' },
    did: { type: String, default: '' },
    buyerNumber: { type: String, default: '' },
    route: { type: String, default: 'xolo-endpoint' },
    startedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

liveCallSchema.index({ userId: 1, channelId: 1 }, { unique: true })

export default mongoose.model('LiveCall', liveCallSchema)
