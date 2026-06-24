import mongoose from 'mongoose'

const didSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    number: { type: String, required: true, trim: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    trunk: { type: String, default: '8138073157' },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Buyer' },
  },
  { timestamps: true }
)

didSchema.index({ userId: 1, number: 1 }, { unique: true })

export default mongoose.model('DID', didSchema)
