import mongoose from 'mongoose'

const routingStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    roundRobinIndex: { type: Object, default: {} },
    stickyMap: { type: Object, default: {} },
    callerLastBuyer: { type: Object, default: {} },
  },
  { timestamps: true }
)

export default mongoose.model('RoutingState', routingStateSchema)
