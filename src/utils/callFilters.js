export function istDayStart(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const d = new Date(`${dateStr}T00:00:00+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function istDayEnd(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const d = new Date(`${dateStr}T23:59:59.999+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function buildCallListFilter({ status, from, to, number } = {}) {
  const filter = {}

  if (status === 'missed') {
    filter.status = { $in: ['missed', 'no-answer', 'busy'] }
  } else if (status === 'unanswered') {
    filter.status = { $in: ['no-answer', 'busy'] }
  } else if (status === 'missed-only') {
    filter.status = { $in: ['missed', 'failed'] }
  } else if (status === 'answered') {
    filter.status = 'answered'
  } else if (status) {
    filter.status = status
  }

  const dateParts = []
  const start = from ? istDayStart(from) : null
  const end = to ? istDayEnd(to) : null
  if (start) {
    dateParts.push({ $gte: [{ $ifNull: ['$startedAt', '$createdAt'] }, start] })
  }
  if (end) {
    dateParts.push({ $lte: [{ $ifNull: ['$startedAt', '$createdAt'] }, end] })
  }
  if (dateParts.length) {
    filter.$expr = dateParts.length === 1 ? dateParts[0] : { $and: dateParts }
  }

  const digits = String(number || '').replace(/\D/g, '')
  if (digits) {
    const regex = new RegExp(digits)
    filter.$or = [{ caller: regex }, { did: regex }, { buyerNumber: regex }]
  }

  return filter
}

export function buildCallDateFilter({ from, to } = {}) {
  return buildCallListFilter({ from, to })
}
