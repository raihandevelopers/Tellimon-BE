import User from '../models/User.js'
import DID from '../models/DID.js'
import WalletTransaction from '../models/WalletTransaction.js'
import { didNumberVariants } from './roles.js'

export const BILLING_PULSE_SECONDS = 6
export const DEFAULT_WALLET_RATE_PER_MINUTE = 0.0024

function roundBalance(value) {
  return Math.round(Number(value) * 1e6) / 1e6
}

function roundCharge(value) {
  return Math.round(Number(value) * 1e6) / 1e6
}

/** Bill talk time in 6-second pulses (6+6 rule): min 6s when billsec > 0, then ceil to next 6s block. */
export function billableSeconds6x6(billsec) {
  const sec = Math.max(0, Math.floor(Number(billsec) || 0))
  if (sec <= 0) return 0
  return Math.max(BILLING_PULSE_SECONDS, Math.ceil(sec / BILLING_PULSE_SECONDS) * BILLING_PULSE_SECONDS)
}

export function normalizeWalletCallRates(raw = {}) {
  let value = Number(raw.perMinute)
  if (!Number.isFinite(value) || value < 0) {
    value = Number(raw.answeredPerMinute ?? raw.perCall ?? DEFAULT_WALLET_RATE_PER_MINUTE)
  }
  if (!Number.isFinite(value) || value < 0) value = DEFAULT_WALLET_RATE_PER_MINUTE
  return { perMinute: roundCharge(value) }
}

export async function getTenantWalletCallRates(tenantUserId) {
  const master = await User.findById(tenantUserId).select('walletCallRates')
  return normalizeWalletCallRates(master?.walletCallRates)
}

export function callChargeAmount(billsec = 0, _status = '', rates = null) {
  const { perMinute } = normalizeWalletCallRates(rates)
  if (perMinute <= 0) return 0

  const billedSeconds = billableSeconds6x6(billsec)
  if (billedSeconds <= 0) return 0

  return roundCharge((billedSeconds / 60) * perMinute)
}

export async function getWalletBalance(customerId) {
  const user = await User.findById(customerId).select('walletBalance role')
  if (!user || user.role !== 'customer') return 0
  return roundBalance(user.walletBalance || 0)
}

export async function creditWallet({
  tenantUserId,
  customerId,
  amount,
  actorId,
  actorName,
  description = 'Wallet recharge',
}) {
  const value = roundBalance(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('INVALID_AMOUNT')
  }

  const customer = await User.findOne({
    _id: customerId,
    role: 'customer',
    ownerId: tenantUserId,
  })
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND')

  const balanceAfter = roundBalance(Number(customer.walletBalance || 0) + value)
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
  const { perMinute } = rates
  const rawBillsec = Math.max(0, Number(billsec) || 0)
  const billedSeconds = billableSeconds6x6(rawBillsec)
  const amount = callChargeAmount(rawBillsec, status, rates)
  if (amount <= 0) return null

  const existing = await WalletTransaction.findOne({
    callId,
    type: 'debit',
  })
  if (existing) return existing

  const customer = await User.findById(didRecord.assignedCustomerId)
  if (!customer) return null

  const balanceAfter = roundBalance(Number(customer.walletBalance || 0) - amount)
  customer.walletBalance = balanceAfter
  await customer.save()

  const tx = await WalletTransaction.create({
    userId: tenantUserId,
    customerId: customer._id,
    type: 'debit',
    amount,
    balanceAfter,
    callId,
    did: didRecord.number,
    billsec: rawBillsec,
    description: `Call charge — ${didRecord.number} (${billedSeconds}s @ $${perMinute}/min, 6+6)`,
    actorName: 'System',
  })

  return tx
}
