/**
 * Transactions sent from this browser (persisted in localStorage).
 * Used for tracker cards and as a fallback for the transactions table
 * when the backend list endpoint is unavailable.
 */
const STORAGE_KEY = 'txn-dashboard:sent'
const MAX_ENTRIES = 300

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

let entries = load()
const listeners = new Set()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export const sentStore = {
  get: () => entries,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** @param {{ transaction_id: string, kind: 'single'|'idempotency'|'load', sentAt?: number }} entry */
  add(entry) {
    if (entries.some((e) => e.transaction_id === entry.transaction_id)) return
    entries = [{ sentAt: Date.now(), ...entry }, ...entries].slice(0, MAX_ENTRIES)
    persist()
  },
  addMany(list) {
    const known = new Set(entries.map((e) => e.transaction_id))
    const now = Date.now()
    const fresh = list.filter((e) => !known.has(e.transaction_id)).map((e) => ({ sentAt: now, ...e }))
    if (!fresh.length) return
    entries = [...fresh.reverse(), ...entries].slice(0, MAX_ENTRIES)
    persist()
  },
  removeKind(kind) {
    entries = entries.filter((e) => e.kind !== kind)
    persist()
  },
  clear() {
    entries = []
    persist()
  },
}
