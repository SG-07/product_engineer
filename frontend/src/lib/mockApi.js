/**
 * In-browser mock of the webhook backend. Mirrors the contract in backend.md:
 *  GET  /                              -> 200 { status, current_time }
 *  POST /v1/webhooks/transactions      -> 202 (idempotent on transaction_id)
 *  GET  /v1/transactions/{id}          -> 200 [record] | 404
 *  GET  /v1/transactions?status&limit  -> 200 [records]
 * Status is derived lazily: PROCESSED once `mockDelaySeconds` have elapsed.
 */
import { prefsStore } from '@/lib/prefsStore'
import { sleep } from '@/lib/utils'

const STORAGE_KEY = 'txn-dashboard:mock-db'
const REQUIRED = ['transaction_id', 'source_account', 'destination_account', 'amount', 'currency']

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

function materialize(row) {
  const delayMs = row.delaySeconds * 1000
  const created = new Date(row.created_at).getTime()
  const done = Date.now() - created >= delayMs
  return {
    transaction_id: row.transaction_id,
    source_account: row.source_account,
    destination_account: row.destination_account,
    amount: row.amount,
    currency: row.currency,
    status: done ? 'PROCESSED' : 'PROCESSING',
    created_at: row.created_at,
    processed_at: done ? new Date(created + delayMs).toISOString() : null,
  }
}

const json = (status, data) => ({ status, data })

export async function mockFetch(method, path, body) {
  // Simulate network latency well under the 500 ms budget.
  await sleep(20 + Math.random() * 130)

  const url = new URL(path, 'http://mock.local')
  const p = url.pathname.replace(/\/+$/, '') || '/'

  if (method === 'GET' && p === '/') {
    return json(200, { status: 'HEALTHY', current_time: new Date().toISOString() })
  }

  if (method === 'POST' && p === '/v1/webhooks/transactions') {
    const missing = REQUIRED.filter((k) => body?.[k] === undefined || body?.[k] === '')
    if (missing.length) {
      return json(422, { detail: `Missing fields: ${missing.join(', ')}` })
    }
    const id = body.transaction_id
    if (!db[id]) {
      db[id] = {
        ...body,
        amount: Number(body.amount),
        created_at: new Date().toISOString(),
        delaySeconds: prefsStore.get().mockDelaySeconds,
      }
      saveDb()
      return json(202, { message: 'Accepted', transaction_id: id })
    }
    return json(202, { message: 'Already received', transaction_id: id, duplicate: true })
  }

  if (method === 'GET' && p === '/v1/transactions') {
    const status = url.searchParams.get('status')
    const limit = Number(url.searchParams.get('limit')) || 50
    let rows = Object.values(db).map(materialize)
    if (status) rows = rows.filter((r) => r.status === status)
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return json(200, rows.slice(0, limit))
  }

  const match = p.match(/^\/v1\/transactions\/([^/]+)$/)
  if (method === 'GET' && match) {
    const row = db[decodeURIComponent(match[1])]
    return row ? json(200, [materialize(row)]) : json(404, { detail: 'Transaction not found' })
  }

  return json(404, { detail: 'Not found' })
}

export function resetMockDb() {
  db = {}
  saveDb()
}
