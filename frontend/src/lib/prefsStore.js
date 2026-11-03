/**
 * Tiny external store for user preferences, persisted in localStorage.
 * Readable outside React (api.js needs mock mode) and inside via useSyncExternalStore.
 */
const STORAGE_KEY = 'txn-dashboard:prefs'

const envMock = String(import.meta.env.VITE_USE_MOCK ?? 'true').toLowerCase() === 'true'
const envMockDelay = Number(import.meta.env.VITE_MOCK_PROCESSING_SECONDS) || 30

export const DEFAULT_PREFS = {
  currency: null, // null until the user picks one on first visit
  theme: 'system', // 'light' | 'dark' | 'system'
  useMock: envMock,
  mockDelaySeconds: envMockDelay,
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

let state = load()
const listeners = new Set()

export const prefsStore = {
  get: () => state,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set(patch) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable – keep in memory */
    }
    listeners.forEach((l) => l())
  },
  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    state = { ...DEFAULT_PREFS }
    listeners.forEach((l) => l())
  },
}
