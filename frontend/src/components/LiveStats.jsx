import { Activity, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { Stat } from '@/components/common'
import { useStats } from '@/hooks/useApi'
import { useNow } from '@/hooks/useStores'
import { formatDuration } from '@/lib/format'

/** Live service numbers from GET /v1/stats, refreshed every 3 s while work is in progress. */
export function LiveStats() {
  const { data, isLoading, dataUpdatedAt } = useStats()
  const now = useNow(1000)
  const stats = data?.stats
  const ageSeconds = dataUpdatedAt ? Math.max(0, Math.round((now - dataUpdatedAt) / 1000)) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" /> Live status
        </CardTitle>
        <CardDescription>
          From GET /v1/stats · refreshes every 3 s while anything is processing, otherwise every 10 s
          {ageSeconds != null && ` · updated ${ageSeconds}s ago`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !stats ? (
          <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            {data?.status === 404
              ? 'This backend has no /v1/stats yet. Deploy the latest backend to see live numbers.'
              : `Live stats unavailable: ${data?.error ?? 'unknown error'}`}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Processing" value={stats.transactions.processing} tone={undefined} />
            <Stat label="Processed" value={stats.transactions.processed} tone={stats.transactions.processed ? 'good' : undefined} />
            <Stat label="Failed" value={stats.transactions.failed} tone={stats.transactions.failed ? 'bad' : undefined} />
            <Stat label="In-flight jobs" value={stats.in_flight_jobs} hint="running in the server" />
            <Stat label="Oldest processing" value={formatDuration(stats.oldest_processing_age_seconds)} hint={`target ${stats.config.processing_delay_seconds}s`} />
            <Stat label="Avg processing" value={stats.avg_processing_seconds != null ? `${stats.avg_processing_seconds}s` : '—'} hint="last 50" />
            <Stat
              label="DB connections"
              value={`${stats.db.api_in_use ?? '—'} / ${stats.db.api_pool_max}`}
              hint="API pool in use / max"
            />
            <Stat label="Uptime" value={formatDuration(stats.uptime_seconds)} hint="since last restart" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
