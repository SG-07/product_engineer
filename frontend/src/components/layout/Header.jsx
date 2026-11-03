import { NavLink } from 'react-router'
import { LayoutDashboard, ScrollText, Settings, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/misc'
import { HealthBadge } from '@/components/HealthBadge'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { usePreferences, useRequestLog } from '@/hooks/useStores'
import { API_BASE_URL } from '@/lib/api'
import { cn } from '@/lib/utils'

const navClass = ({ isActive }) =>
  cn(
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  )

export function Header({ onOpenLog }) {
  const [{ useMock, currency }] = usePreferences()
  const log = useRequestLog()

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md">
            <Webhook className="size-4" />
          </span>
          <span className="hidden sm:inline">Txn Webhooks</span>
        </div>

        <nav className="ml-2 flex items-center gap-1">
          <NavLink to="/" end className={navClass}>
            <LayoutDashboard className="size-4" />
            <span className="hidden md:inline">Dashboard</span>
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            <Settings className="size-4" />
            <span className="hidden md:inline">Settings</span>
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip content={useMock ? 'Using the in-browser mock API' : `Backend: ${API_BASE_URL}`} side="bottom">
            <Badge variant={useMock ? 'warning' : 'secondary'} className="hidden h-7 sm:inline-flex">
              {useMock ? 'MOCK' : 'LIVE'}
            </Badge>
          </Tooltip>
          {currency && (
            <Badge variant="outline" className="hidden h-7 sm:inline-flex">
              {currency}
            </Badge>
          )}
          <HealthBadge />
          <Tooltip content="Request log" side="bottom">
            <Button variant="ghost" size="icon" className="relative" aria-label="Open request log" onClick={onOpenLog}>
              <ScrollText />
              {log.length > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 tabular-nums">
                  {log.length > 99 ? '99+' : log.length}
                </span>
              )}
            </Button>
          </Tooltip>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
