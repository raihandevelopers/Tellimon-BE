import mongoose from 'mongoose'

const targetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export default mongoose.model('Target', targetSchema)
