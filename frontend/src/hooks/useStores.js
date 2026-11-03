import { useEffect, useState, useSyncExternalStore } from 'react'
import { prefsStore } from '@/lib/prefsStore'
import { requestLog } from '@/lib/requestLog'
import { sentStore } from '@/lib/sentStore'
import { CURRENCIES } from '@/config/currency'

export function usePreferences() {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get)
  return [prefs, prefsStore.set]
}

export const useRequestLog = () => useSyncExternalStore(requestLog.subscribe, requestLog.get)
export const useSentTransactions = () => useSyncExternalStore(sentStore.subscribe, sentStore.get)

/** Display-currency preference. The backend converts: every read sends ?currency=<this>. */
export function useCurrency() {
  const [prefs, setPrefs] = usePreferences()
  const currency = prefs.currency || 'INR'
  return { currency, meta: CURRENCIES[currency], setCurrency: (code) => setPrefs({ currency: code }) }
}

/** Applies the theme preference to <html> and follows the OS when set to "system". */
export function useApplyTheme() {
  const [{ theme }] = usePreferences()
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

export function useResolvedTheme() {
  const [{ theme }] = usePreferences()
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

/** Current timestamp that re-renders every `intervalMs` while `active`. */
export function useNow(intervalMs = 1000, active = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}
