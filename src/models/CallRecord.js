import mongoose from 'mongoose'

const callRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caller: { type: String, required: true, trim: true },
    did: { type: String, default: '' },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Buyer' },
    buyerNumber: { type: String, default: '' },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
    status: {
      type: String,
      enum: ['answered', 'missed', 'busy', 'failed', 'no-answer'],
      default: 'missed',
    },
    duration: { type: Number, default: 0 },
    billsec: { type: Number, default: 0 },
    recordingUrl: { type: String, default: '' },
    recordingPath: { type: String, default: '' },
    uniqueId: { type: String, default: '', index: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
)

callRecordSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.model('CallRecord', callRecordSchema)
