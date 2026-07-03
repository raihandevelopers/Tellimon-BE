import mongoose from 'mongoose'

const callRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caller: { type: String, default: '' },
    did: { type: String, default: '' },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Buyer' },
    buyerNumber: { type: String, default: '' },
    status: {
      type: String,
      enum: ['answered', 'missed', 'busy', 'failed', 'no-answer'],
      default: 'missed',
    },
    duration: { type: Number, default: 0 },
    billsec: { type: Number, default: 0 },
    recordingUrl: { type: String, default: '' },
    recordingPath: { type: String, default: '' },
    uniqueId: { type: String, index: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
)

callRecordSchema.index({ userId: 1, uniqueId: 1 }, { unique: true, sparse: true })

export default mongoose.model('CallRecord', callRecordSchema)
