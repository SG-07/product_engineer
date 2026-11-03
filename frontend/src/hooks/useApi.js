import { useQuery } from '@tanstack/react-query'
import { getCurrencies, getHealth, getStats, getTransaction, listTransactions } from '@/lib/api'
import {
  HEALTH_POLL_MS,
  LIST_POLL_ACTIVE_MS,
  LIST_POLL_IDLE_MS,
  STATS_POLL_ACTIVE_MS,
  STATS_POLL_IDLE_MS,
  TXN_POLL_MS,
} from '@/config/app'
import { useCurrency, usePreferences } from '@/hooks/useStores'

const isTerminal = (status) => status === 'PROCESSED' || status === 'FAILED'

// TanStack Query pauses refetchInterval while the tab is hidden (refetchIntervalInBackground
// defaults to false), so a background dashboard tab adds no load to the small DB pool.

export function useHealth() {
  const [{ useMock }] = usePreferences()
  return useQuery({
    queryKey: ['health', useMock],
    queryFn: () => getHealth(),
    refetchInterval: HEALTH_POLL_MS,
  })
}

/**
 * Polls one transaction every 2s until it is PROCESSED or FAILED.
 * data: { records, notFound, ok, status, error }
 */
export function useTransaction(id, { enabled = true } = {}) {
  const [{ useMock }] = usePreferences()
  const { currency } = useCurrency()
  return useQuery({
    queryKey: ['txn', useMock, currency, id],
    queryFn: () => getTransaction(id, { currency, tag: 'poll' }),
    enabled: Boolean(id) && enabled,
    refetchInterval: (query) => {
      const records = query.state.data?.records ?? []
      return records.length && records.every((r) => isTerminal(r.status)) ? false : TXN_POLL_MS
    },
  })
}

/** Latest transactions (one request). Shared by the pipeline board and the table when unfiltered. */
export function useTransactions({ status, limit = 50 } = {}) {
  const [{ useMock }] = usePreferences()
  const { currency } = useCurrency()
  return useQuery({
    queryKey: ['txns', useMock, currency, status ?? 'ALL', limit],
    queryFn: async () => {
      const res = await listTransactions({ status, limit, currency }, { tag: 'poll' })
      return { records: res.records, total: res.total, error: res.ok ? null : res.error }
    },
    refetchInterval: (query) => {
      const records = query.state.data?.records ?? []
      return records.some((r) => r.status === 'PROCESSING') ? LIST_POLL_ACTIVE_MS : LIST_POLL_IDLE_MS
    },
    placeholderData: (prev) => prev,
  })
}

/** Live service numbers from GET /v1/stats. data: { stats, error } */
export function useStats() {
  const [{ useMock }] = usePreferences()
  return useQuery({
    queryKey: ['stats', useMock],
    queryFn: async () => {
      const res = await getStats()
      return { stats: res.ok ? res.data : null, error: res.ok ? null : res.error, status: res.status }
    },
    refetchInterval: (query) =>
      (query.state.data?.stats?.transactions?.processing ?? 0) > 0 ? STATS_POLL_ACTIVE_MS : STATS_POLL_IDLE_MS,
    placeholderData: (prev) => prev,
  })
}

/** Supported currencies, fixed rates (INR per unit) and their "as of" date. data: { currencies, error } */
export function useCurrencies() {
  const [{ useMock }] = usePreferences()
  return useQuery({
    queryKey: ['currencies', useMock],
    queryFn: async () => {
      const res = await getCurrencies()
      return { currencies: res.ok ? res.data : null, error: res.ok ? null : res.error }
    },
    staleTime: 5 * 60 * 1000,
  })
}
