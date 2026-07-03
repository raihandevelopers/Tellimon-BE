import User from '../models/User.js'
import DID from '../models/DID.js'
import WalletTransaction from '../models/WalletTransaction.js'
import { didNumberVariants } from './roles.js'

export const DEFAULT_WALLET_RATE_PER_CALL = 1

function roundAmount(value) {
  return Math.round(Number(value) * 100) / 100
}

export function normalizeWalletCallRates(raw = {}) {
  let value = Number(raw.perCall)
  if (!Number.isFinite(value) || value < 0) {
    value = Number(raw.answeredPerMinute ?? raw.missed ?? DEFAULT_WALLET_RATE_PER_CALL)
  }
  if (!Number.isFinite(value) || value < 0) value = DEFAULT_WALLET_RATE_PER_CALL
  return { perCall: roundAmount(value) }
}

export async function getTenantWalletCallRates(tenantUserId) {
  const master = await User.findById(tenantUserId).select('walletCallRates')
  return normalizeWalletCallRates(master?.walletCallRates)
}

export function callChargeAmount(_billsec = 0, _status = '', rates = null) {
  const { perCall } = normalizeWalletCallRates(rates)
  return perCall > 0 ? perCall : 0
}

export async function getWalletBalance(customerId) {
  const user = await User.findById(customerId).select('walletBalance role')
  if (!user || user.role !== 'customer') return 0
  return roundAmount(user.walletBalance || 0)
}

export async function creditWallet({
  tenantUserId,
  customerId,
  amount,
  actorId,
  actorName,
  description = 'Wallet recharge',
}) {
  const value = roundAmount(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('INVALID_AMOUNT')
  }

  const customer = await User.findOne({
    _id: customerId,
    role: 'customer',
    ownerId: tenantUserId,
  })
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND')

  const balanceAfter = roundAmount(Number(customer.walletBalance || 0) + value)
  customer.walletBalance = balanceAfter
  await customer.save()

  await WalletTransaction.create({
    userId: tenantUserId,
    customerId: customer._id,
    type: 'credit',
    amount: value,
    balanceAfter,
    description,
    actorId,
    actorName,
  })

  return { balance: balanceAfter, credited: value }
}

export async function debitForCall({
  tenantUserId,
  did,
  callId,
  billsec,
  status,
  uniqueId,
}) {
  if (!did || !callId) return null

  const variants = didNumberVariants(did)
  if (!variants.length) return null

  const didRecord = await DID.findOne({
    userId: tenantUserId,
    assignedCustomerId: { $ne: null },
    number: { $in: variants },
  })

  if (!didRecord?.assignedCustomerId) return null

  const rates = await getTenantWalletCallRates(tenantUserId)
  const customerId = didRecord.assignedCustomerId
  const amount = callChargeAmount(billsec, status, rates)
  if (amount <= 0) return null

  const existing = await WalletTransaction.findOne({
    callId,
    type: 'debit',
  })
  if (existing) return existing

  const customer = await User.findById(customerId)
  if (!customer) return null

  const balanceAfter = roundAmount(Number(customer.walletBalance || 0) - amount)
  customer.walletBalance = balanceAfter
  await customer.save()

  const tx = await WalletTransaction.create({
    userId: tenantUserId,
    customerId,
    type: 'debit',
    amount,
    balanceAfter,
    callId,
    did: didRecord.number,
    billsec: Math.max(0, Number(billsec) || 0),
    description: `Call charge — ${didRecord.number} (₹${amount}/call)`,
    actorName: 'System',
  })

  return tx
}
