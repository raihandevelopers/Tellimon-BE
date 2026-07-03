import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    initials: { type: String, default: 'U' },
    role: { type: String, enum: ['master', 'customer'], default: 'master' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    walletBalance: { type: Number, default: 0 },
    walletCallRates: {
      perMinute: { type: Number, default: 0.0024 },
    },
  },
  { timestamps: true }
)

export default mongoose.model('User', userSchema)
