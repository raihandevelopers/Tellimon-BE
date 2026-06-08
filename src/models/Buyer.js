import mongoose from 'mongoose'

const buyerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: '' },
    number: { type: String, required: true, trim: true },
    dailyCap: { type: Number, default: 0 },
    priority: { type: Number, default: 1 },
    ringTimeout: { type: Number, default: 60 },
    concurrentCalls: { type: Number, default: 1 },
    status: { type: String, enum: ['Active', 'Inactive', 'Paused'], default: 'Active' },
  },
  { timestamps: true }
)

export default mongoose.model('Buyer', buyerSchema)
