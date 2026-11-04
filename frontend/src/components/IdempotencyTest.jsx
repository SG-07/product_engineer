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

/**
 * Two scenarios:
 *  - identical: sends the SAME webhook N times; expect exactly one processed transaction.
 *  - conflict:  sends the original, then the same transaction_id with changed fields;
 *               expect 202 for the original, 409 for each change, and the original kept.
 */
export function IdempotencyTest() {
  const [scenario, setScenario] = useState('identical')
  const [count, setCount] = useState(5)
  const [mode, setMode] = useState('parallel')
  const [run, setRun] = useState(null) // { scenario, payload, sentAt, results, done }
  const queryClient = useQueryClient()
  const running = run && !run.done

  const addResult = (entry) => setRun((r) => ({ ...r, results: [...r.results, entry] }))

  function finishRun(anyAccepted, transactionId, sentAt) {
    if (anyAccepted) {
      sentStore.add({ transaction_id: transactionId, kind: 'idempotency', sentAt })
      queryClient.invalidateQueries({ queryKey: ['txns'] })
    }
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    setRun((r) => ({ ...r, done: true }))
  }

  async function startIdentical() {
    const n = Math.min(MAX_BATCH, Math.max(1, Number(count) || 1))
    setCount(n)
    const payload = randomPayload()
    const sentAt = Date.now()
    setRun({ scenario: 'identical', payload, sentAt, results: [], done: false })

    const tasks = Array.from({ length: n }, (_, i) => async () => {
      const res = await sendWebhook(payload)
      addResult({ i: i + 1, status: res.status, latencyMs: res.latencyMs, error: res.error, data: res.data })
      return res
    })
    const all = await runWithConcurrency(tasks, mode === 'parallel' ? n : 1)
    finishRun(all.some((r) => r.ok), payload.transaction_id, sentAt)
  }

  async function startConflict() {
    const payload = randomPayload()
    const sentAt = Date.now()
    setRun({ scenario: 'conflict', payload, sentAt, results: [], done: false })

    const send = async (i, label, expect, body) => {
      const res = await sendWebhook(body)
      addResult({ i, label, expect, status: res.status, latencyMs: res.latencyMs, error: res.error, data: res.data })
      return res
    }

    // The original must be created first, so every variant below really conflicts with it.
    const original = await send(1, 'Original', 202, payload)

    const variants = [
      ['Amount changed', { ...payload, amount: payload.amount + 1 }],
      ['Currency changed', { ...payload, currency: payload.currency === 'INR' ? 'USD' : 'INR' }],
      ['Destination changed', { ...payload, destination_account: `${payload.destination_account}_x` }],
    ]
    const tasks = variants.map(([label, body], k) => () => send(k + 2, label, 409, body))
    await runWithConcurrency(tasks, mode === 'parallel' ? variants.length : 1)

    await send(variants.length + 2, 'Original again', 202, payload)
    finishRun(original.ok, payload.transaction_id, sentAt)
  }

  const start = () => (scenario === 'conflict' ? startConflict() : startIdentical())

  const results = run ? [...run.results].sort((a, b) => a.i - b.i) : []
  const isConflict = run?.scenario === 'conflict'
  const okCount = results.filter((r) => r.status >= 200 && r.status < 300).length
  const created = results.filter((r) => r.data?.status === 'accepted').length
  const duplicates = results.filter((r) => r.data?.status === 'duplicate').length
  const latencies = results.map((r) => r.latencyMs)
  const maxLatency = latencies.length ? Math.max(...latencies) : null
  const originalResult = results.find((r) => r.label === 'Original')
  const resendResult = results.find((r) => r.label === 'Original again')
  const variantResults = results.filter((r) => r.expect === 409)
  const conflictsRejected = variantResults.filter((r) => r.status === 409).length
  const latencyTone = maxLatency == null ? undefined : maxLatency < LATENCY_BUDGET_MS ? 'good' : 'bad'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Idempotency test</CardTitle>
          <CardDescription>
            {scenario === 'conflict'
              ? 'Send a transaction, then the same transaction_id with a changed amount, currency and destination. The original should be kept and every change rejected with 409.'
              : 'Send the same transaction_id multiple times. All requests should be accepted gracefully and exactly one transaction processed.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="idem-scenario">Scenario</Label>
              <NativeSelect id="idem-scenario" value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={running}>
                <option value="identical">Identical duplicates</option>
                <option value="conflict">Conflicting payload (expect 409)</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idem-mode">Mode</Label>
              <NativeSelect id="idem-mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={running}>
                <option value="parallel">Parallel (all at once)</option>
                <option value="sequential">Sequential</option>
              </NativeSelect>
            </div>
            {scenario === 'identical' && (
              <div className="space-y-1.5">
                <Label htmlFor="idem-count">Duplicate sends (max {MAX_BATCH})</Label>
                <Input id="idem-count" type="number" min={1} max={MAX_BATCH} value={count} onChange={(e) => setCount(e.target.value)} disabled={running} />
              </div>
            )}
          </div>
          <Button onClick={start} disabled={running} className="w-full">
            {running ? <LoaderCircle className="animate-spin" /> : <Play />} Run
          </Button>

          {run ? (
            <>
              {isConflict ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    label="Original accepted"
                    value={originalResult?.data?.status === 'accepted' ? '1/1' : '0/1'}
                    tone={run.done ? (originalResult?.data?.status === 'accepted' ? 'good' : 'bad') : undefined}
                  />
                  <Stat
                    label="Conflicts rejected"
                    value={`${conflictsRejected}/${variantResults.length}`}
                    tone={run.done ? (variantResults.length && conflictsRejected === variantResults.length ? 'good' : 'bad') : undefined}
                  />
                  <Stat
                    label="Re-send is duplicate"
                    value={resendResult?.data?.status === 'duplicate' ? 'yes' : resendResult ? 'no' : '—'}
                    tone={run.done ? (resendResult?.data?.status === 'duplicate' ? 'good' : 'bad') : undefined}
                  />
                  <Stat label="Max latency" value={formatMs(maxLatency)} tone={latencyTone} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Responded 202" value={`${okCount}/${results.length}`} tone={results.length && okCount === results.length ? 'good' : results.length ? 'bad' : undefined} />
                  <Stat label="New / duplicate" value={`${created} / ${duplicates}`} hint="expect 1 new" tone={run.done ? (created === 1 ? 'good' : 'bad') : undefined} />
                  <Stat label="Max latency" value={formatMs(maxLatency)} tone={latencyTone} />
                  <Stat label="Mode" value={mode === 'parallel' ? 'Parallel' : 'Sequential'} />
                </div>
              )}
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Case</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => {
                      const mismatch = r.expect != null && r.status !== r.expect
                      return (
                        <TableRow key={r.i} className={mismatch ? 'bg-destructive/10' : undefined}>
                          <TableCell className="tabular-nums">{r.i}</TableCell>
                          <TableCell className="text-sm">{r.label ?? '—'}</TableCell>
                          <TableCell><HttpStatusBadge status={r.status} /></TableCell>
                          <TableCell><LatencyBadge ms={r.latencyMs} /></TableCell>
                          <TableCell className="text-muted-foreground max-w-48 truncate font-mono text-xs">
                            {r.error || (r.data ? JSON.stringify(r.data) : 'empty')}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <EmptyState icon={CopyIcon} title="No run yet">
              {scenario === 'conflict' ? 'Press Run to send the original and three conflicting variants.' : 'Choose how many duplicates to send and press Run.'}
            </EmptyState>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verification</CardTitle>
          <CardDescription>
            {isConflict
              ? 'GET /v1/transactions/{id} should still show the original values.'
              : `GET /v1/transactions/{'{id}'} should return exactly one processed record.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {run?.done && okCount > 0 ? (
            <TransactionTracker key={run.payload.transaction_id} transactionId={run.payload.transaction_id} sentAt={run.sentAt}>
              {({ records }) =>
                isConflict ? (
                  <ConflictVerdict records={records} results={results} payload={run.payload} />
                ) : (
                  <Verdict records={records} sends={results.length} okCount={okCount} />
                )
              }
            </TransactionTracker>
          ) : run?.done ? (
            <EmptyState icon={CircleX} title="No request was accepted">Check the request log and backend health.</EmptyState>
          ) : (
            <EmptyState icon={CircleCheck} title="Waiting for a run">Verification starts once all requests have completed.</EmptyState>
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
  return <Checks checks={checks} finished={allProcessed} successText="✅ Idempotency verified — one transaction processed." failText="❌ Idempotency check failed." />
}

function ConflictVerdict({ records, results, payload }) {
  const original = results.find((r) => r.label === 'Original')
  const variants = results.filter((r) => r.expect === 409)
  const resend = results.find((r) => r.label === 'Original again')
  const stored = records[0]
  const storedKeepsOriginal =
    !!stored &&
    Number(stored.original_amount) === payload.amount &&
    stored.original_currency === payload.currency &&
    stored.destination_account === payload.destination_account
  const rejected = variants.filter((v) => v.status === 409).length
  const checks = [
    { label: 'Original accepted (202 accepted)', pass: original?.data?.status === 'accepted' },
    { label: `Conflicting payloads rejected: ${rejected}/${variants.length}`, pass: variants.length > 0 && rejected === variants.length },
    { label: 'Re-sent original is a duplicate (202)', pass: resend?.status === 202 && resend?.data?.status === 'duplicate' },
    { label: `Records stored for this ID: ${records.length}`, pass: records.length === 1, pending: records.length === 0 },
    { label: 'Stored record keeps the original values', pass: storedKeepsOriginal, pending: records.length === 0 },
  ]
  return (
    <Checks
      checks={checks}
      finished={records.length > 0}
      successText="✅ Conflict handling verified — original kept, conflicts rejected."
      failText="❌ Conflict check failed."
    />
  )
}

function Checks({ checks, finished, successText, failText }) {
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
          {passed ? successText : failText}
        </div>
      )}
    </div>
  )
}
