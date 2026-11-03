import { useState } from 'react'
import { Database, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { Skeleton, Tooltip } from '@/components/ui/misc'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton, EmptyState, JsonView, Money, StatusBadge } from '@/components/common'
import { useTransactions } from '@/hooks/useApi'
import { useCurrency } from '@/hooks/useStores'
import { durationSeconds, formatCurrency, formatDateTime } from '@/lib/format'

export function TransactionsTable() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const { data, isLoading, isFetching, refetch } = useTransactions({ status: status || undefined, limit: 50 })
  const { currency } = useCurrency()

  const q = search.trim().toLowerCase()
  const records = (data?.records ?? []).filter(
    (r) => !q || [r.transaction_id, r.source_account, r.destination_account].some((v) => String(v).toLowerCase().includes(q)),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Transactions
          {data?.source === 'local' && (
            <Tooltip content="GET /v1/transactions is not available on the backend yet – showing transactions sent from this browser.">
              <Badge variant="warning" className="cursor-help">
                <TriangleAlert /> local fallback
              </Badge>
            </Tooltip>
          )}
        </CardTitle>
        <CardDescription>Latest 50 · amounts shown in {currency} · auto-refreshes while any are processing.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'animate-spin' : ''} /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input placeholder="Search by ID or account…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect className="sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="PROCESSING">Processing</option>
            <option value="PROCESSED">Processed</option>
          </NativeSelect>
        </div>

        {data?.error && (
          <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm">
            <TriangleAlert className="size-4" /> {data.error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <EmptyState icon={Database} title="No transactions">
            {q || status ? 'No transactions match your filters.' : 'Send a webhook to see it here.'}
          </EmptyState>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction</TableHead>
                  <TableHead className="hidden md:table-cell">Source → Destination</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="hidden lg:table-cell">Processed</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => {
                  const d = durationSeconds(r.created_at, r.processed_at)
                  return (
                    <TableRow key={r.transaction_id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell className="font-mono text-xs">{r.transaction_id}</TableCell>
                      <TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
                        {r.source_account} → {r.destination_account}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money amountInr={r.amount} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{formatDateTime(r.created_at)}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{formatDateTime(r.processed_at)}</TableCell>
                      <TableCell className="hidden text-right text-xs tabular-nums sm:table-cell">{d != null ? `${d.toFixed(1)}s` : '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <TransactionDetail record={selected} onClose={() => setSelected(null)} />
    </Card>
  )
}

function TransactionDetail({ record, onClose }) {
  const { currency, format } = useCurrency()
  const d = record ? durationSeconds(record.created_at, record.processed_at) : null
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      {record && (
        <SheetContent className="overflow-y-auto p-6">
          <div className="space-y-1 pr-6">
            <DialogTitle className="flex items-center gap-1 font-mono text-base">
              {record.transaction_id} <CopyButton value={record.transaction_id} />
            </DialogTitle>
            <DialogDescription>Transaction details</DialogDescription>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusBadge status={record.status} /></dd>
            <dt className="text-muted-foreground">Amount ({currency})</dt>
            <dd className="font-medium tabular-nums">{format(record.amount)}</dd>
            <dt className="text-muted-foreground">Amount (stored)</dt>
            <dd className="tabular-nums">{formatCurrency(record.amount, 'INR')}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-mono text-xs">{record.source_account}</dd>
            <dt className="text-muted-foreground">Destination</dt>
            <dd className="font-mono text-xs">{record.destination_account}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(record.created_at)}</dd>
            <dt className="text-muted-foreground">Processed</dt>
            <dd>{formatDateTime(record.processed_at)}</dd>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="tabular-nums">{d != null ? `${d.toFixed(2)}s` : '—'}</dd>
          </dl>
          <div className="space-y-2">
            <div className="text-sm font-medium">Raw JSON</div>
            <JsonView value={record} />
          </div>
        </SheetContent>
      )}
    </Dialog>
  )
}
