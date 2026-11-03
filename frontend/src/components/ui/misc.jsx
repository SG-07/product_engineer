import { Progress as ProgressPrimitive, Switch as SwitchPrimitive, Tooltip as TooltipPrimitive, RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

export function Progress({ className, value, indicatorClassName, ...props }) {
  return (
    <ProgressPrimitive.Root className={cn('bg-muted relative h-2 w-full overflow-hidden rounded-full', className)} value={value} {...props}>
      <ProgressPrimitive.Indicator
        className={cn('bg-primary h-full w-full flex-1 transition-transform duration-500 ease-linear', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none cursor-pointer focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
}

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({ content, children, side = 'top' }) {
  if (!content) return children
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          className="bg-foreground text-background animate-in fade-in-0 zoom-in-95 z-50 w-fit max-w-xs rounded-md px-3 py-1.5 text-xs"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-foreground" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export function RadioGroup({ className, ...props }) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-3', className)} {...props} />
}

/** Card-style radio option. */
export function RadioCard({ className, children, ...props }) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'border-input hover:bg-accent/50 data-[state=checked]:border-primary data-[state=checked]:ring-primary/30 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition outline-none cursor-pointer data-[state=checked]:ring-2 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  )
}

export function Separator({ className, ...props }) {
  return <div role="separator" className={cn('bg-border h-px w-full shrink-0', className)} {...props} />
}

export function Skeleton({ className, ...props }) {
  return <div className={cn('bg-accent animate-pulse rounded-md', className)} {...props} />
}
