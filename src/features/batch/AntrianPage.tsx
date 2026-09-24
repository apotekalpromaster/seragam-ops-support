import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { PackagePlus, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Button, Callout, Card, Chip, EmptyState, Select, Tabs } from '../../components/ui'
import { useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate } from '../../lib/format'
import { EMP_STATUS_LABEL } from '../../lib/labels'
import { EmployeeCard } from '../employee/EmployeeCard'
import { CreateBatchModal } from './CreateBatchModal'
import { HireEventModal } from './HireEventModal'

interface Q {
  nik: string; item_code: string; item_nama: string; item_sort: number; outstanding: number; sisa: number; qty_dalam_batch: number
  sku_target: string | null; size_code: string | null; sku_gender: string | null; size_status: string; nama: string; jabatan: string; kode_cabang: string
  cabang_nama: string; area: string | null; status: string; planned_join_date: string | null; join_date: string | null
  aging_hari: number | null; is_late_hire: boolean; batch_id: number | null; batch_kode: string | null
}
export interface QRow {
  nik: string; nama: string; jabatan: string; kode_cabang: string; cabang_nama: string; area: string | null; status: string
  tanggal_join: string | null; aging: number | null; is_late_hire: boolean
  items: Q[]; siap: number; tunggu_ukuran: number; tidak_tersedia: number; dalam_batch: number; batch_kode: string | null; batch_id: number | null
}
type TabKey = 'siap' | 'menunggu_ukuran' | 'tidak_tersedia' | 'dalam_batch'

function group(rows: Q[]): QRow[] {
  const m = new Map<string, QRow>()
  for (const r of rows) {
    const g = m.get(r.nik) ?? {
      nik: r.nik, nama: r.nama, jabatan: r.jabatan, kode_cabang: r.kode_cabang, cabang_nama: r.cabang_nama, area: r.area, status: r.status,
      tanggal_join: r.join_date ?? r.planned_join_date, aging: r.aging_hari, is_late_hire: r.is_late_hire,
      items: [], siap: 0, tunggu_ukuran: 0, tidak_tersedia: 0, dalam_batch: 0, batch_kode: null, batch_id: null,
    }
    g.items.push(r)
    if (r.sisa > 0 && r.size_status === 'OK') g.siap += r.sisa
    if (r.sisa > 0 && r.size_status === 'KOSONG') g.tunggu_ukuran += r.sisa
    if (r.sisa > 0 && r.size_status === 'TIDAK_TERSEDIA') g.tidak_tersedia += r.sisa
    if (r.qty_dalam_batch > 0) { g.dalam_batch += r.qty_dalam_batch; g.batch_kode = r.batch_kode; g.batch_id = r.batch_id }
    m.set(r.nik, g)
  }
  return [...m.values()]
}

export default function AntrianPage() {
  const q = useView<Q>('v_queue', { order: [['nama', 'asc'], ['item_sort', 'asc']] })
  const { canWrite } = usePerm()
  const [params, setParams] = useSearchParams()
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const tab = (params.get('tab') as TabKey) ?? 'siap'
  const area = params.get('area') ?? ''
  const jabatan = params.get('jabatan') ?? ''
  const item = params.get('item') ?? ''
  const aging = params.get('aging') ?? ''
  const hire = params.get('hire') === '1'
  const [open, setOpen] = useState<string | null>(null)
  const [modal, setModal] = useState<{ kind: 'batch'; niks?: string[]; adhocHire?: boolean } | { kind: 'hire' } | null>(null)

  const all = useMemo(() => group(q.data ?? []), [q.data])
  const filtered = useMemo(() => all.filter((r) =>
    (!area || r.area === area) && (!jabatan || r.jabatan === jabatan) && (!hire || r.is_late_hire) &&
    (!item || r.items.some((i) => i.item_code === item && i.sisa > 0)) &&
    (!aging || (r.aging ?? -1) > Number(aging))), [all, area, jabatan, item, aging, hire])
  const inTab = (r: QRow, t: TabKey) => ({ siap: r.siap > 0, menunggu_ukuran: r.tunggu_ukuran > 0, tidak_tersedia: r.tidak_tersedia > 0, dalam_batch: r.dalam_batch > 0 })[t]
  const data = filtered.filter((r) => inTab(r, tab))
  const count = (t: TabKey) => filtered.filter((r) => inTab(r, t)).length
  const opts = (k: 'area' | 'jabatan') => [...new Set(all.map((r) => r[k]).filter(Boolean))].sort() as string[]
  const itemOpts = [...new Map((q.data ?? []).map((r) => [r.item_code, r.item_nama])).entries()]
  const lateHires = all.filter((r) => r.is_late_hire && r.siap > 0).length

  const columns = useMemo<ColumnDef<QRow>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => (
      <div><p className="font-semibold">{r.nama} {r.is_late_hire && <Chip tone="violet">hire mendadak</Chip>}</p><p className="text-xs text-muted">{r.nik} · {r.jabatan}</p></div>
    ) },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'cabang_nama', header: 'Cabang', cell: ({ row: { original: r } }) => <div><p>{r.cabang_nama}</p><p className="text-xs text-muted">{r.area}</p></div> },
    { accessorKey: 'tanggal_join', header: 'Join', cell: ({ row: { original: r } }) => (
      <div><p className="whitespace-nowrap">{fmtDate(r.tanggal_join)}</p><p className="text-xs text-muted">{EMP_STATUS_LABEL[r.status]}</p></div>
    ) },
    { accessorKey: 'aging', header: 'Aging', meta: { align: 'right', exportHeader: 'Aging (hari sejak join)' }, cell: ({ row: { original: r } }) => r.aging === null ? '—'
      : r.aging < 0 ? <span className="text-muted">join {-r.aging} hr lagi</span>
      : <span className={clsx('font-semibold', r.aging > 90 ? 'text-red-600' : r.aging > 30 ? 'text-amber-600' : '')}>{r.aging} hari</span> },
    { id: 'items', header: tab === 'dalam_batch' ? 'Di batch' : 'Belum dikirim', enableSorting: false,
      meta: { exportValue: (r) => r.items.filter((i) => i.sisa > 0 || i.qty_dalam_batch > 0).map((i) => `${i.sku_target ?? `${i.item_nama} (ukuran ${i.size_code ?? 'kosong'})`} ×${tab === 'dalam_batch' ? i.qty_dalam_batch : i.sisa}`).join(', ') },
      cell: ({ row: { original: r } }) => (
        <div className="flex flex-wrap gap-1">
          {r.items.filter((i) => (tab === 'dalam_batch' ? i.qty_dalam_batch > 0 : i.sisa > 0)).map((i) => (
            <Chip key={i.item_code} tone={tab === 'dalam_batch' ? 'blue' : i.size_status === 'OK' ? 'brand' : i.size_status === 'KOSONG' ? 'amber' : 'red'}
              title={i.size_status === 'KOSONG' ? 'Ukuran kosong' : i.size_status === 'TIDAK_TERSEDIA' ? `Ukuran ${i.size_code} tidak tersedia` : i.sku_target ?? ''}>
              {i.item_nama}{i.sku_gender === 'P' ? ' Pria' : i.sku_gender === 'W' ? ' Wanita' : ''} {i.size_status === 'OK' ? i.size_code : i.size_status === 'KOSONG' ? '(ukuran?)' : `${i.size_code}✕`} ×{tab === 'dalam_batch' ? i.qty_dalam_batch : i.sisa}
            </Chip>
          ))}
        </div>
      ) },
    ...(tab === 'dalam_batch' ? [{ accessorKey: 'batch_kode', header: 'Batch', cell: ({ row: { original: r } }: { row: { original: QRow } }) =>
      <Link to={`/batch/${r.batch_id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand-600 hover:underline">{r.batch_kode}</Link> } as ColumnDef<QRow>] : []),
  ], [tab])

  return (
    <Page title="Antrian Alokasi" subtitle="Siapa harus dikirimi apa, ukuran berapa, ke cabang mana" help="antrian"
      actions={canWrite && <>
        <Button icon={<UserPlus className="size-4" />} onClick={() => setModal({ kind: 'hire' })}>Input hire mendadak</Button>
        <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={() => setModal({ kind: 'batch' })}>Buat batch</Button>
      </>}>
      {lateHires > 0 && canWrite && (
        <Callout tone="brand" title={`${lateHires} hire mendadak menunggu batch ad-hoc`}
          action={<Button size="sm" variant="soft" onClick={() => setModal({ kind: 'batch', adhocHire: true })}>Buat batch ad-hoc</Button>}>
          Batch ad-hoc dengan cakupan hire mendadak mengirim paket mereka tanpa menunggu cutoff berikutnya.
        </Callout>
      )}
      <Tabs value={tab} onChange={(t) => set('tab', t === 'siap' ? '' : t)} items={[
        { value: 'siap', label: 'Siap dikirim', count: count('siap') },
        { value: 'menunggu_ukuran', label: 'Menunggu ukuran', count: count('menunggu_ukuran') },
        { value: 'tidak_tersedia', label: 'Ukuran tidak tersedia', count: count('tidak_tersedia') },
        { value: 'dalam_batch', label: 'Sudah masuk batch', count: count('dalam_batch') },
      ]} />
      {tab === 'menunggu_ukuran' && <Callout tone="amber">Belum bisa masuk batch. Tagih ukuran ke PPM sebelum cutoff (unduh daftar lewat Export XLSX), atau isi manual dari kartu karyawan.</Callout>}
      {tab === 'tidak_tersedia' && <Callout tone="amber">Perlu keputusan manual: ganti ukuran (buka kartu karyawan → Ubah ukuran), pesan khusus ke vendor, atau ganti item.</Callout>}
      <Card bodyClass="p-0">
        <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
          searchKeys={['nik', 'nama', 'cabang_nama']} searchPlaceholder="Cari NIK / nama / cabang…" exportName={`antrian-${tab}`}
          onRowClick={(r) => setOpen(r.nik)} getRowId={(r) => r.nik}
          selectable={canWrite && tab === 'siap'}
          bulkActions={(rows, clear) => <Button size="sm" variant="primary" icon={<PackagePlus className="size-3.5" />}
            onClick={() => { setModal({ kind: 'batch', niks: rows.map((r) => r.nik) }); clear() }}>Buat batch untuk {rows.length} karyawan</Button>}
          toolbar={<>
            <Select aria-label="Filter area" value={area} onChange={(e) => set('area', e.target.value)} className="h-10 w-40">
              <option value="">Semua area</option>{opts('area').map((a) => <option key={a}>{a}</option>)}
            </Select>
            <Select aria-label="Filter jabatan" value={jabatan} onChange={(e) => set('jabatan', e.target.value)} className="h-10 w-40">
              <option value="">Semua jabatan</option>{opts('jabatan').map((a) => <option key={a}>{a}</option>)}
            </Select>
            <Select aria-label="Filter item" value={item} onChange={(e) => set('item', e.target.value)} className="h-10 w-44">
              <option value="">Semua item</option>{itemOpts.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </Select>
            <Select aria-label="Filter aging" value={aging} onChange={(e) => set('aging', e.target.value)} className="h-10 w-40">
              <option value="">Semua aging</option><option value="30">&gt; 30 hari</option><option value="60">&gt; 60 hari</option><option value="90">&gt; 90 hari</option>
            </Select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-500" checked={hire} onChange={(e) => set('hire', e.target.checked ? '1' : '')} /> Hire mendadak</label>
          </>}
          empty={<EmptyState title={tab === 'siap' ? 'Tidak ada antrian yang siap dikirim' : 'Tidak ada karyawan di kategori ini'}>
            {tab === 'siap' ? 'Semua hak seragam sudah dikirim atau sudah masuk batch.' : 'Ubah filter atau pilih tab lain.'}
          </EmptyState>} />
      </Card>
      {open && <EmployeeCard nik={open} onClose={() => setOpen(null)} />}
      {modal?.kind === 'batch' && <CreateBatchModal niks={modal.niks} initialJenis={modal.adhocHire ? 'ADHOC' : undefined} initialCakupan={modal.adhocHire ? 'HIRE_MENDADAK' : undefined} onClose={() => setModal(null)} />}
      {modal?.kind === 'hire' && <HireEventModal onClose={() => setModal(null)} />}
    </Page>
  )
}
