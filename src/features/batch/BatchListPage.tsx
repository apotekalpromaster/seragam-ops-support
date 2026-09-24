import type { ColumnDef } from '@tanstack/react-table'
import { PackagePlus, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Button, Card, Chip, EmptyState, Select, type Tone } from '../../components/ui'
import { useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtMonth, fmtNum } from '../../lib/format'
import { BATCH_JENIS_LABEL, BATCH_STATUS_LABEL } from '../../lib/labels'
import { CreateBatchModal } from './CreateBatchModal'

export interface BatchRow {
  id: number; kode: string; jenis: string; periode: string; status: string; deadline_kirim: string; catatan: string | null
  created_at: string; created_by_nama: string | null; shipped_at: string | null; shipped_by_nama: string | null; selesai_at: string | null
  alasan_batal: string | null; jumlah_baris: number; jumlah_pcs: number; jumlah_karyawan: number; jumlah_cabang: number
  cabang_diterima: number; jumlah_shortage: number; terlambat: boolean; cakupan: Record<string, unknown>
}

export const BATCH_TONE: Record<string, Tone> = { DRAFT: 'slate', PICKING: 'amber', PACKED: 'amber', SHIPPED: 'blue', SELESAI: 'green', DIBATALKAN: 'slate' }

export default function BatchListPage() {
  const q = useView<BatchRow>('v_batch', { order: [['id', 'desc']] })
  const { canWrite } = usePerm()
  const nav = useNavigate()
  const [status, setStatus] = useState('aktif')
  const [creating, setCreating] = useState(false)
  const data = useMemo(() => (q.data ?? []).filter((b) =>
    status === 'semua' || (status === 'aktif' ? !['SELESAI', 'DIBATALKAN'].includes(b.status) : b.status === status)), [q.data, status])

  const columns = useMemo<ColumnDef<BatchRow>[]>(() => [
    { accessorKey: 'kode', header: 'Batch', cell: ({ row: { original: b } }) => (
      <div><p className="font-bold">{b.kode}</p><p className="text-xs text-muted">{BATCH_JENIS_LABEL[b.jenis]} · {fmtMonth(b.periode)}</p></div>
    ) },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: b } }) => (
      <div className="flex flex-wrap gap-1"><Chip tone={BATCH_TONE[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Chip>{b.terlambat && b.status !== 'DIBATALKAN' && <Chip tone="red">terlambat</Chip>}</div>
    ), meta: { exportValue: (b) => BATCH_STATUS_LABEL[b.status] } },
    { accessorKey: 'deadline_kirim', header: 'Deadline kirim', cell: ({ row: { original: b } }) => (
      <div><p className="whitespace-nowrap">{fmtDate(b.deadline_kirim)}</p>{b.shipped_at && <p className="text-xs text-muted">dikirim {fmtDate(b.shipped_at)}</p>}</div>
    ) },
    { accessorKey: 'jumlah_karyawan', header: 'Karyawan', meta: { align: 'right' } },
    { accessorKey: 'jumlah_pcs', header: 'Pcs', meta: { align: 'right' } },
    { id: 'terima', header: 'Diterima cabang', accessorFn: (b) => `${b.cabang_diterima}/${b.jumlah_cabang}`, cell: ({ row: { original: b } }) => (
      <div className="min-w-32">
        <div className="flex justify-between text-xs"><span className="num">{b.cabang_diterima} / {b.jumlah_cabang} cabang</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${b.jumlah_cabang ? (b.cabang_diterima / b.jumlah_cabang) * 100 : 0}%` }} /></div>
      </div>
    ) },
    { accessorKey: 'jumlah_shortage', header: 'Kurang stok', meta: { align: 'right' }, cell: (c) => (c.getValue() as number) ? <span className="font-semibold text-red-600">{fmtNum(c.getValue() as number)} baris</span> : <span className="text-slate-300">0</span> },
    { accessorKey: 'created_by_nama', header: 'Dibuat', cell: ({ row: { original: b } }) => <span className="text-xs">{b.created_by_nama ?? '—'}<br /><span className="text-muted">{fmtDate(b.created_at)}</span></span> },
  ], [])

  return (
    <Page title="Batch Distribusi" subtitle="Draft → Picking → Packed → Dikirim → Selesai (semua cabang konfirmasi terima)" help="batch"
      actions={canWrite && <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={() => setCreating(true)}>Buat batch</Button>}>
      <Card bodyClass="p-0">
        <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} onRowClick={(b) => nav(`/batch/${b.id}`)}
          searchKeys={['kode']} searchPlaceholder="Cari kode batch…" exportName="batch-distribusi"
          rowClassName={(b) => (b.terlambat && !['SELESAI', 'DIBATALKAN', 'SHIPPED'].includes(b.status) ? 'bg-red-50/40' : undefined)}
          toolbar={<Select aria-label="Filter status batch" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-48">
            <option value="aktif">Belum selesai</option>
            {Object.entries(BATCH_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="semua">Semua batch</option>
          </Select>}
          empty={<EmptyState icon={<Truck className="size-5" />} title={status === 'aktif' ? 'Tidak ada batch yang sedang berjalan' : 'Belum ada batch'}
            action={canWrite && <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={() => setCreating(true)}>Buat batch</Button>}>
            Batch dibuat dari Antrian Alokasi. Batch reguler dibuat sekali per periode cutoff.
          </EmptyState>} />
      </Card>
      {creating && <CreateBatchModal onClose={() => setCreating(false)} />}
    </Page>
  )
}
