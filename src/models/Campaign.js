import mongoose from 'mongoose'

const campaignSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    strategy: { type: String, enum: ['Sticky', 'Round Robin', 'Priority', 'Random'], default: 'Sticky' },
    duplicateHandling: { type: String, enum: ['Normal', 'Different Buyer', 'Same Buyer'], default: 'Normal' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default mongoose.model('Campaign', campaignSchema)
