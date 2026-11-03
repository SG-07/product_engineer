import { useState } from 'react'
import { ChevronDown, ChevronRight, ScrollText, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/input'
import { Switch } from '@/components/ui/misc'
import { EmptyState, HttpStatusBadge, JsonView, LatencyBadge } from '@/components/common'
import { useRequestLog } from '@/hooks/useStores'
import { requestLog } from '@/lib/requestLog'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export function RequestLog({ open, onOpenChange }) {
  const entries = useRequestLog()
  const [hidePolling, setHidePolling] = useState(true)
  const visible = hidePolling ? entries.filter((e) => e.tag !== 'poll') : entries

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0">
        <div className="space-y-1 border-b p-4 pr-10">
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="size-4" /> Request log
          </DialogTitle>
          <DialogDescription>Every API call made by this dashboard (last 200, in memory).</DialogDescription>
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Switch id="hide-polling" checked={hidePolling} onCheckedChange={setHidePolling} />
              <Label htmlFor="hide-polling" className="text-muted-foreground font-normal">
                Hide background polling
              </Label>
            </div>
            <Button variant="ghost" size="sm" onClick={() => requestLog.clear()} disabled={!entries.length}>
              <Trash2 /> Clear
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <EmptyState icon={ScrollText} title="No requests yet">
              {hidePolling && entries.length ? 'Only background polling so far – toggle the switch to see it.' : 'API calls will appear here.'}
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {visible.map((e) => (
                <LogEntry key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Dialog>
  )
}

function LogEntry({ entry }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button type="button" className="hover:bg-muted/50 flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm cursor-pointer" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <Badge variant="outline" className={cn('w-12 font-mono', entry.method === 'POST' && 'text-chart-1')}>
          {entry.method}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.path}</span>
        <HttpStatusBadge status={entry.status} />
        <LatencyBadge ms={entry.latencyMs} />
        <span className="text-muted-foreground hidden w-16 text-right text-xs tabular-nums sm:inline">{formatTime(entry.startedAt)}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 pl-10">
          <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
            <span>{entry.mock ? 'Mock API' : 'Live backend'}</span>
            {entry.tag && <span>· {entry.tag}</span>}
            <span>· {new Date(entry.startedAt).toLocaleString()}</span>
          </div>
          {entry.error && <div className="text-destructive text-xs">{entry.error}</div>}
          {entry.requestBody && (
            <div className="space-y-1">
              <div className="text-xs font-medium">Request body</div>
              <JsonView value={entry.requestBody} />
            </div>
          )}
          <div className="space-y-1">
            <div className="text-xs font-medium">Response body</div>
            <JsonView value={entry.responseBody} />
          </div>
        </div>
      )}
    </li>
  )
}
