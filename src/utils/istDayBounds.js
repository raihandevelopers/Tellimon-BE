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

/** Dashboard day window: 8:00 AM IST → 8:00 AM IST next day. */
export function getIstBusinessDayBounds(now = new Date(), resetHour = RESET_HOUR) {
  const today = istYmd(now)
  const hour = istHour(now)

  let startYmd = today
  if (hour < resetHour) {
    startYmd = addIstDays(today, -1)
  }

  const endYmd = addIstDays(startYmd, 1)
  const start = istDateTime(startYmd, resetHour)
  const end = istDateTime(endYmd, resetHour)

  return {
    start,
    end,
    resetHour,
    label: `${formatIstLabel(start)} – ${formatIstLabel(end)} IST`,
  }
}

export function callPeriodExprFilter(start, end) {
  return {
    $expr: {
      $and: [
        { $gte: [{ $ifNull: ['$startedAt', '$createdAt'] }, start] },
        { $lt: [{ $ifNull: ['$startedAt', '$createdAt'] }, end] },
      ],
    },
  }
}
