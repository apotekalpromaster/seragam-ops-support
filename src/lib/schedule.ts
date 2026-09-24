import { useView } from './api'
import { daysBetween, fmtMonth } from './format'

export interface ConfigRow {
  key: string
  value: unknown
  type: 'int' | 'number' | 'bool' | 'text' | 'json'
  label: string
  description: string | null
  grup: string
  sort_order: number
  updated_at: string
}

export function useConfig() {
  const q = useView<ConfigRow>('config', { order: [['grup', 'asc'], ['sort_order', 'asc']] })
  const get = <T,>(k: string, fallback: T): T => {
    const v = q.data?.find((r) => r.key === k)?.value
    return (v === undefined || v === null ? fallback : v) as T
  }
  return { ...q, get }
}

/** Jadwal cutoff & deadline kirim dari parameter config (PRD §4.2). */
export function computeSchedule(today: Date, cutoffDay: number, deadlineDay: number, deadlineNextMonth: boolean) {
  const y = today.getFullYear()
  const m = today.getMonth()
  const cutoffThis = new Date(y, m, cutoffDay)
  const nextCutoff = today.getDate() <= cutoffDay ? cutoffThis : new Date(y, m + 1, cutoffDay)
  // Periode aktif = cutoff terakhir yang sudah lewat (atau hari ini)
  const periodStart = today.getDate() >= cutoffDay ? cutoffThis : new Date(y, m - 1, cutoffDay)
  const deadline = new Date(periodStart.getFullYear(), periodStart.getMonth() + (deadlineNextMonth ? 1 : 0), deadlineDay)
  return {
    nextCutoff,
    daysToCutoff: daysBetween(today, nextCutoff),
    periodStart,
    periodLabel: fmtMonth(periodStart),
    deadline,
    daysToDeadline: daysBetween(today, deadline),
  }
}

export function useSchedule() {
  const c = useConfig()
  return computeSchedule(new Date(), Number(c.get('cutoff_day', 5)), Number(c.get('ship_deadline_day', 20)), Boolean(c.get('ship_deadline_next_month', false)))
}
