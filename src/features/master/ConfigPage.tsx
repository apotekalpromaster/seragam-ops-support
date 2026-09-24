import { Check, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { Page } from '../../components/AppShell'
import { Button, Card, Chip, Input, LoadingBlock, Select } from '../../components/ui'
import { useRpc } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'
import { useConfig, type ConfigRow } from '../../lib/schedule'
import { ReadOnlyNote } from './common'

const HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']

function display(r: ConfigRow) {
  if (r.type === 'bool') return r.value ? 'Ya' : 'Tidak'
  if (r.key === 'adhoc_batch_weekday') return HARI[Number(r.value)] ?? String(r.value)
  if (r.key === 'replacement_cycle_months' && Number(r.value) === 0) return 'Nonaktif'
  if (r.type === 'number') return String(r.value).replace('.', ',')
  return String(r.value)
}

export default function ConfigPage() {
  const c = useConfig()
  const { isAdmin } = usePerm()
  const groups = [...new Set((c.data ?? []).map((r) => r.grup))]
  return (
    <Page title="Parameter" subtitle="Aturan bisnis sebagai konfigurasi — berubah tanpa mengubah kode" help="parameter">
      {!isAdmin && <ReadOnlyNote />}
      {c.isLoading ? <Card><LoadingBlock /></Card> : groups.map((g) => (
        <Card key={g} title={g} bodyClass="p-0">
          <ul className="divide-y divide-slate-100">
            {c.data!.filter((r) => r.grup === g).map((r) => <ConfigItem key={r.key} row={r} editable={isAdmin} />)}
          </ul>
        </Card>
      ))}
    </Page>
  )
}

function ConfigItem({ row, editable }: { row: ConfigRow; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(String(row.value))
  const m = useRpc('fn_config_set', { success: `${row.label} disimpan.` })
  async function save() {
    const value = row.type === 'bool' ? v === 'true' : row.type === 'int' || row.type === 'number' ? Number(v.replace(',', '.')) : v
    try { await m.mutateAsync({ key: row.key, value }); setEditing(false) } catch { /* toast */ }
  }
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{row.label}</p>
        <p className="text-sm text-muted">{row.description}</p>
        <p className="mt-0.5 text-xs text-slate-400">Diubah {fmtDateTime(row.updated_at)} · <code>{row.key}</code></p>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          {row.type === 'bool' ? (
            <Select value={v} onChange={(e) => setV(e.target.value)} className="h-9 w-28" aria-label={row.label}><option value="true">Ya</option><option value="false">Tidak</option></Select>
          ) : row.key === 'adhoc_batch_weekday' ? (
            <Select value={v} onChange={(e) => setV(e.target.value)} className="h-9 w-32" aria-label={row.label}>{HARI.slice(1).map((h, i) => <option key={h} value={i + 1}>{h}</option>)}</Select>
          ) : (
            <Input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" className="h-9 w-28 text-right num" aria-label={row.label} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }} />
          )}
          <Button size="sm" variant="primary" loading={m.isPending} onClick={() => void save()} aria-label="Simpan"><Check className="size-4" /></Button>
          <Button size="sm" onClick={() => { setEditing(false); setV(String(row.value)) }} aria-label="Batal"><X className="size-4" /></Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Chip tone="brand" className="text-sm">{display(row)}</Chip>
          {editable && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Ubah</Button>}
        </div>
      )}
    </li>
  )
}
