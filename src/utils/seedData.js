import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import Target from '../models/Target.js'
import Campaign from '../models/Campaign.js'
import DID from '../models/DID.js'

export async function ensureSeedData() {
  const email = 'admin'
  let user = await User.findOne({
    $or: [{ email: 'admin' }, { email: 'demo@tellimon.com' }],
  })

  if (!user) {
    const hash = await bcrypt.hash('CloudEcode#@110123', 10)
    user = await User.create({
      name: 'Admin',
      email,
      password: hash,
      initials: 'AD',
      role: 'master',
    })
    console.log('Seeded master admin user:', email)
  } else {
    let changed = false
    if (user.email !== 'admin') {
      user.email = 'admin'
      changed = true
    }
    if (user.role !== 'master') {
      user.role = 'master'
      user.ownerId = undefined
      changed = true
    }
    if (user.name === 'demo demo' || !user.name) {
      user.name = 'Admin'
      user.initials = 'AD'
      changed = true
    }
    if (changed) {
      await user.save()
      console.log('Updated master admin user to', email)
    }
  }

  const customerEmail = 'customer@tellimon.com'
  let customer = await User.findOne({ email: customerEmail })
  if (!customer) {
    const hash = await bcrypt.hash('customer123', 10)
    customer = await User.create({
      name: 'Customer User',
      email: customerEmail,
      password: hash,
      initials: 'CU',
      role: 'customer',
      ownerId: user._id,
    })
    console.log('Seeded customer user:', customerEmail)
  } else if (!customer.ownerId) {
    customer.role = 'customer'
    customer.ownerId = user._id
    await customer.save()
    console.log('Linked customer user to demo tenant')
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
        isMain: number === '18889567021',
      })
      console.log('Seeded DID:', number)
    }
  }

  const mainDid = await DID.findOne({ userId: user._id, number: '18889567021' })
  if (mainDid && !mainDid.isMain) {
    mainDid.isMain = true
    await mainDid.save()
    console.log('Marked primary DID as main:', mainDid.number)
  }
}
