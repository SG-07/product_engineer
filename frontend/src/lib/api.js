/**
 * API client for the webhook backend. Every call is timed and recorded in the
 * request log. Calls never throw: they resolve to
 *   { ok, status, data, latencyMs, error }
 * where status 0 means a network/CORS failure. `serverMs` is the backend's own
 * X-Response-Time-Ms header; `networkMs` is latencyMs minus serverMs.
 */
import { mockFetch } from '@/lib/mockApi'
import { prefsStore } from '@/lib/prefsStore'
import { requestLog } from '@/lib/requestLog'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '')
const TIMEOUT_MS = 15000

export const isMockMode = () => prefsStore.get().useMock

/**
 * @param {'GET'|'POST'} method
 * @param {string} path
 * @param {{ body?: object, tag?: string }} [opts] tag: 'poll' marks background polling calls
 */
export async function request(method, path, { body, tag } = {}) {
  const mock = isMockMode()
  const startedAt = new Date().toISOString()
  const t0 = performance.now()
  let result
  let serverMs = null

  if (mock) {
    const res = await mockFetch(method, path, body)
    result = { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data, error: null }
    serverMs = res.serverMs ?? null
  } else {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      const header = res.headers.get('x-response-time-ms')
      serverMs = header != null && Number.isFinite(Number(header)) ? Number(header) : null
      const text = await res.text()
      let data = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }
      result = { ok: res.ok, status: res.status, data, error: res.ok ? null : extractError(data, res.status) }
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      result = {
        ok: false,
        status: 0,
        data: null,
        error: aborted ? `Timed out after ${TIMEOUT_MS / 1000}s` : 'Network error (backend unreachable or CORS blocked)',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  result.latencyMs = performance.now() - t0
  result.serverMs = serverMs
  result.networkMs = serverMs != null ? Math.max(0, result.latencyMs - serverMs) : null
  requestLog.add({
    method,
    path,
    status: result.status,
    latencyMs: result.latencyMs,
    serverMs: result.serverMs,
    networkMs: result.networkMs,
    startedAt,
    requestBody: body ?? null,
    responseBody: result.data,
    error: result.error,
    mock,
    tag: tag ?? null,
  })
  return result
}

function extractError(data, status) {
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
    if (data.message) return data.message
    if (data.error) return String(data.error)
  }
  return `HTTP ${status}`
}

const asArray = (data) => (Array.isArray(data) ? data : data ? [data] : [])

function query(params) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, String(v)))
  const s = q.toString()
  return s ? `?${s}` : ''
}

// ---- Endpoints -------------------------------------------------------------

export const getHealth = (opts) => request('GET', '/', { tag: 'poll', ...opts })

export const sendWebhook = (payload) => request('POST', '/v1/webhooks/transactions', { body: payload })

/**
 * One transaction. `currency` is the display currency: the backend converts and
 * rounds, the browser never does. Resolves with `records` (array of 0 or 1).
 */
export async function getTransaction(id, { currency, ...opts } = {}) {
  const res = await request('GET', `/v1/transactions/${encodeURIComponent(id)}${query({ currency })}`, opts)
  return { ...res, records: res.ok ? asArray(res.data) : [], notFound: res.status === 404 }
}

/** Newest-first list. The backend returns { items, total, limit, offset }. */
export async function listTransactions({ status, limit = 50, offset, currency } = {}, opts) {
  const res = await request('GET', `/v1/transactions${query({ limit, offset, status, currency })}`, opts)
  const records = res.ok ? (Array.isArray(res.data) ? res.data : (res.data?.items ?? [])) : []
  return { ...res, records, total: res.ok ? (res.data?.total ?? records.length) : 0 }
}

export const getStats = (opts) => request('GET', '/v1/stats', { tag: 'poll', ...opts })

export const getCurrencies = (opts) => request('GET', '/v1/currencies', { tag: 'poll', ...opts })
