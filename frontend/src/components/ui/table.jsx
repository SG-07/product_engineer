import { cn } from '@/lib/utils'

function Table({ className, ...props }) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

const TableHeader = ({ className, ...props }) => <thead className={cn('[&_tr]:border-b', className)} {...props} />
const TableBody = ({ className, ...props }) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
const TableRow = ({ className, ...props }) => (
  <tr className={cn('hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors', className)} {...props} />
)
const TableHead = ({ className, ...props }) => (
  <th className={cn('text-muted-foreground h-10 px-3 text-left align-middle font-medium whitespace-nowrap', className)} {...props} />
)
const TableCell = ({ className, ...props }) => <td className={cn('px-3 py-2 align-middle whitespace-nowrap', className)} {...props} />

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
