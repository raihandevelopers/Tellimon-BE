import mongoose from 'mongoose'

const blockedContactSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    number: { type: String, required: true, trim: true },
    status: { type: String, default: 'Active' },
  },
  { timestamps: true }
)

blockedContactSchema.index({ userId: 1, number: 1 }, { unique: true })

export default mongoose.model('BlockedContact', blockedContactSchema)
