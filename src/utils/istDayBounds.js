import { hasTimeComponent, parseIstBound } from './callFilters.js'

const IST = 'Asia/Kolkata'
const RESET_HOUR = 8

function istYmd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(date)
}

function istHour(date) {
  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: 'numeric',
    hour12: false,
  })
    .formatToParts(date)
    .find((p) => p.type === 'hour')
  return Number(part?.value ?? 0)
}

function addIstDays(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number)
  const noonIst = new Date(Date.UTC(y, m - 1, d, 6, 30, 0))
  noonIst.setUTCDate(noonIst.getUTCDate() + delta)
  return istYmd(noonIst)
}

function istDateTime(ymd, hour, minute = 0, second = 0) {
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  const ss = String(second).padStart(2, '0')
  return new Date(`${ymd}T${hh}:${mm}:${ss}+05:30`)
}

function formatIstLabel(date) {
  return date.toLocaleString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function businessBoundsForStartYmd(startYmd, resetHour = RESET_HOUR) {
  const endYmd = addIstDays(startYmd, 1)
  const start = istDateTime(startYmd, resetHour)
  const end = istDateTime(endYmd, resetHour)
  return {
    start,
    end,
    resetHour,
    startYmd,
    endYmd,
    label: `${formatIstLabel(start)} – ${formatIstLabel(end)} IST`,
  }
}

/** Dashboard / reports day window: 8:00 AM IST → 8:00 AM IST next day. */
export function getIstBusinessDayBounds(now = new Date(), resetHour = RESET_HOUR) {
  const today = istYmd(now)
  const hour = istHour(now)

  let startYmd = today
  if (hour < resetHour) {
    startYmd = addIstDays(today, -1)
  }

  return businessBoundsForStartYmd(startYmd, resetHour)
}

/**
 * Range for buyer/report filters.
 * - no from/to → current 8 AM → next 8 AM window
 * - date-only from/to → business-day window (8 AM boundaries)
 * - datetime from/to → exact IST timestamps
 */
export function getIstBusinessRange({ from, to } = {}, now = new Date(), resetHour = RESET_HOUR) {
  const fromRaw = String(from || '').trim()
  const toRaw = String(to || '').trim()
  const fromDt = fromRaw ? parseIstBound(fromRaw, { end: false }) : null
  const toDt = toRaw ? parseIstBound(toRaw, { end: true }) : null

  if (!fromDt && !toDt) {
    return getIstBusinessDayBounds(now, resetHour)
  }

  // Exact clock times when either side includes HH:mm
  if (hasTimeComponent(fromRaw) || hasTimeComponent(toRaw)) {
    let start = fromDt
    let end = toDt
    if (start && end && start > end) {
      const tmp = start
      start = end
      end = tmp
    }
    if (!start && end) {
      start = parseIstBound(istYmd(end), { end: false })
    }
    if (start && !end) {
      end = now
      if (end < start) end = start
    }
    return {
      start,
      end,
      resetHour,
      startYmd: istYmd(start),
      endYmd: istYmd(end),
      label: `${formatIstLabel(start)} – ${formatIstLabel(end)} IST`,
    }
  }

  const fromOk = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw)
  const toOk = /^\d{4}-\d{2}-\d{2}$/.test(toRaw)

  let startYmd = fromOk ? fromRaw : toRaw
  let endDayYmd = toOk ? toRaw : fromRaw

  // from only → through today's business day
  if (fromOk && !toOk) {
    const current = getIstBusinessDayBounds(now, resetHour)
    endDayYmd = current.startYmd
    if (startYmd > endDayYmd) endDayYmd = startYmd
  }

  if (startYmd > endDayYmd) {
    const tmp = startYmd
    startYmd = endDayYmd
    endDayYmd = tmp
  }

  const start = istDateTime(startYmd, resetHour)
  const end = istDateTime(addIstDays(endDayYmd, 1), resetHour)

  return {
    start,
    end,
    resetHour,
    startYmd,
    endYmd: addIstDays(endDayYmd, 1),
    label: `${formatIstLabel(start)} – ${formatIstLabel(end)} IST`,
  }
}

export function callPeriodExprFilter(start, end) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  return {
    $expr: {
      $and: [
        { $gte: [{ $ifNull: ['$startedAt', '$createdAt'] }, startDate] },
        { $lt: [{ $ifNull: ['$startedAt', '$createdAt'] }, endDate] },
      ],
    },
  }
}
