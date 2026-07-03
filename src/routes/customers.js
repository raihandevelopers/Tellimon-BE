import express from 'express'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import DID from '../models/DID.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON } from '../config/db.js'
import { logActivity } from '../utils/logActivity.js'
import { isMaster } from '../utils/roles.js'

const router = express.Router()

router.use(authRequired)

function requireMaster(req, res, next) {
  if (!isMaster(req.userRole)) {
    return res.status(403).json({ error: 'Customer management is only available to master accounts' })
  }
  next()
}

router.use(requireMaster)

function publicCustomer(user) {
  const u = toJSON(user)
  delete u.password
  return u
}

async function ownedCustomer(masterId, customerId) {
  return User.findOne({ _id: customerId, role: 'customer', ownerId: masterId })
}

async function enrichCustomer(customer) {
  const json = publicCustomer(customer)
  json.walletBalance = Math.round(Number(customer.walletBalance || 0) * 1e6) / 1e6
  const dids = await DID.find({ assignedCustomerId: customer._id }).select(
    'number status id customerDisplayNumber'
  )
  json.assignedDids = dids.map((d) => ({
    id: String(d._id),
    number: d.number,
    displayNumber: d.customerDisplayNumber || '',
    status: d.status,
  }))
  return json
}

function parseDidAssignments(body) {
  if (Array.isArray(body.didAssignments)) {
    return body.didAssignments
      .filter((a) => a?.didId)
      .map((a) => ({
        didId: String(a.didId),
        displayNumber: String(a.displayNumber || '').trim(),
      }))
  }
  if (Array.isArray(body.didIds)) {
    return body.didIds.map((id) => ({ didId: String(id), displayNumber: '' }))
  }
  return undefined
}

async function setCustomerDids(masterTenantId, customerId, didAssignments = []) {
  const uniqueIds = [...new Set((didAssignments || []).map((a) => String(a.didId)).filter(Boolean))]

  // Drop this customer's current assignments first.
  await DID.updateMany(
    { userId: masterTenantId, assignedCustomerId: customerId },
    { $unset: { assignedCustomerId: 1, customerDisplayNumber: 1 } }
  )

  if (!uniqueIds.length) return

  const dids = await DID.find({
    _id: { $in: uniqueIds },
    userId: masterTenantId,
    isMain: { $ne: true },
  })
  if (dids.length !== uniqueIds.length) {
    throw new Error('INVALID_DIDS')
  }

  // Clear these DIDs from any other customer before reassigning.
  await DID.updateMany(
    { userId: masterTenantId, _id: { $in: uniqueIds } },
    { $unset: { assignedCustomerId: 1, customerDisplayNumber: 1 } }
  )

  for (const { didId, displayNumber } of didAssignments) {
    const update = { assignedCustomerId: customerId }
    if (displayNumber) {
      update.customerDisplayNumber = displayNumber
    } else {
      update.customerDisplayNumber = ''
    }
    await DID.updateOne({ _id: didId, userId: masterTenantId }, { $set: update })
  }
}

router.get('/', async (req, res) => {
  try {
    const customers = await User.find({ ownerId: req.authUserId, role: 'customer' }).sort({
      createdAt: -1,
    })
    const enriched = await Promise.all(customers.map((c) => enrichCustomer(c)))
    res.json(enriched)
  } catch (err) {
    console.error('List customers error:', err)
    res.status(500).json({ error: 'Failed to fetch customers' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, email, password, didIds, didAssignments } = req.body
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' })
    }

    const initials = name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'CU'

    const hash = await bcrypt.hash(password, 10)
    const customer = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hash,
      initials,
      role: 'customer',
      ownerId: req.authUserId,
    })

    const assignments = parseDidAssignments({ didIds, didAssignments })
    try {
      await setCustomerDids(req.userId, customer._id, assignments ?? [])
    } catch {
      await User.findByIdAndDelete(customer._id)
      return res.status(400).json({ error: 'One or more DIDs could not be assigned' })
    }

    const master = await User.findById(req.authUserId)
    await logActivity({
      userId: req.userId,
      actorName: master?.name,
      action: 'customer_created',
      category: 'auth',
      description: `Customer ${customer.email} created`,
    })

    res.status(201).json(await enrichCustomer(customer))
  } catch (err) {
    console.error('Create customer error:', err)
    res.status(500).json({ error: 'Failed to create customer' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const customer = await ownedCustomer(req.authUserId, req.params.id)
    if (!customer) return res.status(404).json({ error: 'Customer not found' })

    const { name, password, didIds, didAssignments } = req.body
    if (name?.trim()) customer.name = name.trim()
    if (password) customer.password = await bcrypt.hash(password, 10)
    await customer.save()

    if (didIds !== undefined || didAssignments !== undefined) {
      const assignments = parseDidAssignments({ didIds, didAssignments })
      try {
        await setCustomerDids(req.userId, customer._id, assignments ?? [])
      } catch {
        return res.status(400).json({ error: 'One or more DIDs could not be assigned' })
      }
    }

    const master = await User.findById(req.authUserId)
    await logActivity({
      userId: req.userId,
      actorName: master?.name,
      action: 'customer_updated',
      category: 'auth',
      description: `Customer ${customer.email} updated`,
    })

    res.json(await enrichCustomer(customer))
  } catch (err) {
    console.error('Update customer error:', err)
    res.status(500).json({ error: 'Failed to update customer' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const customer = await ownedCustomer(req.authUserId, req.params.id)
    if (!customer) return res.status(404).json({ error: 'Customer not found' })

    await DID.updateMany(
      { userId: req.userId, assignedCustomerId: customer._id },
      { $unset: { assignedCustomerId: 1, customerDisplayNumber: 1 } }
    )
    await User.findByIdAndDelete(customer._id)

    const master = await User.findById(req.authUserId)
    await logActivity({
      userId: req.userId,
      actorName: master?.name,
      action: 'customer_deleted',
      category: 'auth',
      description: `Customer ${customer.email} removed`,
    })

    res.json({ success: true })
  } catch (err) {
    console.error('Delete customer error:', err)
    res.status(500).json({ error: 'Failed to delete customer' })
  }
})

export default router
