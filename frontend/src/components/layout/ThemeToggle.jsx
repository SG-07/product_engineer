import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/misc'
import { usePreferences, useResolvedTheme } from '@/hooks/useStores'

/** Header quick toggle: flips between light and dark. */
export function ThemeToggle() {
  const [, setPrefs] = usePreferences()
  const resolved = useResolvedTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <Tooltip content={`Switch to ${next} theme`} side="bottom">
      <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setPrefs({ theme: next })}>
        {resolved === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  )
}
