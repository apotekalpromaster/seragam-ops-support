import * as Tooltip from '@radix-ui/react-tooltip'
import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { HelpCircle, Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

export { clsx }
/** Gabung kelas Tailwind; kelas belakangan menang (mis. w-44 mengalahkan w-full). */
export const cn = (...a: ClassValue[]) => twMerge(clsx(a))

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/20 disabled:bg-brand-300',
  secondary: 'bg-white text-ink border border-line hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  soft: 'bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        VARIANT[variant], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

// ---------- Form ----------
const inputBase = 'w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-100'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(inputBase, 'h-10', className)} {...p} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={cn(inputBase, 'h-10 pr-8', className)} {...p}>{children}</select>
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(inputBase, 'py-2 min-h-20', className)} {...p} />
})

export function Field({ label, hint, error, required, children, className, htmlFor }: {
  label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string; htmlFor?: string
}) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700">
        {label} {required && <span className="text-red-500" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600" role="alert">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

// ---------- Card ----------
export function Card({ children, className, title, actions, subtitle, bodyClass }: {
  children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; bodyClass?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-white shadow-sm shadow-slate-200/50', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(bodyClass ?? 'p-5')}>{children}</div>
    </section>
  )
}

// ---------- Chip status ----------
export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'slate' | 'brand' | 'violet'
const TONE: Record<Tone, string> = {
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}
export function Chip({ tone = 'slate', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', TONE[tone], className)}>
      {children}
    </span>
  )
}

// ---------- Tooltip penjelasan istilah ----------
export function InfoTip({ children, label = 'Penjelasan' }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        {/* span, bukan button: InfoTip sering berada di dalam tombol sort header tabel (button bersarang tidak valid) */}
        <span role="button" tabIndex={0} aria-label={label} onClick={(e) => e.stopPropagation()}
          className="inline-flex cursor-help align-middle text-slate-400 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-400">
          <HelpCircle className="size-3.5" />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-[70] max-w-xs rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg">
          {children}
          <Tooltip.Arrow className="fill-slate-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Istilah dengan penjelasan (mis. "Available" + tooltip). */
export function Term({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}<InfoTip>{tip}</InfoTip></span>
}

// ---------- State kosong / loading ----------
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon}</div>}
      <p className="text-base font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-slate-200/70', className)} />
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5" aria-busy="true" aria-label="Memuat data">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}
    </div>
  )
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
      <p className="font-semibold">Data tidak bisa dimuat.</p>
      <p className="mt-1 text-red-600/90">{/^[A-Z_]+:/.test(msg) ? msg.replace(/^[A-Z_]+:\s*/, '') : 'Periksa koneksi lalu coba lagi.'}</p>
      {onRetry && <Button size="sm" className="mt-3" onClick={onRetry}>Coba lagi</Button>}
    </div>
  )
}

// ---------- Tabs sederhana ----------
export function Tabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number; hidden?: boolean }[]
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {items.filter((i) => !i.hidden).map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={clsx(
            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
            value === i.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {i.label}
          {i.count !== undefined && (
            <span className={clsx('rounded-full px-1.5 text-[11px]', value === i.value ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600')}>{i.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Kotak info/peringatan inline. */
export function Callout({ tone = 'blue', title, children, icon, action }: { tone?: 'blue' | 'amber' | 'red' | 'green' | 'brand'; title?: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  const t = {
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900 border-l-4 border-l-red-500',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    brand: 'border-brand-200 bg-brand-50 text-brand-900',
  }[tone]
  return (
    <div className={clsx('flex gap-3 rounded-xl border p-4 text-sm', t)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={clsx(title && 'mt-1', 'leading-relaxed opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
