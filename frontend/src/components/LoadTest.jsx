import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Gauge, LoaderCircle, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Progress, Skeleton } from '@/components/ui/misc'
import { EmptyState, Stat } from '@/components/common'
import { listTransactions, sendWebhook } from '@/lib/api'
import { randomPayload } from '@/lib/ids'
import { sentStore } from '@/lib/sentStore'
import { formatMs } from '@/lib/format'
import { percentile, runWithConcurrency } from '@/lib/utils'
import { useCurrency } from '@/hooks/useStores'
import { LATENCY_BUDGET_MS, MAX_BATCH } from '@/config/app'

// Recharts is large – load it only when a chart is needed.
const LatencyChart = lazy(() => import('@/components/LatencyChart').then((m) => ({ default: m.LatencyChart })))

const STATUS_CHECK_MS = 5000

/** Fires N unique webhooks concurrently and reports latency vs the 500 ms budget. */
export function LoadTest() {
  const [count, setCount] = useState(20)
  const [concurrency, setConcurrency] = useState(10)
  const [run, setRun] = useState(null) // { ids, results, done, startedAt, totalMs }
  const [processed, setProcessed] = useState({ checked: false, done: 0, checking: false, tracking: false })
  const queryClient = useQueryClient()
  const { currency } = useCurrency()
  const running = run && !run.done
  const trackingRef = useRef(false)

  async function start() {
    const n = Math.min(MAX_BATCH, Math.max(1, Number(count) || 1))
    const c = Math.min(n, Math.max(1, Number(concurrency) || 1))
    setCount(n)
    setConcurrency(c)
    const payloads = Array.from({ length: n }, randomPayload)
    const t0 = performance.now()
    setRun({ ids: payloads.map((p) => p.transaction_id), results: [], done: false, total: n })
    setProcessed({ checked: false, done: 0, checking: false, tracking: false })

    const tasks = payloads.map((p, i) => async () => {
      const res = await sendWebhook(p)
      setRun((r) => ({ ...r, results: [...r.results, { i: i + 1, status: res.status, latencyMs: res.latencyMs, ok: res.ok, id: p.transaction_id }] }))
      return res
    })
    const all = await runWithConcurrency(tasks, c)
    const accepted = payloads.filter((_, i) => all[i].ok).map((p) => ({ transaction_id: p.transaction_id, kind: 'load' }))
    sentStore.addMany(accepted)
    queryClient.invalidateQueries({ queryKey: ['txns'] })
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    setRun((r) => ({ ...r, done: true, totalMs: performance.now() - t0 }))
    trackingRef.current = accepted.length > 0
    setProcessed((p) => ({ ...p, tracking: accepted.length > 0 }))
  }

  // Periodically check how many accepted transactions have been processed.
  useEffect(() => {
    if (!run?.done || !processed.tracking) return
    const acceptedIds = run.results.filter((r) => r.ok).map((r) => r.id)
    let cancelled = false
    const doneSet = new Set()

    async function check() {
      setProcessed((p) => ({ ...p, checking: true }))
      // One list request (newest 100) instead of one GET per transaction: easy on the small DB pool.
      const res = await listTransactions({ limit: 100, currency }, { tag: 'poll' })
      const byId = new Map(res.records.map((r) => [r.transaction_id, r.status]))
      acceptedIds.forEach((id) => {
        const status = byId.get(id)
        if (status === 'PROCESSED' || status === 'FAILED') doneSet.add(id)
      })
      if (cancelled) return
      const allDone = doneSet.size === acceptedIds.length
      setProcessed({ checked: true, done: doneSet.size, checking: false, tracking: !allDone })
      if (!allDone && trackingRef.current) timer = setTimeout(check, STATUS_CHECK_MS)
    }
    let timer = setTimeout(check, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.done, processed.tracking])

  const results = run?.results ?? []
  const ok = results.filter((r) => r.ok)
  const lat = results.map((r) => r.latencyMs)
  const under = results.filter((r) => r.ok && r.latencyMs < LATENCY_BUDGET_MS).length
  const pctUnder = results.length ? Math.round((under / results.length) * 100) : 0
  const sorted = [...results].sort((a, b) => a.i - b.i)
  const tone = (ms) => (ms < LATENCY_BUDGET_MS ? 'good' : 'bad')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Load test</CardTitle>
        <CardDescription>
          Fire up to {MAX_BATCH} unique webhooks concurrently. Every response should arrive within {LATENCY_BUDGET_MS} ms even while earlier transactions are still processing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="load-count">Webhooks (max {MAX_BATCH})</Label>
            <Input id="load-count" type="number" min={1} max={MAX_BATCH} value={count} onChange={(e) => setCount(e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="load-conc">Concurrency</Label>
            <Input id="load-conc" type="number" min={1} max={MAX_BATCH} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} disabled={running} />
          </div>
          <Button onClick={start} disabled={running}>
            {running ? <LoaderCircle className="animate-spin" /> : <Play />} Start
          </Button>
        </div>

        {!run ? (
          <EmptyState icon={Gauge} title="No load test yet">Set the number of webhooks and concurrency, then press Start.</EmptyState>
        ) : (
          <>
            {running && (
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs tabular-nums">Sending {results.length}/{run.total}…</div>
                <Progress value={(results.length / run.total) * 100} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Accepted" value={`${ok.length}/${results.length}`} tone={results.length && ok.length === results.length ? 'good' : 'bad'} />
              <Stat label={`Under ${LATENCY_BUDGET_MS} ms`} value={`${pctUnder}%`} tone={pctUnder === 100 ? 'good' : 'bad'} />
              <Stat label="Min" value={formatMs(lat.length ? Math.min(...lat) : null)} />
              <Stat label="Avg" value={formatMs(lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null)} tone={lat.length ? tone(lat.reduce((a, b) => a + b, 0) / lat.length) : undefined} />
              <Stat label="p95" value={formatMs(percentile(lat, 95))} tone={lat.length ? tone(percentile(lat, 95)) : undefined} />
              <Stat label="Max" value={formatMs(lat.length ? Math.max(...lat) : null)} tone={lat.length ? tone(Math.max(...lat)) : undefined} />
            </div>

            {sorted.length > 0 && (
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <LatencyChart results={sorted} />
              </Suspense>
            )}

            {run.done && ok.length > 0 && (
              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">Background processing</span>
                  <span className="text-muted-foreground flex items-center gap-2 tabular-nums">
                    {processed.checking && <LoaderCircle className="size-3 animate-spin" />}
                    {processed.checked ? `${processed.done}/${ok.length} finished` : 'First check in a moment…'}
                    {processed.tracking && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          trackingRef.current = false
                          setProcessed((p) => ({ ...p, tracking: false }))
                        }}
                      >
                        <Square /> Stop
                      </Button>
                    )}
                  </span>
                </div>
                <Progress value={(processed.done / ok.length) * 100} indicatorClassName={processed.done === ok.length ? 'bg-success' : 'bg-warning'} />
                <p className="text-muted-foreground text-xs">
                  Total send time {formatMs(run.totalMs)}. Status is re-checked every {STATUS_CHECK_MS / 1000}s until all are processed.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
