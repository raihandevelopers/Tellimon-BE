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
      answeredPerMinute: { type: Number, default: 1 },
      missed: { type: Number, default: 1 },
      noAnswer: { type: Number, default: 1 },
      busy: { type: Number, default: 1 },
      failed: { type: Number, default: 1 },
    },
  },
  { timestamps: true }
)

export default mongoose.model('User', userSchema)
