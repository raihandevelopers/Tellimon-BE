import mongoose from 'mongoose'

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    callId: { type: mongoose.Schema.Types.ObjectId, ref: 'CallRecord' },
    did: { type: String, default: '' },
    billsec: { type: Number, default: 0 },
    description: { type: String, default: '' },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: '' },
  },
  { timestamps: true }
)

walletTransactionSchema.index({ customerId: 1, createdAt: -1 })

export default mongoose.model('WalletTransaction', walletTransactionSchema)
