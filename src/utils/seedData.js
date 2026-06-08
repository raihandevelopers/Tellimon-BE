import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import Target from '../models/Target.js'

export async function ensureSeedData() {
  const email = 'demo@tellimon.com'
  let user = await User.findOne({ email })

  if (!user) {
    const hash = await bcrypt.hash('demo123', 10)
    user = await User.create({
      name: 'demo demo',
      email,
      password: hash,
      initials: 'DD',
    })
    console.log('Seeded demo user:', email)
  }

  const targetCount = await Target.countDocuments({ userId: user._id })
  if (targetCount === 0) {
    await Target.insertMany([
      { userId: user._id, name: 'US East List', count: 120 },
      { userId: user._id, name: 'VIP Callbacks', count: 45 },
    ])
    console.log('Seeded demo targets')
  }
}
