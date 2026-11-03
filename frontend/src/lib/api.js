/**
 * API client for the webhook backend. Every call is timed and recorded in the
 * request log. Calls never throw: they resolve to
 *   { ok, status, data, latencyMs, error }
 * where status 0 means a network/CORS failure.
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

  if (mock) {
    const res = await mockFetch(method, path, body)
    result = { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data, error: null }
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
  requestLog.add({
    method,
    path,
    status: result.status,
    latencyMs: result.latencyMs,
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

// ---- Endpoints -------------------------------------------------------------

export const getHealth = (opts) => request('GET', '/', { tag: 'poll', ...opts })

export const sendWebhook = (payload) => request('POST', '/v1/webhooks/transactions', { body: payload })

/** Resolves with `records` (always an array; backend returns a list). 404 → []. */
export async function getTransaction(id, opts) {
  const res = await request('GET', `/v1/transactions/${encodeURIComponent(id)}`, opts)
  return { ...res, records: res.ok ? asArray(res.data) : [] , notFound: res.status === 404 }
}

/**
 * List endpoint (requested from the backend). `unsupported` is true when the
 * backend doesn't implement it yet (404/405), so the UI can fall back.
 */
export async function listTransactions({ status, limit = 50 } = {}, opts) {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (status) qs.set('status', status)
  const res = await request('GET', `/v1/transactions?${qs}`, opts)
  return {
    ...res,
    records: res.ok ? asArray(res.data) : [],
    unsupported: res.status === 404 || res.status === 405,
  }
}
