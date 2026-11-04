/**
 * In-browser mock of the webhook backend, mirroring the real contract (docs/api.md):
 *  GET  /                              -> 200 { status, current_time }
 *  POST /v1/webhooks/transactions      -> 202 { status: 'accepted'|'duplicate' } | 409 | 422
 *  GET  /v1/transactions/{id}?currency -> 200 [record] (one-element array, like the real backend) | 404
 *  GET  /v1/transactions?status&limit&currency -> 200 { items, total, limit, offset }
 *  GET  /v1/currencies, GET /v1/stats
 * Status is derived lazily: PROCESSED once `mockDelaySeconds` have elapsed.
 * A transaction_id containing "fail" ends as FAILED, to demo that state.
 * The mock plays the server, so it does the conversion; the real UI never does.
 */
import { prefsStore } from '@/lib/prefsStore'
import { percentile, sleep } from '@/lib/utils'

const STORAGE_KEY = 'txn-dashboard:mock-db'
const REQUIRED = ['transaction_id', 'source_account', 'destination_account', 'amount', 'currency']
const RATES_TO_INR = { INR: 1, USD: 94.75, EUR: 106.08, GBP: 127.14 }
const RATES_AS_OF = '2026-11-03'
const SUPPORTED = Object.keys(RATES_TO_INR)
const STARTED_AT = Date.now()

function loadDb() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}
let db = loadDb()
const saveDb = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    /* ignore */
  }
}

const counters = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 }
const acks = [] // server-side ms of recent webhooks, newest last

/** Banker's rounding to 2 decimals (mock only; the real backend does this server-side). */
function round2(x) {
  const scaled = x * 100
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  const rounded = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled)
  return rounded / 100
}

function materialize(row, currency) {
  const delayMs = row.delaySeconds * 1000
  const created = new Date(row.created_at).getTime()
  const finished = Date.now() - created >= delayMs
  const failed = finished && /fail/i.test(row.transaction_id)
  const status = !finished ? 'PROCESSING' : failed ? 'FAILED' : 'PROCESSED'
  const rate = RATES_TO_INR[row.currency]
  const shownCurrency = currency || row.currency
  const shown = shownCurrency === row.currency ? row.amount : round2((row.amount * rate) / RATES_TO_INR[shownCurrency])
  return {
    transaction_id: row.transaction_id,
    source_account: row.source_account,
    destination_account: row.destination_account,
    amount: shown,
    currency: shownCurrency,
    original_amount: row.amount,
    original_currency: row.currency,
    amount_inr: status === 'PROCESSED' ? Math.round(row.amount * rate * 10000) / 10000 : null,
    fx_rate_to_inr: status === 'PROCESSED' ? rate : null,
    fx_rate_as_of: status === 'PROCESSED' ? RATES_AS_OF : null,
    status,
    attempts: failed ? 3 : 1,
    last_error: failed ? 'Simulated failure (mock)' : null,
    created_at: row.created_at,
    processed_at: status === 'PROCESSED' ? new Date(created + delayMs).toISOString() : null,
  }
}

const json = (status, data, serverMs) => ({ status, data, serverMs })
const fakeServerMs = () => Math.round((2 + Math.random() * 10) * 10) / 10

function validate(body) {
  const errors = REQUIRED.filter((k) => body?.[k] === undefined || body?.[k] === '').map((k) => ({
    loc: ['body', k],
    msg: 'Field required',
    type: 'missing',
  }))
  if (!errors.length) {
    if (!(typeof body.amount === 'number' && body.amount > 0)) errors.push({ loc: ['body', 'amount'], msg: 'Input should be greater than 0', type: 'greater_than' })
    if (!SUPPORTED.includes(body.currency)) errors.push({ loc: ['body', 'currency'], msg: `Unsupported currency. Supported: ${SUPPORTED.join(', ')}`, type: 'value_error' })
  }
  return errors
}

const samePayload = (row, body) =>
  row.source_account === body.source_account &&
  row.destination_account === body.destination_account &&
  row.amount === Number(body.amount) &&
  row.currency === body.currency

export async function mockFetch(method, path, body) {
  await sleep(20 + Math.random() * 130) // simulated network latency

  const url = new URL(path, 'http://mock.local')
  const p = url.pathname.replace(/\/+$/, '') || '/'
  const serverMs = fakeServerMs()

  if (method === 'GET' && p === '/') {
    return json(200, { status: 'HEALTHY', current_time: new Date().toISOString() }, serverMs)
  }

  if (method === 'POST' && p === '/v1/webhooks/transactions') {
    acks.push(serverMs)
    if (acks.length > 200) acks.shift()
    const errors = validate(body)
    if (errors.length) {
      counters.rejected++
      return json(422, { detail: errors }, serverMs)
    }
    const id = body.transaction_id
    if (!db[id]) {
      db[id] = { ...body, amount: Number(body.amount), created_at: new Date().toISOString(), delaySeconds: prefsStore.get().mockDelaySeconds }
      saveDb()
      counters.accepted++
      return json(202, { status: 'accepted', transaction_id: id }, serverMs)
    }
    if (!samePayload(db[id], body)) {
      counters.conflict++
      return json(409, { detail: 'transaction_id already exists with a different payload', transaction_id: id }, serverMs)
    }
    counters.duplicate++
    return json(202, { status: 'duplicate', transaction_id: id }, serverMs)
  }

  if (method === 'GET' && p === '/v1/transactions') {
    const status = url.searchParams.get('status')
    const currency = url.searchParams.get('currency')
    const limit = Number(url.searchParams.get('limit')) || 20
    const offset = Number(url.searchParams.get('offset')) || 0
    let rows = Object.values(db).map((r) => materialize(r, currency))
    if (status) rows = rows.filter((r) => r.status === status)
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return json(200, { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }, serverMs)
  }

  if (method === 'GET' && p === '/v1/currencies') {
    return json(
      200,
      { base: 'INR', supported: SUPPORTED, rates_to_inr: RATES_TO_INR, as_of: RATES_AS_OF, display_decimals: 2, rounding: 'ROUND_HALF_EVEN' },
      serverMs,
    )
  }

  if (method === 'GET' && p === '/v1/stats') return json(200, mockStats(), serverMs)

  const match = p.match(/^\/v1\/transactions\/([^/]+)$/)
  if (method === 'GET' && match) {
    const row = db[decodeURIComponent(match[1])]
    return row ? json(200, [materialize(row, url.searchParams.get('currency'))], serverMs) : json(404, { detail: 'Transaction not found' }, serverMs)
  }

  return json(404, { detail: 'Not found' }, serverMs)
}

function mockStats() {
  const rows = Object.values(db).map((r) => materialize(r, null))
  const count = (s) => rows.filter((r) => r.status === s).length
  const processing = rows.filter((r) => r.status === 'PROCESSING')
  const oldest = processing.length ? Math.min(...processing.map((r) => new Date(r.created_at).getTime())) : null
  const sorted = [...acks].sort((a, b) => a - b)
  return {
    as_of: new Date().toISOString(),
    uptime_seconds: Math.round((Date.now() - STARTED_AT) / 100) / 10,
    transactions: { processing: processing.length, processed: count('PROCESSED'), failed: count('FAILED'), total: rows.length },
    in_flight_jobs: processing.length,
    oldest_processing_age_seconds: oldest ? Math.round((Date.now() - oldest) / 100) / 10 : null,
    avg_processing_seconds: rows.some((r) => r.status === 'PROCESSED') ? prefsStore.get().mockDelaySeconds : null,
    webhooks: {
      window: sorted.length,
      ...counters,
      ack_ms: sorted.length ? { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] } : { p50: null, p95: null, max: null },
      over_budget_pct: 0,
      per_minute: sorted.length,
    },
    db: { api_pool_max: 3, api_in_use: 1, worker_pool_max: 5, worker_in_use: processing.length ? 1 : 0 },
    config: { processing_delay_seconds: prefsStore.get().mockDelaySeconds, latency_budget_ms: 500 },
  }
}

export function resetMockDb() {
  db = {}
  saveDb()
}
