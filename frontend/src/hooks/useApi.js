import { useQuery } from '@tanstack/react-query'
import { getHealth, getTransaction, listTransactions } from '@/lib/api'
import { sentStore } from '@/lib/sentStore'
import { runWithConcurrency } from '@/lib/utils'
import { HEALTH_POLL_MS, LIST_POLL_ACTIVE_MS, LIST_POLL_IDLE_MS, TXN_POLL_MS } from '@/config/app'
import { usePreferences } from '@/hooks/useStores'

export function useHealth() {
  const [{ useMock }] = usePreferences()
  return useQuery({
    queryKey: ['health', useMock],
    queryFn: () => getHealth(),
    refetchInterval: HEALTH_POLL_MS,
  })
}

/**
 * Polls a single transaction every 2s until it is PROCESSED.
 * data: { records, notFound, ok, status, error }
 */
export function useTransaction(id, { enabled = true } = {}) {
  const [{ useMock }] = usePreferences()
  return useQuery({
    queryKey: ['txn', useMock, id],
    queryFn: () => getTransaction(id, { tag: 'poll' }),
    enabled: Boolean(id) && enabled,
    refetchInterval: (query) => {
      const records = query.state.data?.records ?? []
      return records.length && records.every((r) => r.status === 'PROCESSED') ? false : TXN_POLL_MS
    },
  })
}

// Cache of PROCESSED records used by the fallback path (they never change again).
const processedCache = new Map()

async function fallbackFromSent(status) {
  const sent = sentStore.get().slice(0, 50)
  const pending = sent.filter((s) => !processedCache.has(s.transaction_id))
  const results = await runWithConcurrency(
    pending.map((s) => () => getTransaction(s.transaction_id, { tag: 'poll' })),
    6,
  )
  const fresh = new Map()
  results.forEach((r, i) => {
    const rec = r.records[0]
    if (!rec) return
    if (rec.status === 'PROCESSED') processedCache.set(rec.transaction_id, rec)
    fresh.set(pending[i].transaction_id, rec)
  })
  let records = sent.map((s) => processedCache.get(s.transaction_id) || fresh.get(s.transaction_id)).filter(Boolean)
  if (status) records = records.filter((r) => r.status === status)
  return records
}

/**
 * Transactions table data. Uses GET /v1/transactions when available; otherwise
 * falls back to polling the transactions sent from this browser.
 */
export function useTransactions({ status, limit = 50 } = {}) {
  const [{ useMock }] = usePreferences()
  return useQuery({
    queryKey: ['txns', useMock, status ?? 'ALL', limit],
    queryFn: async () => {
      const res = await listTransactions({ status, limit }, { tag: 'poll' })
      if (res.ok) return { records: res.records, source: 'api', error: null }
      if (res.unsupported) {
        const records = await fallbackFromSent(status)
        return { records, source: 'local', error: null }
      }
      return { records: [], source: 'api', error: res.error }
    },
    refetchInterval: (query) => {
      const records = query.state.data?.records ?? []
      return records.some((r) => r.status !== 'PROCESSED') ? LIST_POLL_ACTIVE_MS : LIST_POLL_IDLE_MS
    },
    placeholderData: (prev) => prev,
  })
}
