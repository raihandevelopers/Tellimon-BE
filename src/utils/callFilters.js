/**
 * Parse report filter bounds as Asia/Kolkata (IST).
 * Accepts:
 * - YYYY-MM-DD
 * - YYYY-MM-DDTHH:mm
 * - YYYY-MM-DDTHH:mm:ss
 * - same with a space instead of T
 */
export function parseIstBound(raw, { end = false } = {}) {
  const s = String(raw || '')
    .trim()
    .replace(' ', 'T')
  if (!s) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(end ? `${s}T23:59:59.999+05:30` : `${s}T00:00:00+05:30`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
  if (!m) return null

  const [, ymd, hh, mm, ss] = m
  let second = ss
  if (second == null) {
    second = end ? '59' : '00'
  }
  const frac = end && ss == null ? '.999' : ''
  const d = new Date(`${ymd}T${hh}:${mm}:${second}${frac}+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function hasTimeComponent(raw) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(raw || '').trim())
}

export function istDayStart(dateStr) {
  return parseIstBound(dateStr, { end: false })
}

export function istDayEnd(dateStr) {
  return parseIstBound(dateStr, { end: true })
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
  let start = from ? parseIstBound(from, { end: false }) : null
  let end = to ? parseIstBound(to, { end: true }) : null
  if (start && end && start > end) {
    const tmp = start
    start = end
    end = tmp
  }
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
