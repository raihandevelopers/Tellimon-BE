import User from '../models/User.js'
import DID from '../models/DID.js'
import WalletTransaction from '../models/WalletTransaction.js'
import { didNumberVariants } from './roles.js'

export const DEFAULT_WALLET_CALL_RATES = {
  answeredPerMinute: 1,
  missed: 1,
  noAnswer: 1,
  busy: 1,
  failed: 1,
}

function roundAmount(value) {
  return Math.round(Number(value) * 100) / 100
}

export function normalizeWalletCallRates(raw = {}) {
  const pick = (key, fallback) => {
    const value = Number(raw[key])
    return Number.isFinite(value) && value >= 0 ? roundAmount(value) : fallback
  }

  return {
    answeredPerMinute: pick('answeredPerMinute', DEFAULT_WALLET_CALL_RATES.answeredPerMinute),
    missed: pick('missed', DEFAULT_WALLET_CALL_RATES.missed),
    noAnswer: pick('noAnswer', DEFAULT_WALLET_CALL_RATES.noAnswer),
    busy: pick('busy', DEFAULT_WALLET_CALL_RATES.busy),
    failed: pick('failed', DEFAULT_WALLET_CALL_RATES.failed),
  }
}

export async function getTenantWalletCallRates(tenantUserId) {
  const master = await User.findById(tenantUserId).select('walletCallRates')
  return normalizeWalletCallRates(master?.walletCallRates)
}

export function callChargeAmount(billsec = 0, status = '', rates = null) {
  const r = normalizeWalletCallRates(rates)
  const normalizedStatus = String(status || 'missed').toLowerCase()

  if (normalizedStatus === 'answered') {
    const seconds = Math.max(0, Number(billsec) || 0)
    const minutes = seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 1
    return roundAmount(minutes * r.answeredPerMinute)
  }

  const flatRates = {
    missed: r.missed,
    'no-answer': r.noAnswer,
    busy: r.busy,
    failed: r.failed,
  }

  return flatRates[normalizedStatus] ?? r.missed
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
  const callStatus = status || 'missed'
  const amount = callChargeAmount(billsec, callStatus, rates)
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
    description: `Call charge — ${didRecord.number} (${callStatus}, ${billsec || 0}s)`,
    actorName: 'System',
  })

  return tx
}
