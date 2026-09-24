import { describe, expect, it } from 'vitest'
import { computeSchedule } from './schedule'

describe('computeSchedule', () => {
  it('sebelum cutoff: cutoff bulan ini, periode bulan lalu', () => {
    const s = computeSchedule(new Date(2026, 8, 3), 5, 20, false)
    expect(s.nextCutoff).toEqual(new Date(2026, 8, 5))
    expect(s.daysToCutoff).toBe(2)
    expect(s.deadline).toEqual(new Date(2026, 7, 20))
  })
  it('setelah cutoff: cutoff bulan depan, deadline bulan ini', () => {
    const s = computeSchedule(new Date(2026, 8, 24), 5, 20, false)
    expect(s.nextCutoff).toEqual(new Date(2026, 9, 5))
    expect(s.deadline).toEqual(new Date(2026, 8, 20))
    expect(s.daysToDeadline).toBe(-4)
  })
  it('deadline tanggal 5 bulan berikutnya', () => {
    const s = computeSchedule(new Date(2026, 8, 24), 5, 5, true)
    expect(s.deadline).toEqual(new Date(2026, 9, 5))
    expect(s.daysToDeadline).toBe(11)
  })
})
