import { useState } from 'react'
import { Check, Copy, LoaderCircle, CircleCheck, CircleX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/misc'
import { formatCurrency, formatMs } from '@/lib/format'
import { LATENCY_BUDGET_MS } from '@/config/app'
import { cn } from '@/lib/utils'

/**
 * Shows the backend's already-converted, already-rounded `amount` in `currency`.
 * Nothing is computed here. When the webhook arrived in another currency, the
 * original is shown as secondary text (showOriginal) or in a tooltip.
 */
export function Money({ record, showOriginal = false, className }) {
  if (!record) return null
  const text = formatCurrency(record.amount, record.currency)
  const differs = record.original_currency && record.original_currency !== record.currency
  if (!differs) return <span className={cn('tabular-nums', className)}>{text}</span>
  const original = `received as ${formatCurrency(record.original_amount, record.original_currency)}`
  if (showOriginal)
    return (
      <span className={cn('tabular-nums', className)}>
        {text}
        <span className="text-muted-foreground block text-xs font-normal">{original}</span>
      </span>
    )
  return (
    <Tooltip content={`${original}${record.fx_rate_as_of ? ` · fixed rate as of ${record.fx_rate_as_of}` : ''}`}>
      <span className={cn('tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 cursor-help', className)}>
        {text}
      </span>
    </Tooltip>
  )
}

export function StatusBadge({ status }) {
  if (status === 'PROCESSED')
    return (
      <Badge variant="success">
        <CircleCheck /> PROCESSED
      </Badge>
    )
  if (status === 'PROCESSING')
    return (
      <Badge variant="warning">
        <LoaderCircle className="animate-spin" /> PROCESSING
      </Badge>
    )
  if (status === 'FAILED')
    return (
      <Badge variant="destructive">
        <CircleX /> FAILED
      </Badge>
    )
  return <Badge variant="outline">{status || 'UNKNOWN'}</Badge>
}

export function LatencyBadge({ ms }) {
  if (ms == null) return null
  const ok = ms < LATENCY_BUDGET_MS
  return (
    <Badge variant={ok ? 'success' : 'destructive'} className="tabular-nums">
      {formatMs(ms)}
    </Badge>
  )
}

export function HttpStatusBadge({ status }) {
  const variant = status >= 200 && status < 300 ? 'success' : status === 0 ? 'destructive' : status >= 400 ? 'destructive' : 'secondary'
  return (
    <Badge variant={variant} className="font-mono tabular-nums">
      {status === 0 ? 'ERR' : status}
    </Badge>
  )
}

export function CopyButton({ value, className }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('size-6', className)}
      aria-label="Copy"
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

export function JsonView({ value, className }) {
  return (
    <pre className={cn('bg-muted/60 max-h-80 overflow-auto rounded-md p-3 text-xs leading-relaxed', className)}>
      {value === undefined || value === null || value === '' ? <span className="text-muted-foreground">empty</span> : JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive')}>{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-center">
      {Icon && <Icon className="size-8 opacity-50" />}
      <div className="text-foreground font-medium">{title}</div>
      {children && <div className="max-w-sm text-sm">{children}</div>}
    </div>
  )
}
