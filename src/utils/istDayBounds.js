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
 * Business-day range for report filters.
 * - no from/to → current 8 AM → next 8 AM window
 * - from only → that day 8 AM through end of current business day
 * - to only → that single business day (8 AM → next 8 AM)
 * - from+to → from @ 8 AM through end of `to` business day
 */
export function getIstBusinessRange({ from, to } = {}, now = new Date(), resetHour = RESET_HOUR) {
  const fromOk = /^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))
  const toOk = /^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))

  if (!fromOk && !toOk) {
    return getIstBusinessDayBounds(now, resetHour)
  }

  let startYmd = fromOk ? from : to
  let endDayYmd = toOk ? to : from

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
