import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Drawer } from '../../components/dialog'
import { Card, Chip, Select } from '../../components/ui'
import { useView } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { AKSI_LABEL, ENTITAS_LABEL } from '../../lib/labels'

interface Log { id: number; user_nama: string | null; aksi: string; entitas: string; entitas_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; created_at: string }

const HIDE = new Set(['created_at', 'updated_at', 'created_by', 'updated_by', 'id'])

function changes(l: Log) {
  const keys = [...new Set([...Object.keys(l.before ?? {}), ...Object.keys(l.after ?? {})])].filter((k) => !HIDE.has(k))
  return keys.filter((k) => JSON.stringify(l.before?.[k]) !== JSON.stringify(l.after?.[k])).map((k) => ({ k, from: l.before?.[k], to: l.after?.[k] }))
}
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function AuditPage() {
  const q = useView<Log>('v_audit_log', { order: [['id', 'desc']], limit: 3000 })
  const [ent, setEnt] = useState('')
  const [open, setOpen] = useState<Log | null>(null)
  const data = useMemo(() => (q.data ?? []).filter((l) => !ent || l.entitas === ent), [q.data, ent])
  const entities = useMemo(() => [...new Set((q.data ?? []).map((l) => l.entitas))].sort(), [q.data])
  const columns = useMemo<ColumnDef<Log>[]>(() => [
    { accessorKey: 'created_at', header: 'Waktu', cell: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.getValue() as string)}</span> },
    { accessorKey: 'user_nama', header: 'Oleh', cell: (c) => (c.getValue() as string) ?? <span className="text-muted">sistem / seed</span> },
    { accessorKey: 'aksi', header: 'Aksi', cell: (c) => { const a = c.getValue() as string; return <Chip tone={a === 'DELETE' ? 'red' : a === 'INSERT' ? 'green' : 'blue'}>{AKSI_LABEL[a] ?? a}</Chip> } },
    { accessorKey: 'entitas', header: 'Data', cell: ({ row: { original: l } }) => <span>{ENTITAS_LABEL[l.entitas] ?? l.entitas} <code className="text-xs text-muted">{l.entitas_id}</code></span>, meta: { exportValue: (l) => `${ENTITAS_LABEL[l.entitas] ?? l.entitas} ${l.entitas_id ?? ''}` } },
    { id: 'ringkas', header: 'Perubahan', enableSorting: false, meta: { exportValue: (l) => changes(l).map((c) => `${c.k}: ${show(c.from)} → ${show(c.to)}`).join('; ') },
      cell: ({ row: { original: l } }) => {
        const c = changes(l)
        return <span className="text-xs text-muted">{c.slice(0, 3).map((x) => `${x.k}: ${show(x.from)} → ${show(x.to)}`).join(' · ')}{c.length > 3 ? ` · +${c.length - 3} lainnya` : ''}</span>
      } },
  ], [])
  return (
    <Page title="Riwayat & Audit Log" subtitle="Semua perubahan master, config, paket, mapping, dan pengguna" help="audit">
      <Card bodyClass="p-0">
        <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} onRowClick={setOpen} searchKeys={['user_nama', 'entitas_id']} searchPlaceholder="Cari pengguna / kode data…" exportName="audit-log" dense
          toolbar={<Select aria-label="Filter jenis data" value={ent} onChange={(e) => setEnt(e.target.value)} className="h-10 w-52">
            <option value="">Semua jenis data</option>
            {entities.map((e) => <option key={e} value={e}>{ENTITAS_LABEL[e] ?? e}</option>)}
          </Select>} />
      </Card>
      {open && (
        <Drawer open onOpenChange={(o) => !o && setOpen(null)} title={`${AKSI_LABEL[open.aksi] ?? open.aksi} ${ENTITAS_LABEL[open.entitas] ?? open.entitas}`} subtitle={`${open.entitas_id ?? ''} · ${open.user_nama ?? 'sistem'} · ${fmtDateTime(open.created_at)}`}>
          <table className="w-full rounded-xl bg-white text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Kolom</th><th className="p-2">Sebelum</th><th className="p-2">Sesudah</th></tr></thead>
            <tbody>
              {changes(open).map((c) => (
                <tr key={c.k} className="border-t border-slate-100"><td className="p-2 font-medium">{c.k}</td><td className="p-2 text-red-700">{show(c.from)}</td><td className="p-2 text-emerald-700">{show(c.to)}</td></tr>
              ))}
            </tbody>
          </table>
        </Drawer>
      )}
    </Page>
  )
}
