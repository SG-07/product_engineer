import { CircleAlert, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress, Skeleton } from '@/components/ui/misc'
import { Money, StatusBadge } from '@/components/common'
import { useStats, useTransactions } from '@/hooks/useApi'
import { useNow } from '@/hooks/useStores'
import { durationSeconds } from '@/lib/format'
import { expectedProcessingSeconds } from '@/config/app'

const COLUMNS = ['PROCESSING', 'PROCESSED', 'FAILED']
const PER_COLUMN = 8

/**
 * Board of the newest transactions grouped by status. Processing cards count down to the
 * expected completion time; they move column on the next poll. Uses the same list query
 * as the table, so it adds no extra request.
 */
export function LivePipeline() {
  const { data, isLoading } = useTransactions({ limit: 50 })
  const { data: statsData, dataUpdatedAt } = useStats()
  const records = data?.records ?? []
  const hasProcessing = records.some((r) => r.status === 'PROCESSING')
  const now = useNow(1000, hasProcessing)

  // Use the server's clock so the countdown is right even if this computer's clock is off.
  const stats = statsData?.stats
  const skew = stats ? Date.parse(stats.as_of) - dataUpdatedAt : 0
  const serverNow = now + skew
  const expected = stats?.config?.processing_delay_seconds ?? expectedProcessingSeconds()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="size-4" /> Live pipeline
        </CardTitle>
        <CardDescription>Newest transactions by status. Processing ones count down to ~{expected}s, then move across.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : data?.error ? (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{data.error}</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {COLUMNS.map((status) => {
              const items = records.filter((r) => r.status === status)
              return (
                <section key={status} aria-label={status} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={status} />
                    <Badge variant="outline" className="tabular-nums">
                      {items.length}
                    </Badge>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-auto">
                    {items.length === 0 ? (
                      <div className="text-muted-foreground rounded-md border border-dashed p-3 text-center text-xs">None</div>
                    ) : (
                      items.slice(0, PER_COLUMN).map((r) => <PipelineCard key={r.transaction_id} record={r} serverNow={serverNow} expected={expected} />)
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PipelineCard({ record, serverNow, expected }) {
  const elapsed = Math.max(0, (serverNow - Date.parse(record.created_at)) / 1000)
  const overdue = record.status === 'PROCESSING' && elapsed > expected + 5
  const took = durationSeconds(record.created_at, record.processed_at)

  return (
    <div className="bg-card space-y-1.5 rounded-md border p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <code className="truncate">{record.transaction_id}</code>
        <Money record={record} className="font-medium" />
      </div>
      {record.status === 'PROCESSING' && (
        <>
          <Progress value={Math.min(99, (elapsed / expected) * 100)} indicatorClassName={overdue ? 'bg-destructive' : 'bg-warning'} />
          <div className={overdue ? 'text-destructive tabular-nums' : 'text-muted-foreground tabular-nums'}>
            {overdue && <CircleAlert className="mr-1 inline size-3" />}
            {elapsed < expected ? `${Math.max(0, Math.ceil(expected - elapsed))}s left` : 'waiting for the result…'}
          </div>
        </>
      )}
      {record.status === 'PROCESSED' && <div className="text-muted-foreground tabular-nums">took {took != null ? `${took.toFixed(1)}s` : '—'}</div>}
      {record.status === 'FAILED' && (
        <div className="text-destructive">
          {record.attempts} attempt(s){record.last_error ? ` · ${record.last_error}` : ''}
        </div>
      )}
    </div>
  )
}
