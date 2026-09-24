import { useMemo, useState } from 'react'
import { useView } from '../lib/api'
import { EMP_STATUS_LABEL } from '../lib/labels'
import { Field, Input } from './ui'

export interface PickedEmployee {
  nik: string; nama: string; gender: 'P' | 'W'; jabatan: string; kode_cabang: string; cabang_nama: string; status: string
}

/** Cari karyawan dengan NIK atau nama (heuristik #6: kenali, jangan hafal NIK). */
export function EmployeePicker({ value, onChange, statuses = ['AKTIF', 'OFFERING'], label = 'Karyawan', hint }: {
  value: PickedEmployee | null
  onChange: (e: PickedEmployee | null) => void
  statuses?: string[]
  label?: string
  hint?: string
}) {
  const emps = useView<PickedEmployee>('v_employee_list', {
    columns: 'nik,nama,gender,jabatan,kode_cabang,cabang_nama,status', filters: [['status', 'in', statuses]], order: [['nama', 'asc']],
  })
  const [search, setSearch] = useState('')
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (s.length < 2) return []
    return (emps.data ?? []).filter((e) => e.nik.toLowerCase().includes(s) || e.nama.toLowerCase().includes(s)).slice(0, 8)
  }, [emps.data, search])

  if (value) {
    return (
      <Field label={label}>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
          <span><b>{value.nama}</b> · {value.nik} · {value.jabatan} · {value.cabang_nama}{value.status !== 'AKTIF' && ` · ${EMP_STATUS_LABEL[value.status]}`}</span>
          <button type="button" className="shrink-0 text-xs font-semibold text-brand-700 hover:underline" onClick={() => { onChange(null); setSearch('') }}>Ganti</button>
        </div>
      </Field>
    )
  }
  return (
    <Field label={label} required hint={hint ?? 'Ketik minimal 2 huruf NIK atau nama.'}>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus placeholder="mis. 2250012 atau Siti" aria-label={`Cari ${label.toLowerCase()}`} />
      {matches.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-line">
          {matches.map((e) => (
            <li key={e.nik}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => onChange(e)}>
                <b>{e.nama}</b> <span className="text-muted">· {e.nik} · {e.jabatan} · {e.cabang_nama}{e.status !== 'AKTIF' && ` · ${EMP_STATUS_LABEL[e.status]}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.trim().length >= 2 && !matches.length && !emps.isLoading && <p className="mt-2 text-sm text-muted">Tidak ditemukan karyawan dengan kata kunci itu.</p>}
    </Field>
  )
}
