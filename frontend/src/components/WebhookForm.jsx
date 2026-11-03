import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, Send, Shuffle, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { EmptyState, HttpStatusBadge, LatencyBadge } from '@/components/common'
import { TransactionTracker } from '@/components/TransactionTracker'
import { useCurrency, useSentTransactions } from '@/hooks/useStores'
import { sendWebhook } from '@/lib/api'
import { newTransactionId, randomPayload } from '@/lib/ids'
import { sentStore } from '@/lib/sentStore'

const initialForm = () => ({ ...randomPayload(), amount: '1500' })

export function WebhookForm() {
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [last, setLast] = useState(null)
  const { currency, format } = useCurrency()
  const queryClient = useQueryClient()
  const sent = useSentTransactions().filter((s) => s.kind === 'single').slice(0, 6)

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function validate() {
    const e = {}
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(form.transaction_id)) e.transaction_id = '3–64 chars: letters, digits, _ or -'
    if (!form.source_account.trim()) e.source_account = 'Required'
    if (!form.destination_account.trim()) e.destination_account = 'Required'
    const amt = Number(form.amount)
    if (!form.amount || !Number.isFinite(amt) || amt <= 0) e.amount = 'Enter a positive amount'
    else if (!/^\d+(\.\d{1,2})?$/.test(form.amount)) e.amount = 'Max 2 decimal places'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSending(true)
    const payload = {
      transaction_id: form.transaction_id.trim(),
      source_account: form.source_account.trim(),
      destination_account: form.destination_account.trim(),
      amount: Number(form.amount),
      currency: 'INR',
    }
    const res = await sendWebhook(payload)
    setSending(false)
    setLast({ ...res, transaction_id: payload.transaction_id })

    if (res.ok) {
      sentStore.add({ transaction_id: payload.transaction_id, kind: 'single' })
      queryClient.invalidateQueries({ queryKey: ['txns'] })
      toast.success(`Webhook accepted (${res.status})`, { description: payload.transaction_id })
      setForm((f) => ({ ...f, transaction_id: newTransactionId() }))
    } else {
      toast.error(`Webhook failed${res.status ? ` (${res.status})` : ''}`, { description: res.error })
    }
  }

  const amountPreview = Number(form.amount) > 0 && currency !== 'INR' ? `≈ ${format(Number(form.amount))}` : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Send a webhook</CardTitle>
          <CardDescription>POST /v1/webhooks/transactions — expects 202 within 500 ms.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" type="button" onClick={() => { setForm(randomPayload()); setErrors({}) }}>
              <Shuffle /> Randomize
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Transaction ID" error={errors.transaction_id} htmlFor="transaction_id">
              <div className="flex gap-2">
                <Input id="transaction_id" className="font-mono" value={form.transaction_id} onChange={update('transaction_id')} aria-invalid={!!errors.transaction_id} />
                <Button type="button" variant="outline" size="icon" aria-label="Regenerate ID" onClick={() => setForm((f) => ({ ...f, transaction_id: newTransactionId() }))}>
                  <RefreshCw />
                </Button>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Source account" error={errors.source_account} htmlFor="source_account">
                <Input id="source_account" className="font-mono" value={form.source_account} onChange={update('source_account')} aria-invalid={!!errors.source_account} />
              </Field>
              <Field label="Destination account" error={errors.destination_account} htmlFor="destination_account">
                <Input id="destination_account" className="font-mono" value={form.destination_account} onChange={update('destination_account')} aria-invalid={!!errors.destination_account} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Amount (₹ INR)" error={errors.amount} hint={amountPreview} htmlFor="amount">
                <Input id="amount" inputMode="decimal" value={form.amount} onChange={update('amount')} aria-invalid={!!errors.amount} />
              </Field>
              <Field label="Currency" hint="Stored in INR" htmlFor="currency">
                <Input id="currency" value="INR" disabled readOnly />
              </Field>
            </div>
            <Button type="submit" className="w-full" disabled={sending}>
              <Send /> {sending ? 'Sending…' : 'Send webhook'}
            </Button>

            {last && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                <span className="text-muted-foreground">Last response:</span>
                <HttpStatusBadge status={last.status} />
                <LatencyBadge ms={last.latencyMs} />
                <code className="text-muted-foreground truncate text-xs">{last.transaction_id}</code>
                {last.error && <span className="text-destructive w-full text-xs">{last.error}</span>}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live tracking</CardTitle>
          <CardDescription>Polls each transaction every 2s until it is processed.</CardDescription>
          {sent.length > 0 && (
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => sentStore.removeKind('single')}>
                Clear
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {sent.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing tracked yet">
              Send a webhook and watch it move from PROCESSING to PROCESSED.
            </EmptyState>
          ) : (
            sent.map((s) => <TransactionTracker key={s.transaction_id} transactionId={s.transaction_id} sentAt={s.sentAt} />)
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, error, hint, htmlFor, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}
