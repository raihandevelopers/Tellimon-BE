import DID from '../models/DID.js'
import { normalizeDidNumber, didNumberVariants } from './roles.js'

export async function loadCustomerDidDisplayMap(userId, authUserId) {
  const dids = await DID.find({ userId, assignedCustomerId: authUserId }).select(
    'number customerDisplayNumber'
  )
  const map = new Map()
  for (const d of dids) {
    const display = String(d.customerDisplayNumber || '').trim() || '—'
    for (const v of didNumberVariants(d.number)) {
      map.set(normalizeDidNumber(v), display)
      map.set(v, display)
    }
  }
  return map
}

export function maskDidForCustomer(realDid, map) {
  if (!realDid) return '—'
  const digits = normalizeDidNumber(realDid)
  return map.get(digits) || map.get(String(realDid)) || '—'
}

export function maskCallForCustomer(call, map) {
  const maskedDid = maskDidForCustomer(call.did, map)
  let description = call.description
  if (description && call.did) {
    const real = String(call.did)
    description = description.split(real).join(maskedDid)
    const digits = normalizeDidNumber(real)
    if (digits && digits !== real) {
      description = description.split(digits).join(maskedDid)
    }
  }
  return {
    ...call,
    did: maskedDid,
    ...(description !== undefined ? { description } : {}),
  }
}

export function sanitizeDidJsonForCustomer(json) {
  const display = String(json.customerDisplayNumber || '').trim() || '—'
  return {
    ...json,
    number: display,
    displayNumber: display === '—' ? '' : display,
    customerDisplayNumber: undefined,
  }
}

export function sanitizeDidJsonForMaster(json) {
  return {
    ...json,
    displayNumber: json.customerDisplayNumber || '',
  }
}
