import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    initials: { type: String, default: 'U' },
  },
  { timestamps: true }
)

export default mongoose.model('User', userSchema)
