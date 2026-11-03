import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CurrencyOptions } from '@/components/CurrencyOptions'
import { usePreferences } from '@/hooks/useStores'

/** Blocking first-visit modal: the user must pick a display currency. */
export function CurrencyPickerModal() {
  const [prefs, setPrefs] = usePreferences()
  const [choice, setChoice] = useState('INR')
  const open = !prefs.currency

  return (
    <Dialog open={open}>
      <DialogContent
        showClose={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Choose your display currency</DialogTitle>
          <DialogDescription>
            Transactions are stored in Indian Rupees (INR). Amounts will be converted to your preferred currency. You can change this later in
            Settings.
          </DialogDescription>
        </DialogHeader>
        <CurrencyOptions value={choice} onChange={setChoice} />
        <Button className="w-full" disabled={!choice} onClick={() => setPrefs({ currency: choice })}>
          Continue with {choice}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
