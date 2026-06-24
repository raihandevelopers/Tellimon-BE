import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import Target from '../models/Target.js'
import Campaign from '../models/Campaign.js'
import DID from '../models/DID.js'

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

  let campaign = await Campaign.findOne({ userId: user._id, name: 'Default Forwarding' })
  if (!campaign) {
    campaign = await Campaign.create({
      userId: user._id,
      name: 'Default Forwarding',
      strategy: 'Priority',
      duplicateHandling: 'Normal',
      active: true,
    })
    console.log('Seeded default campaign')
  }

  for (const number of ['18889567021', '18889567022', '18889569295']) {
    const exists = await DID.findOne({ userId: user._id, number })
    if (!exists) {
      await DID.create({
        userId: user._id,
        number,
        status: 'Active',
        trunk: '8138073157',
        campaignId: campaign._id,
      })
      console.log('Seeded DID:', number)
    }
  }
}
