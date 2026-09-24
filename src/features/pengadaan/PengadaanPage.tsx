import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { ClipboardList, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Button, Card, Chip, EmptyState, Select, Tabs, Term } from '../../components/ui'
import { useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtNum, fmtRp } from '../../lib/format'
import { DEMAND_SUMBER_LABEL, PLAN_STATUS_LABEL, PLAN_STATUS_TONE, PO_STATUS_LABEL, PO_STATUS_TONE } from '../../lib/labels'
import { CreatePoModal } from './CreatePoModal'

export interface PlanRow {
  sku_code: string; item_code: string; item_nama: string; gender: string; size_code: string; size_order: number; label: string; item_sort: number
  price: number | null; active: boolean; layak: number; karantina: number; cadangan: number; afkir: number; reserved: number; available: number
  vendor_id: number | null; vendor_nama: string | null; lead_time_days: number; moq: number; on_order: number; qty_po_draft: number
  pipeline_demand: number; demand_histori: number; demand_bulan: number; demand_sumber: string
  avg_demand: number; safety_stock: number; rop: number; kebutuhan_order: number; suggested_order: number; status: string
}
export interface PoRow {
  id: number; kode: string; vendor_id: number; vendor_nama: string; vendor_kontak: string | null; tanggal: string; eta: string | null; fase: string
  catatan: string | null; sent_at: string | null; sent_by_nama: string | null; alasan_tutup: string | null; alasan_batal: string | null
  created_by_nama: string | null; created_at: string; jumlah_sku: number; qty_order: number; qty_received: number; sisa: number; nilai: number
  jumlah_penerimaan: number; terakhir_diterima: string | null; status: string; ditutup_kurang: boolean; terlambat: boolean
}

const RANK: Record<string, number> = { KRITIS: 0, ORDER: 1, AMAN: 2 }
/** Saran yang belum tertampung PO draft (dibulatkan ke MOQ). Draft tidak mengurangi saran menurut PRD §6,
 *  tetapi tombol "Buat PO dari saran" tidak boleh membuat pesanan dobel. */
export const sisaSaran = (r: PlanRow) => { const x = r.suggested_order - r.qty_po_draft; return x > 0 ? Math.ceil(x / r.moq) * r.moq : 0 }
const num = (n: number) => fmtNum(Math.round(Number(n) * 10) / 10)
const DETAIL_KEY = 'seragam.pengadaan.detail'

type TabKey = 'saran' | 'po'

export default function PengadaanPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) ?? 'saran'
  const setTab = (t: TabKey) => setParams(new URLSearchParams({ tab: t }), { replace: true })
  const plan = useView<PlanRow>('v_sku_planning', { filters: [['active', 'eq', true]] })
  const pos = useView<PoRow>('v_po', { order: [['id', 'desc']] })
  const { isAdmin } = usePerm()
  const [creating, setCreating] = useState<PlanRow[] | null>(null)
  const suggested = (plan.data ?? []).filter((r) => sisaSaran(r) > 0)
  const inDraft = (plan.data ?? []).filter((r) => r.suggested_order > 0 && r.qty_po_draft > 0)
  const count = (s: string) => (plan.data ?? []).filter((r) => r.status === s).length
  const activePo = (pos.data ?? []).filter((p) => ['DRAFT', 'SENT', 'PARTIAL'].includes(p.status)).length

  return (
    <Page title="Pengadaan" subtitle="Saran order per SKU dan purchase order (PO) ke vendor" help="pengadaan"
      actions={isAdmin && tab === 'saran' && (
        <Button variant="primary" icon={<ShoppingCart className="size-4" />} disabled={!suggested.length} onClick={() => setCreating(suggested)}
          title={suggested.length ? undefined : inDraft.length ? 'Semua saran order sudah ada di PO draft' : 'Tidak ada SKU dengan saran order'}>
          Buat PO dari saran{suggested.length ? ` (${suggested.length} SKU)` : ''}
        </Button>
      )}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Kritis" tone="red" value={count('KRITIS')} sub="tidak cukup untuk antrian / di bawah safety stock" onClick={() => setParams(new URLSearchParams({ tab: 'saran', status: 'KRITIS' }), { replace: true })} loading={plan.isLoading} />
        <Stat label="Perlu order" tone="amber" value={count('ORDER')} sub="sudah di titik pesan ulang (ROP)" onClick={() => setParams(new URLSearchParams({ tab: 'saran', status: 'ORDER' }), { replace: true })} loading={plan.isLoading} />
        <Stat label="Saran order belum di-PO" tone="brand" value={suggested.reduce((a, r) => a + sisaSaran(r), 0)} unit="pcs"
          sub={`${suggested.length} SKU · perkiraan ${fmtRp(suggested.reduce((a, r) => a + sisaSaran(r) * (r.price ?? 0), 0))}${inDraft.length ? ` · ${inDraft.length} SKU sudah di PO draft` : ''}`}
          onClick={() => setParams(new URLSearchParams({ tab: 'saran', status: 'saran' }), { replace: true })} loading={plan.isLoading} />
        <Stat label="PO berjalan" tone="blue" value={activePo} sub={`${(pos.data ?? []).filter((p) => p.terlambat).length} lewat perkiraan tiba`}
          onClick={() => setTab('po')} loading={pos.isLoading} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'saran', label: 'Saran order per SKU' },
        { value: 'po', label: 'Purchase order', count: activePo || undefined },
      ]} />
      {tab === 'saran' && <PlanTable plan={plan} onCreate={isAdmin ? setCreating : undefined} />}
      {tab === 'po' && <PoTable pos={pos} />}
      {creating && <CreatePoModal rows={creating} onClose={() => setCreating(null)} />}
    </Page>
  )
}

function Stat({ label, value, unit, sub, tone, onClick, loading }: {
  label: string; value: number; unit?: string; sub: string; tone: 'red' | 'amber' | 'brand' | 'blue'; onClick: () => void; loading?: boolean
}) {
  const t = { red: 'text-red-600', amber: 'text-amber-600', brand: 'text-brand-600', blue: 'text-sky-700' }[tone]
  return (
    <button onClick={onClick} className="rounded-2xl border border-line bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50/30">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={clsx('mt-0.5 text-2xl font-extrabold num', loading ? 'text-slate-300' : t)}>{loading ? '…' : fmtNum(value)}{unit && <span className="ml-1 text-sm font-semibold">{unit}</span>}</p>
      <p className="line-clamp-2 text-xs text-muted">{loading ? ' ' : sub}</p>
    </button>
  )
}

function PlanTable({ plan, onCreate }: { plan: ReturnType<typeof useView<PlanRow>>; onCreate?: (rows: PlanRow[]) => void }) {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const item = params.get('item') ?? ''
  const vendor = params.get('vendor') ?? ''
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const [detail, setDetailState] = useState(() => { try { return localStorage.getItem(DETAIL_KEY) === '1' } catch { return false } })
  const setDetail = (v: boolean) => { setDetailState(v); try { localStorage.setItem(DETAIL_KEY, v ? '1' : '0') } catch { /* abaikan */ } }
  const items = useMemo(() => [...new Map((plan.data ?? []).map((s) => [s.item_code, s.item_nama])).entries()], [plan.data])
  const vendors = useMemo(() => [...new Set((plan.data ?? []).map((s) => s.vendor_nama ?? ''))].sort(), [plan.data])
  const data = useMemo(() => (plan.data ?? [])
    .filter((s) => (!item || s.item_code === item) && (!vendor || (s.vendor_nama ?? '') === (vendor === '-' ? '' : vendor)) &&
      (!status || (status === 'saran' ? sisaSaran(s) > 0 : s.status === status)))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.item_sort - b.item_sort || a.gender.localeCompare(b.gender) || a.size_order - b.size_order),
  [plan.data, item, vendor, status])

  const columns = useMemo<ColumnDef<PlanRow>[]>(() => {
    const cols: (ColumnDef<PlanRow> | false)[] = [
      { accessorKey: 'label', header: 'SKU', meta: { exportHeader: 'Nama SKU' }, cell: ({ row: { original: s } }) => (
        <div className="min-w-44"><p className="whitespace-nowrap font-semibold">{s.label}</p><p className="text-xs text-muted"><code>{s.sku_code}</code> · {s.vendor_nama ?? <span className="text-amber-700">vendor belum diisi</span>}</p></div>
      ) },
      { accessorKey: 'sku_code', header: 'Kode', meta: { className: 'hidden' }, cell: () => null },
      { accessorKey: 'vendor_nama', header: 'Vendor', meta: { className: 'hidden' }, cell: () => null },
      { id: 'status', accessorFn: (s) => RANK[s.status], header: () => <Term tip="Kritis: available kurang dari kebutuhan antrian, atau ≤ safety stock. Perlu order: available + dalam pemesanan ≤ ROP. Selain itu aman.">Status</Term>,
        meta: { exportHeader: 'Status', exportValue: (s) => PLAN_STATUS_LABEL[s.status] },
        cell: ({ row: { original: s } }) => <Chip tone={PLAN_STATUS_TONE[s.status]}>{PLAN_STATUS_LABEL[s.status]}</Chip> },
      detail && { accessorKey: 'layak', header: 'Layak', meta: { align: 'right' } },
      detail && { accessorKey: 'reserved', header: () => <Term tip="Sudah dipesan batch yang belum dikirim.">Reserved</Term>, meta: { align: 'right', exportHeader: 'Reserved' } },
      { accessorKey: 'available', header: () => <Term tip="Stok layak − reserved. Yang benar-benar bisa dikirim.">Available</Term>, meta: { align: 'right', exportHeader: 'Available' },
        cell: (c) => <span className={clsx('font-bold', (c.getValue() as number) <= 0 ? 'text-red-600' : 'text-ink')}>{fmtNum(c.getValue() as number)}</span> },
      { accessorKey: 'on_order', header: () => <Term tip="Sisa PO yang sudah dikirim ke vendor dan belum diterima. PO draft belum dihitung.">Dipesan</Term>, meta: { align: 'right', exportHeader: 'Dalam pemesanan (PO)' },
        cell: ({ row: { original: s } }) => <div>{s.on_order ? fmtNum(s.on_order) : <span className="text-slate-300">0</span>}{s.qty_po_draft > 0 && <p className="text-[11px] font-semibold text-amber-700">+{s.qty_po_draft} di PO draft</p>}</div> },
      { accessorKey: 'pipeline_demand', header: () => <Term tip="Hak karyawan aktif & joiner (termasuk cabang baru) yang belum masuk batch. Kebutuhan yang sudah pasti.">Antrian</Term>, meta: { align: 'right', exportHeader: 'Kebutuhan antrian' },
        cell: (c) => (c.getValue() as number) ? fmtNum(c.getValue() as number) : <span className="text-slate-300">0</span> },
      { accessorKey: 'avg_demand', header: () => <Term tip="Rata-rata keluar per bulan (kirim ke karyawan + pembelian + tukar). SKU tanpa histori memakai perkiraan: rencana hire × qty per karyawan × size curve.">Rata-rata/bln</Term>, meta: { align: 'right', exportHeader: 'Rata-rata per bulan' },
        cell: ({ row: { original: s } }) => <div title={DEMAND_SUMBER_LABEL[s.demand_sumber]}>{num(s.avg_demand)}{s.demand_sumber === 'SIZE_CURVE' && <p className="text-[11px] text-muted">perkiraan</p>}</div> },
      detail && { accessorKey: 'safety_stock', header: () => <Term tip="Safety stock = rata-rata/bln × parameter safety stock (bulan).">SS</Term>, meta: { align: 'right', exportHeader: 'Safety stock' }, cell: (c) => num(c.getValue() as number) },
      detail && { accessorKey: 'rop', header: () => <Term tip="Titik pesan ulang = rata-rata/bln × lead time/30 + safety stock.">ROP</Term>, meta: { align: 'right', exportHeader: 'ROP' }, cell: (c) => num(c.getValue() as number) },
      detail && { accessorKey: 'lead_time_days', header: 'Lead time', meta: { align: 'right', exportHeader: 'Lead time (hari)' }, cell: (c) => `${c.getValue()} hr` },
      detail && { accessorKey: 'kebutuhan_order', header: () => <Term tip="Rata-rata × cakupan order + SS + kebutuhan antrian − available − dalam pemesanan, dibulatkan ke pcs terdekat, sebelum dibulatkan ke MOQ.">Kebutuhan</Term>, meta: { align: 'right', exportHeader: 'Kebutuhan sebelum MOQ' }, cell: (c) => num(c.getValue() as number) },
      { accessorKey: 'suggested_order', header: () => <Term tip="Dibulatkan ke atas ke kelipatan MOQ (minimum order) vendor.">Saran order</Term>, meta: { align: 'right', exportHeader: 'Saran order' },
        cell: ({ row: { original: s } }) => s.suggested_order ? (
          <div>
            <p className={clsx('text-base font-extrabold num', sisaSaran(s) ? 'text-brand-700' : 'text-slate-400')}>{fmtNum(s.suggested_order)}</p>
            <p className="text-[11px] text-muted">{sisaSaran(s) ? `MOQ ${s.moq}` : 'sudah di PO draft'}</p>
          </div>
        ) : <span className="text-slate-300">—</span> },
    ]
    return cols.filter(Boolean) as ColumnDef<PlanRow>[]
  }, [detail])

  return (
    <Card bodyClass="p-0">
      <DataTable data={data} columns={columns} loading={plan.isLoading} error={plan.error} searchKeys={['sku_code', 'label']} searchPlaceholder="Cari SKU…"
        exportName="saran-order" pageSize={60} dense selectable={!!onCreate} getRowId={(s) => s.sku_code}
        rowClassName={(s) => (s.status === 'KRITIS' ? 'bg-red-50/40' : undefined)}
        bulkActions={onCreate && ((rows, clear) => <Button size="sm" variant="primary" icon={<ShoppingCart className="size-3.5" />} onClick={() => { onCreate(rows); clear() }}>Buat PO ({rows.length} SKU)</Button>)}
        toolbar={<>
          <Select aria-label="Filter status" value={status} onChange={(e) => set('status', e.target.value)} className="h-10 w-44">
            <option value="">Semua status</option>
            <option value="saran">Ada saran order (belum di-PO)</option>
            {Object.entries(PLAN_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Filter item" value={item} onChange={(e) => set('item', e.target.value)} className="h-10 w-44">
            <option value="">Semua item</option>
            {items.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>
          {vendors.length > 1 && (
            <Select aria-label="Filter vendor" value={vendor} onChange={(e) => set('vendor', e.target.value)} className="h-10 w-48">
              <option value="">Semua vendor</option>
              {vendors.map((v) => <option key={v || '-'} value={v || '-'}>{v || 'Belum ada vendor'}</option>)}
            </Select>
          )}
          <label className="ml-1 flex items-center gap-2 text-sm font-medium text-slate-600">
            <input type="checkbox" className="size-4 accent-brand-500" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
            Tampilkan detail perhitungan
          </label>
        </>}
        empty={<EmptyState icon={<ClipboardList className="size-5" />} title="Tidak ada SKU yang cocok dengan filter">Ubah filter status/item untuk melihat SKU lain.</EmptyState>} />
    </Card>
  )
}

function PoTable({ pos }: { pos: ReturnType<typeof useView<PoRow>> }) {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'aktif'
  const setStatus = (v: string) => { const p = new URLSearchParams(params); p.set('status', v); setParams(p, { replace: true }) }
  const data = useMemo(() => (pos.data ?? []).filter((p) =>
    status === 'semua' || (status === 'aktif' ? ['DRAFT', 'SENT', 'PARTIAL'].includes(p.status) : status === 'terlambat' ? p.terlambat : p.status === status)), [pos.data, status])
  const columns = useMemo<ColumnDef<PoRow>[]>(() => [
    { accessorKey: 'kode', header: 'PO', cell: ({ row: { original: p } }) => <div><p className="font-bold">{p.kode}</p><p className="text-xs text-muted">{p.vendor_nama}</p></div> },
    { accessorKey: 'vendor_nama', header: 'Vendor', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'status', header: 'Status', meta: { exportValue: (p) => PO_STATUS_LABEL[p.status] }, cell: ({ row: { original: p } }) => (
      <div className="flex flex-wrap gap-1">
        <Chip tone={PO_STATUS_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Chip>
        {p.terlambat && <Chip tone="red">lewat ETA</Chip>}
        {p.ditutup_kurang && <Chip tone="slate">ditutup · kurang {p.sisa}</Chip>}
      </div>
    ) },
    { accessorKey: 'tanggal', header: 'Tanggal PO', cell: ({ row: { original: p } }) => <div className="whitespace-nowrap">{fmtDate(p.tanggal)}{p.sent_at && <p className="text-xs text-muted">dikirim {fmtDate(p.sent_at)}</p>}</div> },
    { accessorKey: 'eta', header: () => <Term tip="Perkiraan barang tiba (estimated time of arrival). Otomatis tanggal kirim + lead time bila tidak diisi.">ETA</Term>, meta: { exportHeader: 'ETA' },
      cell: ({ row: { original: p } }) => <span className={clsx('whitespace-nowrap', p.terlambat && 'font-semibold text-red-600')}>{fmtDate(p.eta)}</span> },
    { id: 'terima', header: 'Diterima', accessorFn: (p) => `${p.qty_received}/${p.qty_order}`, cell: ({ row: { original: p } }) => (
      <div className="min-w-32">
        <p className="text-xs num">{fmtNum(p.qty_received)} / {fmtNum(p.qty_order)} pcs</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.qty_order ? (p.qty_received / p.qty_order) * 100 : 0}%` }} /></div>
      </div>
    ) },
    { accessorKey: 'nilai', header: 'Nilai', meta: { align: 'right' }, cell: (c) => <span className="whitespace-nowrap">{fmtRp(c.getValue() as number)}</span> },
    { accessorKey: 'created_by_nama', header: 'Dibuat', cell: ({ row: { original: p } }) => <span className="text-xs">{p.created_by_nama ?? '—'}</span> },
  ], [])
  return (
    <Card bodyClass="p-0">
      <DataTable data={data} columns={columns} loading={pos.isLoading} error={pos.error} onRowClick={(p) => nav(`/pengadaan/po/${p.id}`)}
        searchKeys={['kode', 'vendor_nama']} searchPlaceholder="Cari kode PO / vendor…" exportName="purchase-order"
        rowClassName={(p) => (p.terlambat ? 'bg-red-50/40' : undefined)}
        toolbar={<Select aria-label="Filter status PO" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-52">
          <option value="aktif">Belum selesai</option>
          <option value="terlambat">Lewat perkiraan tiba</option>
          {Object.entries(PO_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="semua">Semua PO</option>
        </Select>}
        empty={<EmptyState icon={<ShoppingCart className="size-5" />} title={status === 'aktif' ? 'Tidak ada PO yang sedang berjalan' : 'Tidak ada PO'}>
          PO dibuat dari tab Saran order: centang SKU lalu klik "Buat PO".
        </EmptyState>} />
    </Card>
  )
}
