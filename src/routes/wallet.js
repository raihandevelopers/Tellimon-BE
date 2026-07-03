import express from 'express'
import User from '../models/User.js'
import WalletTransaction from '../models/WalletTransaction.js'
import { authRequired } from '../middleware/auth.js'
import { toJSON, toJSONList } from '../config/db.js'
import { isMaster } from '../utils/roles.js'
import { creditWallet, getWalletBalance, getTenantWalletCallRates, normalizeWalletCallRates } from '../utils/wallet.js'
import { logActivity } from '../utils/logActivity.js'

const router = express.Router()

router.use(authRequired)

function requireMaster(req, res, next) {
  if (!isMaster(req.userRole)) {
    return res.status(403).json({ error: 'Only master accounts can manage customer wallets' })
  }
  next()
}

router.get('/', async (req, res) => {
  try {
    const callRates = await getTenantWalletCallRates(req.userId)

    if (isMaster(req.userRole)) {
      const customers = await User.find({ ownerId: req.authUserId, role: 'customer' })
        .select('name email walletBalance')
        .sort({ name: 1 })
      const totalBalance = customers.reduce((sum, c) => sum + Number(c.walletBalance || 0), 0)
      return res.json({
        role: 'master',
        totalCustomerBalance: Math.round(totalBalance * 100) / 100,
        callRates,
        customers: customers.map((c) => ({
          id: String(c._id),
          name: c.name,
          email: c.email,
          balance: Math.round(Number(c.walletBalance || 0) * 100) / 100,
        })),
      })
    }

    const balance = await getWalletBalance(req.authUserId)
    res.json({ role: 'customer', balance, callRates })
  } catch (err) {
    console.error('Wallet balance error:', err)
    res.status(500).json({ error: 'Failed to fetch wallet balance' })
  }
})

router.get('/transactions', async (req, res) => {
  try {
    const { customerId, page = 1, limit = 20 } = req.query
    const filter = { userId: req.userId }

    if (isMaster(req.userRole)) {
      if (customerId) {
        const owned = await User.findOne({
          _id: customerId,
          role: 'customer',
          ownerId: req.authUserId,
        })
        if (!owned) return res.status(404).json({ error: 'Customer not found' })
        filter.customerId = customerId
      }
    } else {
      filter.customerId = req.authUserId
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit)
    const [transactions, total] = await Promise.all([
      WalletTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      WalletTransaction.countDocuments(filter),
    ])

    res.json({
      transactions: toJSONList(transactions),
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    })
  } catch (err) {
    console.error('Wallet transactions error:', err)
    res.status(500).json({ error: 'Failed to fetch wallet transactions' })
  }
})

router.post('/recharge', requireMaster, async (req, res) => {
  try {
    const { customerId, amount, note } = req.body
    if (!customerId || amount == null) {
      return res.status(400).json({ error: 'customerId and amount are required' })
    }

    const master = await User.findById(req.authUserId)
    const result = await creditWallet({
      tenantUserId: req.userId,
      customerId,
      amount,
      actorId: req.authUserId,
      actorName: master?.name,
      description: note?.trim() || 'Wallet recharge by admin',
    })

    await logActivity({
      userId: req.userId,
      actorName: master?.name,
      action: 'wallet_recharge',
      category: 'wallet',
      description: `Recharged customer wallet +${result.credited}`,
      metadata: { customerId, amount: result.credited },
    })

    res.json(result)
  } catch (err) {
    if (err.message === 'INVALID_AMOUNT') {
      return res.status(400).json({ error: 'Amount must be greater than zero' })
    }
    if (err.message === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ error: 'Customer not found' })
    }
    console.error('Wallet recharge error:', err)
    res.status(500).json({ error: 'Failed to recharge wallet' })
  }
})

router.put('/rates', requireMaster, async (req, res) => {
  try {
    const master = await User.findById(req.authUserId)
    if (!master) return res.status(404).json({ error: 'User not found' })

    const callRates = normalizeWalletCallRates({ ...master.walletCallRates?.toObject?.() ?? master.walletCallRates, ...req.body })
    master.walletCallRates = callRates
    await master.save()

    await logActivity({
      userId: req.userId,
      actorName: master.name,
      action: 'wallet_rates_updated',
      category: 'wallet',
      description: 'Updated wallet call charge rates',
      metadata: callRates,
    })

    res.json({ callRates })
  } catch (err) {
    console.error('Wallet rates error:', err)
    res.status(500).json({ error: 'Failed to update call rates' })
   }
})

export default router
