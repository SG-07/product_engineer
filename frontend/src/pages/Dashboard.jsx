import { Gauge, Repeat, Send } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WebhookForm } from '@/components/WebhookForm'
import { IdempotencyTest } from '@/components/IdempotencyTest'
import { LoadTest } from '@/components/LoadTest'
import { TransactionsTable } from '@/components/TransactionsTable'
import { LiveStats } from '@/components/LiveStats'
import { LiveLatency } from '@/components/LiveLatency'
import { LivePipeline } from '@/components/LivePipeline'

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhook testing dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Send transaction webhooks, watch background processing, and verify idempotency and response times.
        </p>
      </div>

      <LiveStats />

      <div className="grid gap-6 xl:grid-cols-2">
        <LivePipeline />
        <LiveLatency />
      </div>

      <Tabs defaultValue="send">
        <TabsList>
          <TabsTrigger value="send">
            <Send /> Send webhook
          </TabsTrigger>
          <TabsTrigger value="idempotency">
            <Repeat /> Idempotency
          </TabsTrigger>
          <TabsTrigger value="load">
            <Gauge /> Load test
          </TabsTrigger>
        </TabsList>
        {/* forceMount keeps running tests alive when switching tabs */}
        <TabsContent value="send" forceMount className="data-[state=inactive]:hidden">
          <WebhookForm />
        </TabsContent>
        <TabsContent value="idempotency" forceMount className="data-[state=inactive]:hidden">
          <IdempotencyTest />
        </TabsContent>
        <TabsContent value="load" forceMount className="data-[state=inactive]:hidden">
          <LoadTest />
        </TabsContent>
      </Tabs>

      <TransactionsTable />
    </div>
  )
}
