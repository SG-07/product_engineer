import { RadioCard, RadioGroup } from '@/components/ui/misc'
import { CURRENCIES, CURRENCY_CODES } from '@/config/currency'
import { useCurrencies } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/format'

/** Grid of the 4 supported display currencies. */
export function CurrencyOptions({ value, onChange }) {
  const rates = useCurrencies().data?.currencies?.rates_to_inr
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
              {code === 'INR' ? 'base' : rates?.[code] != null ? `1 ${code} = ${formatCurrency(rates[code], 'INR')}` : ''}
            </span>
          </RadioCard>
        )
      })}
    </RadioGroup>
  )
}
