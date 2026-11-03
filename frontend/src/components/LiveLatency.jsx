import { lazy, Suspense } from 'react'
import { Timer } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { EmptyState, Stat } from '@/components/common'
import { useStats } from '@/hooks/useApi'
import { useRequestLog } from '@/hooks/useStores'
import { formatMs } from '@/lib/format'
import { percentile } from '@/lib/utils'
import { LATENCY_BUDGET_MS } from '@/config/app'

// Recharts is large: load it only when the first webhook has been sent.
const LatencyLines = lazy(() => import('@/components/LatencyChart').then((m) => ({ default: m.LatencyLines })))

const WEBHOOK_PATH = '/v1/webhooks/transactions'
const WINDOW = 60

const tone = (ms) => (ms == null ? undefined : ms < LATENCY_BUDGET_MS ? 'good' : 'bad')

/**
 * Where does the time go? Compares the browser-measured time of each webhook with the
 * server's own X-Response-Time-Ms. The gap is network + hosting overhead, not code.
 */
export function LiveLatency() {
  const log = useRequestLog()
  const { data } = useStats()
  const server = data?.stats?.webhooks

  const sent = log.filter((e) => e.method === 'POST' && e.path === WEBHOOK_PATH && e.status > 0).slice(0, WINDOW).reverse()
  const chart = sent.map((e, i) => ({ n: i + 1, client: Math.round(e.latencyMs), server: e.serverMs }))
  const client = sent.map((e) => e.latencyMs)
  const overhead = sent.filter((e) => e.networkMs != null).map((e) => e.networkMs)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="size-4" /> Latency: where does the time go?
        </CardTitle>
        <CardDescription>
          Each webhook sent from this page: time seen by the browser vs time spent inside the server. The 500 ms budget applies to the browser view.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent.length === 0 ? (
          <EmptyState icon={Timer} title="No webhooks sent yet">
            Send a webhook, or run the idempotency or load test, and the timings appear here.
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Browser p50 / p95" value={`${formatMs(percentile(client, 50))} / ${formatMs(percentile(client, 95))}`} tone={tone(percentile(client, 95))} hint={`last ${sent.length} sent here`} />
              <Stat
                label="Server p50 / p95"
                value={server?.ack_ms?.p50 != null ? `${formatMs(server.ack_ms.p50)} / ${formatMs(server.ack_ms.p95)}` : '—'}
                tone={tone(server?.ack_ms?.p95)}
                hint={server ? `last ${server.window} from anyone` : 'needs /v1/stats'}
              />
              <Stat label="Network overhead (median)" value={overhead.length ? formatMs(percentile(overhead, 50)) : '—'} hint="browser minus server" />
              <Stat label="Over 500 ms" value={server ? `${server.over_budget_pct}%` : '—'} tone={server ? (server.over_budget_pct === 0 ? 'good' : 'bad') : undefined} hint="server side" />
            </div>
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <LatencyLines data={chart} />
            </Suspense>
          </>
        )}
      </CardContent>
    </Card>
  )
}
