import { useState } from 'react'
import { Link, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { Header } from '@/components/layout/Header'
import { CurrencyPickerModal } from '@/components/CurrencyPickerModal'
import { RequestLog } from '@/components/RequestLog'
import { TooltipProvider } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { useApplyTheme, useResolvedTheme } from '@/hooks/useStores'
import Dashboard from '@/pages/Dashboard'
import Settings from '@/pages/Settings'

export default function App() {
  const [logOpen, setLogOpen] = useState(false)
  useApplyTheme()
  const theme = useResolvedTheme()

  return (
    <TooltipProvider>
      <div className="min-h-svh">
        <Header onOpenLog={() => setLogOpen(true)} />
        <main className="mx-auto max-w-7xl px-4 py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <RequestLog open={logOpen} onOpenChange={setLogOpen} />
        <CurrencyPickerModal />
        <Toaster theme={theme} richColors position="bottom-right" />
      </div>
    </TooltipProvider>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}
