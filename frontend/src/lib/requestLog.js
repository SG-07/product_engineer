/** In-memory log of every API call made by the dashboard (last 200). */
const MAX_ENTRIES = 200

let entries = []
let seq = 0
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

export const requestLog = {
  get: () => entries,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  add(entry) {
    entries = [{ id: ++seq, ...entry }, ...entries].slice(0, MAX_ENTRIES)
    emit()
  },
  clear() {
    entries = []
    emit()
  },
}
