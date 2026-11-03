import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { RadioCard, RadioGroup, Switch } from '@/components/ui/misc'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CurrencyOptions } from '@/components/CurrencyOptions'
import { THEME_OPTIONS } from '@/config/theme'
import { usePreferences } from '@/hooks/useStores'
import { API_BASE_URL } from '@/lib/api'
import { resetMockDb } from '@/lib/mockApi'
import { prefsStore } from '@/lib/prefsStore'
import { sentStore } from '@/lib/sentStore'
import { CURRENCIES, CURRENCY_CODES, RATES_FROM_INR, RATES_UPDATED_AT } from '@/config/currency'
import { formatCurrency } from '@/lib/format'

export default function Settings() {
  const [prefs, setPrefs] = usePreferences()
  const queryClient = useQueryClient()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Preferences are saved in this browser.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Display currency</CardTitle>
          <CardDescription>Amounts are stored in INR and converted for display using fixed rates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CurrencyOptions
            value={prefs.currency}
            onChange={(code) => {
              setPrefs({ currency: code })
              toast.success(`Display currency set to ${code}`)
            }}
          />
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">1 INR =</TableHead>
                  <TableHead className="text-right">₹1,000 =</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CURRENCY_CODES.map((code) => (
                  <TableRow key={code}>
                    <TableCell>
                      {CURRENCIES[code].flag} {code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {RATES_FROM_INR[code]} {code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(1000 * RATES_FROM_INR[code], code)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-xs">Rates are fixed as of {RATES_UPDATED_AT} (src/config/currency.js).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Choose light, dark, or follow your system setting.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={prefs.theme} onValueChange={(theme) => setPrefs({ theme })} className="grid-cols-3">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <RadioCard key={value} value={value} className="flex-col justify-center py-4">
                <Icon className="size-5" />
                <span className="text-sm font-medium">{label}</span>
              </RadioCard>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API connection</CardTitle>
          <CardDescription>The backend URL is set at build time via VITE_API_BASE_URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="api-url">Backend base URL</Label>
            <Input id="api-url" value={API_BASE_URL} readOnly className="font-mono" />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="mock-mode">Use mock API</Label>
              <p className="text-muted-foreground mt-1 text-xs">Simulates the backend in the browser — useful until the real service is deployed.</p>
            </div>
            <Switch
              id="mock-mode"
              checked={prefs.useMock}
              onCheckedChange={(useMock) => {
                setPrefs({ useMock })
                queryClient.removeQueries()
                toast.success(useMock ? 'Switched to mock API' : 'Switched to live backend')
              }}
            />
          </div>
          {prefs.useMock && (
            <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="mock-delay">Mock processing delay (seconds)</Label>
                <Input
                  id="mock-delay"
                  type="number"
                  min={1}
                  max={120}
                  value={prefs.mockDelaySeconds}
                  onChange={(e) => setPrefs({ mockDelaySeconds: Math.min(120, Math.max(1, Number(e.target.value) || 1)) })}
                />
                <p className="text-muted-foreground text-xs">The real backend uses 30 seconds. Applies to newly sent transactions.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  resetMockDb()
                  sentStore.clear()
                  queryClient.removeQueries()
                  toast.success('Mock data cleared')
                }}
              >
                <Trash2 /> Clear mock data
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reset</CardTitle>
          <CardDescription>Clear saved preferences and locally tracked transactions. You will be asked to pick a currency again.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => {
              sentStore.clear()
              prefsStore.reset()
              queryClient.removeQueries()
            }}
          >
            <RotateCcw /> Reset preferences
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
