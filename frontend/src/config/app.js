import { prefsStore } from '@/lib/prefsStore'

/** Expected background processing time in seconds (30s per spec; mock is configurable). */
export const expectedProcessingSeconds = () => {
  const p = prefsStore.get()
  return p.useMock ? p.mockDelaySeconds : 30
}

export const LATENCY_BUDGET_MS = 500
export const MAX_BATCH = 100
export const HEALTH_POLL_MS = 10000
export const TXN_POLL_MS = 2000
export const LIST_POLL_ACTIVE_MS = 3000
export const LIST_POLL_IDLE_MS = 15000
