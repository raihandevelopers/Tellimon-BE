import mongoose from 'mongoose'

export function toJSON(doc) {
  if (!doc) return null
  const obj = doc.toObject ? doc.toObject() : { ...doc }
  const { _id, __v, password, ...rest } = obj
  return { ...rest, id: _id?.toString() ?? obj.id }
}

export function toJSONList(docs) {
  return docs.map((d) => toJSON(d))
}

export default async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tellimon'
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  console.log('MongoDB connected:', uri)
}
