import { BASE_CURRENCY, CURRENCIES, RATES_FROM_INR } from '@/config/currency'

export function convertFromInr(amountInr, currency) {
  const rate = RATES_FROM_INR[currency] ?? 1
  return Number(amountInr) * rate
}

export function formatCurrency(amount, currency) {
  const meta = CURRENCIES[currency] ?? CURRENCIES[BASE_CURRENCY]
  return new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency: meta.code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Seconds between two ISO timestamps, or null. */
export function durationSeconds(startIso, endIso) {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  return Number.isFinite(ms) ? ms / 1000 : null
}

export function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}
