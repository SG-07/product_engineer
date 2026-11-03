import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/misc'
import { CopyButton, Money, StatusBadge } from '@/components/common'
import { useTransaction } from '@/hooks/useApi'
import { useNow } from '@/hooks/useStores'
import { durationSeconds, formatTime } from '@/lib/format'
import { expectedProcessingSeconds } from '@/config/app'
import { cn } from '@/lib/utils'

/**
 * Live card for one transaction: polls GET /v1/transactions/{id} every 2s and
 * shows a countdown towards the expected ~30s processing time.
 */
export function TransactionTracker({ transactionId, sentAt, onRemove, className, children }) {
  const { data, isLoading } = useTransaction(transactionId)
  const records = data?.records ?? []
  const record = records[0]
  const processed = record?.status === 'PROCESSED'
  const failed = record?.status === 'FAILED'
  const terminal = processed || failed
  const now = useNow(1000, !terminal)

  const expected = expectedProcessingSeconds()
  const elapsed = Math.max(0, (now - sentAt) / 1000)
  const progress = terminal ? 100 : Math.min(99, (elapsed / expected) * 100)
  const overdue = !terminal && elapsed > expected + 15
  const took = processed ? durationSeconds(record.created_at, record.processed_at) : null

  return (
    <div className={cn('bg-card space-y-3 rounded-lg border p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <code className="truncate text-sm font-medium">{transactionId}</code>
            <CopyButton value={transactionId} />
          </div>
          {record && (
            <div className="text-muted-foreground mt-0.5 truncate text-xs">
              {record.source_account} → {record.destination_account}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {record ? (
            <StatusBadge status={record.status} />
          ) : (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <LoaderCircle className="size-3 animate-spin" />
              {isLoading ? 'Loading' : data?.notFound ? 'Not found yet' : data?.error ? 'Error' : 'Waiting'}
            </span>
          )}
          {onRemove && (
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Remove" onClick={onRemove}>
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <Progress value={progress} indicatorClassName={processed ? 'bg-success' : failed || overdue ? 'bg-destructive' : 'bg-warning'} />

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        {failed ? (
          <span className="text-destructive">
            Failed after {record.attempts} attempt(s){record.last_error ? ` · ${record.last_error}` : ''}
          </span>
        ) : processed ? (
          <span>
            Processed at {formatTime(record.processed_at)}
            {took != null && <> · took {took.toFixed(1)}s</>}
          </span>
        ) : (
          <span className={cn('tabular-nums', overdue && 'text-destructive')}>
            {overdue && <CircleAlert className="mr-1 inline size-3" />}
            {Math.floor(elapsed)}s elapsed · ~{expected}s expected
          </span>
        )}
        {record && <Money record={record} className="text-foreground font-medium" />}
      </div>

      {data?.error && !data?.notFound && <div className="text-destructive text-xs">{data.error}</div>}
      {typeof children === 'function' ? children({ data, records, record }) : children}
    </div>
  )
}
