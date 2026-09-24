import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Card, Chip, Field, Input, Tabs, Term } from '../../components/ui'
import { useView } from '../../lib/api'
import { fmtDate, fmtMonth, fmtNum, fmtRp, isoToday } from '../../lib/format'
import { RETUR_STATUS_LABEL, RETUR_STATUS_TONE, RETUR_SUMBER_LABEL } from '../../lib/labels'

interface Payroll { periode_potong: string; nik: string; nama: string; jabatan: string; cabang_nama: string; no_transaksi: string; tanggal: string; sku_code: string; sku_label: string; qty: number; harga: number; nilai: number }
interface Outstanding { nik: string; nama: string; jabatan: string; cabang_nama: string; sumber: string; tanggal_acuan: string | null; aging_hari: number | null; item_nama: string; sku_code: string | null; sisa: number; price: number | null; nilai: number; status: string }
interface Rekap { sku_code: string; label: string; vendor_nama: string | null; qty_tukar: number; cacat: number; deviasi: number; qty_issue: number; rate_pct: number | null }

type TabKey = 'potong' | 'resign' | 'tukar'

export default function LaporanPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) ?? 'potong'
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }) }
  return (
    <Page title="Laporan & Export" subtitle="Potong gaji, nilai outstanding resign, rekap tukar per SKU/vendor" help="laporan">
      <Tabs value={tab} onChange={(t) => set('tab', t)} items={[
        { value: 'potong', label: 'Potong gaji (Payroll)' },
        { value: 'resign', label: 'Outstanding resign' },
        { value: 'tukar', label: 'Rekap tukar per SKU' },
      ]} />
      {tab === 'potong' && <Payroll />}
      {tab === 'resign' && <OutstandingResign />}
      {tab === 'tukar' && <RekapTukar />}
    </Page>
  )
}

function Payroll() {
  const [params, setParams] = useSearchParams()
  const periode = params.get('periode') ?? isoToday().slice(0, 7)
  const q = useView<Payroll>('v_payroll_deduction', { filters: [['periode_potong', 'eq', `${periode}-01`]], order: [['nama', 'asc'], ['tanggal', 'asc']] })
  const total = (q.data ?? []).reduce((a, r) => a + Number(r.nilai), 0)
  const karyawan = new Set((q.data ?? []).map((r) => r.nik)).size
  const columns = useMemo<ColumnDef<Payroll>[]>(() => [
    { accessorKey: 'nik', header: 'NIK' },
    { accessorKey: 'nama', header: 'Nama' },
    { accessorKey: 'cabang_nama', header: 'Cabang' },
    { accessorKey: 'no_transaksi', header: 'No. transaksi', cell: ({ row: { original: r } }) => <span className="text-xs">{r.no_transaksi}<br /><span className="text-muted">{fmtDate(r.tanggal)}</span></span> },
    { accessorKey: 'sku_label', header: 'Barang' },
    { accessorKey: 'qty', header: 'Qty', meta: { align: 'right' } },
    { accessorKey: 'harga', header: 'Harga', meta: { align: 'right' }, cell: (c) => fmtRp(c.getValue() as number) },
    { accessorKey: 'nilai', header: 'Potongan', meta: { align: 'right' }, cell: (c) => <b className="whitespace-nowrap">{fmtRp(c.getValue() as number)}</b> },
  ], [])
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-end gap-6 border-b border-line p-5">
        <Field label="Periode potong gaji" htmlFor="periode"><Input id="periode" type="month" value={periode} onChange={(e) => { const p = new URLSearchParams(params); p.set('periode', e.target.value); setParams(p, { replace: true }) }} className="w-48" /></Field>
        <div className="text-sm"><p className="text-muted">Total potongan {fmtMonth(`${periode}-01`)}</p><p className="text-2xl font-extrabold num">{fmtRp(total)}</p></div>
        <div className="text-sm"><p className="text-muted">Karyawan</p><p className="text-2xl font-extrabold num">{fmtNum(karyawan)}</p></div>
        <p className="max-w-sm text-xs text-muted">Klik <b>Export XLSX</b> lalu kirim ke Payroll. Pembelian yang dibatalkan tidak ikut.</p>
      </div>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['nik', 'nama']} exportName={`potong-gaji-${periode}`}
        empty={<p className="p-8 text-center text-sm text-muted">Tidak ada pembelian dengan periode potong {fmtMonth(`${periode}-01`)}.</p>} />
    </Card>
  )
}

function OutstandingResign() {
  const q = useView<Outstanding>('v_return_obligation', { filters: [['sumber', 'in', ['RESIGN', 'PKL_SELESAI']], ['sisa', 'gt', 0]], order: [['aging_hari', 'desc']] })
  const total = (q.data ?? []).reduce((a, r) => a + Number(r.nilai), 0)
  const columns = useMemo<ColumnDef<Outstanding>[]>(() => [
    { accessorKey: 'nik', header: 'NIK' },
    { accessorKey: 'nama', header: 'Nama' },
    { accessorKey: 'cabang_nama', header: 'Cabang' },
    { accessorKey: 'sumber', header: 'Sebab', cell: (c) => RETUR_SUMBER_LABEL[c.getValue() as string], meta: { exportValue: (r) => RETUR_SUMBER_LABEL[r.sumber] } },
    { accessorKey: 'tanggal_acuan', header: 'Tanggal resign', cell: (c) => fmtDate(c.getValue() as string) },
    { accessorKey: 'aging_hari', header: 'Aging (hari)', meta: { align: 'right' } },
    { accessorKey: 'item_nama', header: 'Item' },
    { accessorKey: 'sisa', header: 'Sisa', meta: { align: 'right' } },
    { accessorKey: 'nilai', header: () => <Term tip="Sisa × harga price list saat ini (harga buku).">Nilai</Term>, meta: { align: 'right', exportHeader: 'Nilai' }, cell: (c) => fmtRp(c.getValue() as number) },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Chip tone={RETUR_STATUS_TONE[c.getValue() as string]}>{RETUR_STATUS_LABEL[c.getValue() as string]}</Chip>, meta: { exportValue: (r) => RETUR_STATUS_LABEL[r.status] } },
  ], [])
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-end gap-6 border-b border-line p-5 text-sm">
        <div><p className="text-muted">Nilai outstanding</p><p className="text-2xl font-extrabold num">{fmtRp(total)}</p></div>
        <div><p className="text-muted">Pcs belum kembali</p><p className="text-2xl font-extrabold num">{fmtNum((q.data ?? []).reduce((a, r) => a + r.sisa, 0))}</p></div>
        <p className="max-w-md text-xs text-muted">Per item, untuk karyawan resign & PKL selesai. Hanya informasi — aturan penagihan masih TBD; sistem tidak menagih otomatis.</p>
      </div>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['nik', 'nama', 'cabang_nama']} exportName="outstanding-seragam-resign" dense
        empty={<p className="p-8 text-center text-sm text-muted">Semua karyawan resign sudah mengembalikan seragam.</p>} />
    </Card>
  )
}

function RekapTukar() {
  const q = useView<Rekap>('v_exchange_rekap', { order: [['qty_tukar', 'desc']] })
  const columns = useMemo<ColumnDef<Rekap>[]>(() => [
    { accessorKey: 'label', header: 'SKU', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.label}</p><code className="text-xs text-muted">{r.sku_code}</code></div> },
    { accessorKey: 'sku_code', header: 'Kode', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'vendor_nama', header: 'Vendor', cell: (c) => (c.getValue() as string) ?? '—' },
    { accessorKey: 'qty_tukar', header: 'Ditukar', meta: { align: 'right' } },
    { accessorKey: 'cacat', header: 'Cacat produksi', meta: { align: 'right' } },
    { accessorKey: 'deviasi', header: 'Deviasi spek', meta: { align: 'right' } },
    { accessorKey: 'qty_issue', header: 'Dikirim ke karyawan', meta: { align: 'right' } },
    { accessorKey: 'rate_pct', header: () => <Term tip="Ditukar ÷ dikirim ke karyawan, 12 bulan terakhir. Target tingkat tukar < 3%.">Tingkat tukar</Term>, meta: { align: 'right', exportHeader: 'Tingkat tukar (%)' },
      cell: (c) => { const v = c.getValue() as number | null; return v == null ? '—' : <span className={v >= 3 ? 'font-bold text-red-600' : ''}>{String(v).replace('.', ',')}%</span> } },
  ], [])
  return (
    <Card bodyClass="p-0">
      <p className="border-b border-line px-5 py-3 text-sm text-muted">12 bulan terakhir. Bahan evaluasi vendor: tingkat tukar ≥ 3% ditandai merah.</p>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['sku_code', 'label', 'vendor_nama']} exportName="rekap-tukar-per-sku"
        empty={<p className="p-8 text-center text-sm text-muted">Belum ada tukar barang dalam 12 bulan terakhir.</p>} />
    </Card>
  )
}
