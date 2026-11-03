import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, Copy as CopyIcon, LoaderCircle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, HttpStatusBadge, LatencyBadge, Stat } from '@/components/common'
import { TransactionTracker } from '@/components/TransactionTracker'
import { sendWebhook } from '@/lib/api'
import { randomPayload } from '@/lib/ids'
import { sentStore } from '@/lib/sentStore'
import { formatMs } from '@/lib/format'
import { runWithConcurrency } from '@/lib/utils'
import { LATENCY_BUDGET_MS, MAX_BATCH } from '@/config/app'

/** Sends the SAME webhook N times and verifies only one transaction is processed. */
export function IdempotencyTest() {
  const [count, setCount] = useState(5)
  const [mode, setMode] = useState('parallel')
  const [run, setRun] = useState(null) // { payload, sentAt, results, done }
  const queryClient = useQueryClient()
  const running = run && !run.done

  async function start() {
    const n = Math.min(MAX_BATCH, Math.max(1, Number(count) || 1))
    setCount(n)
    const payload = randomPayload()
    const sentAt = Date.now()
    setRun({ payload, sentAt, results: [], done: false })

    const record = (i, res) =>
      setRun((r) => ({ ...r, results: [...r.results, { i: i + 1, status: res.status, latencyMs: res.latencyMs, error: res.error, data: res.data }] }))

    const tasks = Array.from({ length: n }, (_, i) => async () => {
      const res = await sendWebhook(payload)
      record(i, res)
      return res
    })
    const all = await runWithConcurrency(tasks, mode === 'parallel' ? n : 1)

    if (all.some((r) => r.ok)) {
      sentStore.add({ transaction_id: payload.transaction_id, kind: 'idempotency', sentAt })
      queryClient.invalidateQueries({ queryKey: ['txns'] })
    }
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    setRun((r) => ({ ...r, done: true }))
  }

  const results = run ? [...run.results].sort((a, b) => a.i - b.i) : []
  const okCount = results.filter((r) => r.status >= 200 && r.status < 300).length
  const created = results.filter((r) => r.data?.status === 'accepted').length
  const duplicates = results.filter((r) => r.data?.status === 'duplicate').length
  const latencies = results.map((r) => r.latencyMs)
  const maxLatency = latencies.length ? Math.max(...latencies) : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Idempotency test</CardTitle>
          <CardDescription>Send the same transaction_id multiple times. All requests should be accepted gracefully and exactly one transaction processed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="idem-count">Duplicate sends (max {MAX_BATCH})</Label>
              <Input id="idem-count" type="number" min={1} max={MAX_BATCH} value={count} onChange={(e) => setCount(e.target.value)} disabled={running} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idem-mode">Mode</Label>
              <NativeSelect id="idem-mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={running}>
                <option value="parallel">Parallel (all at once)</option>
                <option value="sequential">Sequential</option>
              </NativeSelect>
            </div>
            <Button onClick={start} disabled={running}>
              {running ? <LoaderCircle className="animate-spin" /> : <Play />} Run
            </Button>
          </div>

          {run ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Responded 202" value={`${okCount}/${results.length}`} tone={results.length && okCount === results.length ? 'good' : results.length ? 'bad' : undefined} />
                <Stat label="New / duplicate" value={`${created} / ${duplicates}`} hint="expect 1 new" tone={run.done ? (created === 1 ? 'good' : 'bad') : undefined} />
                <Stat label="Max latency" value={formatMs(maxLatency)} tone={maxLatency == null ? undefined : maxLatency < LATENCY_BUDGET_MS ? 'good' : 'bad'} />
                <Stat label="Mode" value={mode === 'parallel' ? 'Parallel' : 'Sequential'} />
              </div>
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.i}>
                        <TableCell className="tabular-nums">{r.i}</TableCell>
                        <TableCell><HttpStatusBadge status={r.status} /></TableCell>
                        <TableCell><LatencyBadge ms={r.latencyMs} /></TableCell>
                        <TableCell className="text-muted-foreground max-w-48 truncate font-mono text-xs">
                          {r.error || (r.data ? JSON.stringify(r.data) : 'empty')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <EmptyState icon={CopyIcon} title="No run yet">Choose how many duplicates to send and press Run.</EmptyState>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verification</CardTitle>
          <CardDescription>GET /v1/transactions/{'{id}'} should return exactly one processed record.</CardDescription>
        </CardHeader>
        <CardContent>
          {run?.done && okCount > 0 ? (
            <TransactionTracker key={run.payload.transaction_id} transactionId={run.payload.transaction_id} sentAt={run.sentAt}>
              {({ records }) => <Verdict records={records} sends={results.length} okCount={okCount} />}
            </TransactionTracker>
          ) : run?.done ? (
            <EmptyState icon={CircleX} title="No request was accepted">Check the request log and backend health.</EmptyState>
          ) : (
            <EmptyState icon={CircleCheck} title="Waiting for a run">Verification starts once all duplicate requests have completed.</EmptyState>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Verdict({ records, sends, okCount }) {
  const processed = records.filter((r) => r.status === 'PROCESSED').length
  const allProcessed = records.length > 0 && processed === records.length
  const checks = [
    { label: `All ${sends} requests handled without errors`, pass: okCount === sends },
    { label: `Records stored for this ID: ${records.length}`, pass: records.length === 1, pending: records.length === 0 },
    { label: allProcessed ? `Processed exactly once (${processed})` : 'Waiting for processing to finish…', pass: allProcessed && processed === 1, pending: !allProcessed },
  ]
  const finished = allProcessed
  const passed = checks.every((c) => c.pass)

  return (
    <div className="space-y-2 border-t pt-3">
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-2 text-sm">
          {c.pending ? (
            <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
          ) : c.pass ? (
            <CircleCheck className="text-success size-4" />
          ) : (
            <CircleX className="text-destructive size-4" />
          )}
          {c.label}
        </div>
      ))}
      {finished && (
        <div className={`rounded-md p-2 text-sm font-medium ${passed ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
          {passed ? '✅ Idempotency verified — one transaction processed.' : '❌ Idempotency check failed.'}
        </div>
      )}
    </div>
  )
}
