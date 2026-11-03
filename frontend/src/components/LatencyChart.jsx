import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { LATENCY_BUDGET_MS } from '@/config/app'
import { formatMs } from '@/lib/format'

const GOOD = '#22c55e'
const BAD = '#ef4444'

/** Bar chart of per-request latency with the 500 ms budget as a reference line. */
export function LatencyChart({ results }) {
  const data = results.map((r) => ({ name: r.i, latency: Math.round(r.latencyMs), status: r.status }))
  const max = Math.max(LATENCY_BUDGET_MS * 1.2, ...data.map((d) => d.latency))

  return (
    <div className="text-muted-foreground h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, Math.ceil(max / 100) * 100]} unit="ms" width={60} />
          <Tooltip
            cursor={{ fill: 'currentColor', fillOpacity: 0.08 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
                  <div className="font-medium">Request #{payload[0].payload.name}</div>
                  <div>Latency: {formatMs(payload[0].payload.latency)}</div>
                  <div>HTTP: {payload[0].payload.status || 'ERR'}</div>
                </div>
              ) : null
            }
          />
          <ReferenceLine
            y={LATENCY_BUDGET_MS}
            stroke={BAD}
            strokeDasharray="6 4"
            label={{ value: '500 ms budget', position: 'insideTopRight', fill: BAD, fontSize: 11 }}
          />
          <Bar dataKey="latency" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.latency < LATENCY_BUDGET_MS && d.status >= 200 && d.status < 300 ? GOOD : BAD} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const CLIENT = '#6366f1'
const SERVER = '#22c55e'

/** Line chart: browser-measured vs server-measured time per webhook, with the 500 ms budget. */
export function LatencyLines({ data }) {
  const max = Math.max(LATENCY_BUDGET_MS * 1.2, ...data.map((d) => d.client ?? 0))
  return (
    <div className="text-muted-foreground h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} vertical={false} />
          <XAxis dataKey="n" tick={{ fill: 'currentColor', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, Math.ceil(max / 100) * 100]} unit="ms" width={60} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
                  <div className="font-medium">Webhook #{payload[0].payload.n}</div>
                  <div>Browser: {formatMs(payload[0].payload.client)}</div>
                  <div>Server: {formatMs(payload[0].payload.server)}</div>
                </div>
              ) : null
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={LATENCY_BUDGET_MS} stroke={BAD} strokeDasharray="6 4" label={{ value: '500 ms budget', position: 'insideTopRight', fill: BAD, fontSize: 11 }} />
          <Line name="Browser (incl. network)" dataKey="client" stroke={CLIENT} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line name="Server only" dataKey="server" stroke={SERVER} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
