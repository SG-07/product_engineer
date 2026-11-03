import { RadioCard, RadioGroup } from '@/components/ui/misc'
import { CURRENCIES, CURRENCY_CODES, RATES_FROM_INR } from '@/config/currency'
import { formatCurrency } from '@/lib/format'

/** Grid of the 4 supported display currencies. */
export function CurrencyOptions({ value, onChange }) {
  return (
    <RadioGroup value={value ?? ''} onValueChange={onChange} className="grid-cols-1 sm:grid-cols-2">
      {CURRENCY_CODES.map((code) => {
        const c = CURRENCIES[code]
        return (
          <RadioCard key={code} value={code} aria-label={c.name}>
            <span className="text-2xl" aria-hidden>
              {c.flag}
            </span>
            <span className="flex-1">
              <span className="block font-medium">
                {c.code} <span className="text-muted-foreground">({c.symbol})</span>
              </span>
              <span className="text-muted-foreground block text-xs">{c.name}</span>
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {code === 'INR' ? 'base' : `₹1,000 ≈ ${formatCurrency(1000 * RATES_FROM_INR[code], code)}`}
            </span>
          </RadioCard>
        )
      })}
    </RadioGroup>
  )
}
