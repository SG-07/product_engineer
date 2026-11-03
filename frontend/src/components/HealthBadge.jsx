import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/misc'
import { useHealth } from '@/hooks/useApi'
import { formatMs, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export function HealthBadge() {
  const { data, isLoading, dataUpdatedAt } = useHealth()
  const healthy = data?.ok && data?.data?.status === 'HEALTHY'
  const label = isLoading ? 'Checking…' : healthy ? 'HEALTHY' : 'DOWN'

  const tip = isLoading ? (
    'Contacting backend…'
  ) : (
    <div className="space-y-0.5">
      <div>Status: {healthy ? 'HEALTHY' : data?.error || data?.data?.status || 'Unavailable'}</div>
      {data?.data?.current_time && <div>Server time: {formatTime(data.data.current_time)}</div>}
      <div>Round trip: {formatMs(data?.latencyMs)}</div>
      <div>Last check: {dataUpdatedAt ? formatTime(new Date(dataUpdatedAt).toISOString()) : '—'} (every 10s)</div>
    </div>
  )

  return (
    <Tooltip content={tip} side="bottom">
      <Badge variant={isLoading ? 'outline' : healthy ? 'success' : 'destructive'} className="h-7 gap-1.5 px-2.5 cursor-default">
        <span className="relative flex size-2">
          {healthy && <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60" />}
          <span className={cn('relative inline-flex size-2 rounded-full', isLoading ? 'bg-muted-foreground' : healthy ? 'bg-success' : 'bg-destructive')} />
        </span>
        {label}
        {!isLoading && data?.latencyMs != null && <span className="text-muted-foreground hidden font-normal sm:inline">{formatMs(data.latencyMs)}</span>}
      </Badge>
    </Tooltip>
  )
}
