import clsx from 'clsx'
import { Check } from 'lucide-react'

/** Penanda langkah multi-step (heuristik #1: pengguna tahu sedang di langkah mana). */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Langkah">
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span className={clsx(
              'flex size-7 items-center justify-center rounded-full text-xs font-bold ring-1',
              done ? 'bg-emerald-500 text-white ring-emerald-500' : active ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-slate-400 ring-slate-300',
            )}>
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={clsx('font-semibold', active ? 'text-ink' : done ? 'text-emerald-700' : 'text-slate-400')}>{s}</span>
            {i < steps.length - 1 && <span className={clsx('mx-1 h-px w-6 sm:w-10', done ? 'bg-emerald-400' : 'bg-slate-200')} />}
          </li>
        )
      })}
    </ol>
  )
}
