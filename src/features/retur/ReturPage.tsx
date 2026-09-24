import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { PackageOpen, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, EmptyState, Field, Input, Select, Tabs, Term, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtNum, fmtRp, isoToday } from '../../lib/format'
import { RETUR_STATUS_LABEL, RETUR_STATUS_TONE, RETUR_SUMBER_LABEL } from '../../lib/labels'
import { EmployeeCard } from '../employee/EmployeeCard'

export interface ReturItem { item_code: string; item_nama: string; sku_code: string | null; sku_label: string | null; wajib: number; dikembalikan: number; dihapuskan: number; sisa: number; price: number | null; status: string }
export interface ReturEmp {
  nik: string; nama: string; jabatan: string; kode_cabang: string; cabang_nama: string; area: string | null; employee_status: string; is_loan: boolean
  sumber: string; tanggal_acuan: string | null; aging_hari: number | null; wajib: number; dikembalikan: number; dihapuskan: number; sisa: number; nilai: number
  items: ReturItem[]; status: string
}
interface AkanResign { nik: string; nama: string; jabatan: string; cabang_nama: string; area: string | null; planned_resign_date: string; hari_lagi: number; pcs: number; items: { item_nama: string; qty: number }[]; is_loan: boolean }
interface Cfg { key: string; value: number }

type TabKey = 'wajib' | 'akan'

export default function ReturPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) ?? 'wajib'
  const q = useView<ReturEmp>('v_return_employee', { order: [['aging_hari', 'desc']] })
  const akan = useView<AkanResign>('v_akan_resign', { order: [['planned_resign_date', 'asc']] })
  const cfg = useView<Cfg>('config', { filters: [['key', 'eq', 'return_alert_days']] })
  const batas = Number(cfg.data?.[0]?.value ?? 14)
  const open = (q.data ?? []).filter((r) => r.sisa > 0)
  return (
    <Page title="Pengembalian" subtitle="Seragam alokasi yang wajib kembali: resign, PKL selesai, batal join, no-show, mutasi" help="retur">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Belum kembali" value={`${fmtNum(open.reduce((a, r) => a + r.sisa, 0))} pcs`} sub={`${open.length} karyawan · ${fmtRp(open.reduce((a, r) => a + Number(r.nilai), 0))}`} loading={q.isLoading} />
        <Stat label={`Lewat ${batas} hari`} tone="red" value={fmtNum(open.filter((r) => ['RESIGN', 'PKL_SELESAI'].includes(r.sumber) && (r.aging_hari ?? 0) > batas).length)} sub="karyawan resign belum mengembalikan" loading={q.isLoading}
          onClick={() => setParams({ terlambat: '1' }, { replace: true })} />
        <Stat label="Permintaan retur ke cabang" tone="amber" value={fmtNum(open.filter((r) => ['BATAL_JOIN', 'NOSHOW'].includes(r.sumber)).length)} sub="paket joiner batal join / no-show" loading={q.isLoading}
          onClick={() => setParams({ sumber: 'cabang' }, { replace: true })} />
        <Stat label="Akan resign" value={fmtNum(akan.data?.length ?? 0)} sub="siapkan pengambilan di hari terakhir" loading={akan.isLoading} onClick={() => setParams({ tab: 'akan' }, { replace: true })} />
      </div>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} items={[
        { value: 'wajib', label: 'Wajib kembali', count: open.length || undefined },
        { value: 'akan', label: 'Akan resign', count: akan.data?.length || undefined },
      ]} />
      {tab === 'wajib' ? <WajibTable q={q} batas={batas} /> : <AkanTable q={akan} />}
    </Page>
  )
}

function Stat({ label, value, sub, tone, onClick, loading }: { label: string; value: string; sub: string; tone?: 'red' | 'amber'; onClick?: () => void; loading?: boolean }) {
  const C = onClick ? 'button' : 'div'
  return (
    <C onClick={onClick} className={clsx('rounded-2xl border border-line bg-white px-4 py-3 text-left shadow-sm', onClick && 'transition-colors hover:border-brand-200 hover:bg-brand-50/30')}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={clsx('mt-0.5 text-2xl font-extrabold num', loading ? 'text-slate-300' : tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink')}>{loading ? '…' : value}</p>
      <p className="line-clamp-2 text-xs text-muted">{loading ? ' ' : sub}</p>
    </C>
  )
}

function WajibTable({ q, batas }: { q: ReturnType<typeof useView<ReturEmp>>; batas: number }) {
  const [params, setParams] = useSearchParams()
  const sumber = params.get('sumber') ?? ''
  const status = params.get('status') ?? 'belum'
  const terlambat = params.get('terlambat') === '1'
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const { canWrite } = usePerm()
  const [ret, setRet] = useState<ReturEmp | null>(null)
  const [card, setCard] = useState<string | null>(null)
  const data = useMemo(() => (q.data ?? []).filter((r) =>
    (status === 'semua' || (status === 'belum' ? r.sisa > 0 : r.status === status)) &&
    (!sumber || (sumber === 'cabang' ? ['BATAL_JOIN', 'NOSHOW'].includes(r.sumber) : r.sumber === sumber)) &&
    (!terlambat || (['RESIGN', 'PKL_SELESAI'].includes(r.sumber) && (r.aging_hari ?? 0) > batas && r.sisa > 0))), [q.data, status, sumber, terlambat, batas])

  const columns = useMemo<ColumnDef<ReturEmp>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.nama}</p><p className="text-xs text-muted">{r.nik} · {r.jabatan}</p></div> },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'cabang_nama', header: 'Cabang', cell: ({ row: { original: r } }) => <div><p>{r.cabang_nama}</p><p className="text-xs text-muted">{r.area}</p></div> },
    { accessorKey: 'sumber', header: 'Sebab', meta: { exportValue: (r) => RETUR_SUMBER_LABEL[r.sumber] }, cell: ({ row: { original: r } }) => (
      <div><Chip tone={['BATAL_JOIN', 'NOSHOW'].includes(r.sumber) ? 'violet' : r.sumber === 'MUTASI' ? 'blue' : 'slate'}>{RETUR_SUMBER_LABEL[r.sumber]}</Chip>
        {r.tanggal_acuan && <p className="mt-0.5 text-xs text-muted">{r.sumber === 'NOSHOW' ? 'batas hadir' : r.sumber === 'MUTASI' ? 'mutasi' : 'sejak'} {fmtDate(r.tanggal_acuan)}</p>}</div>
    ) },
    { id: 'items', header: 'Item wajib kembali', accessorFn: (r) => r.items.filter((i) => i.sisa > 0).map((i) => `${i.item_nama} ×${i.sisa}`).join(', '), cell: ({ row: { original: r } }) => (
      <ul className="text-sm">{r.items.map((i) => <li key={i.item_code} className={i.sisa ? '' : 'text-slate-400'}>{i.item_nama} <b>{i.sisa}</b>{i.wajib !== i.sisa && <span className="text-xs text-muted">/{i.wajib}</span>}</li>)}</ul>
    ) },
    { accessorKey: 'aging_hari', header: () => <Term tip="Hari sejak tanggal resign / batas hadir / mutasi.">Aging</Term>, meta: { align: 'right', exportHeader: 'Aging (hari)' },
      cell: ({ row: { original: r } }) => r.aging_hari == null || r.aging_hari < 0 ? '—' : <span className={clsx('font-semibold', r.sisa > 0 && r.aging_hari > batas && 'text-red-600')}>{r.aging_hari} hr</span> },
    { accessorKey: 'nilai', header: () => <Term tip="Sisa qty × harga price list saat ini (sama dengan harga yang dibebankan ke karyawan). Hanya informasi; sistem tidak menagih otomatis.">Nilai</Term>, meta: { align: 'right', exportHeader: 'Nilai outstanding' },
      cell: (c) => <span className="whitespace-nowrap">{fmtRp(c.getValue() as number)}</span> },
    { accessorKey: 'status', header: 'Status', meta: { exportValue: (r) => RETUR_STATUS_LABEL[r.status] }, cell: ({ row: { original: r } }) => <Chip tone={RETUR_STATUS_TONE[r.status]}>{RETUR_STATUS_LABEL[r.status]}</Chip> },
    ...(canWrite ? [{
      id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: r } }: { row: { original: ReturEmp } }) => r.sisa > 0 && <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); setRet(r) }}>Catat pengembalian</Button>,
    } as ColumnDef<ReturEmp>] : []),
  ], [batas, canWrite])

  return (
    <Card bodyClass="p-0">
      {sumber === 'cabang' && (
        <div className="border-b border-line p-4">
          <Callout tone="amber" title="Permintaan retur ke cabang">
            Paket joiner yang batal join atau tidak hadir sampai masa tunggu masih ditahan APA. Export daftar ini dan kirim ke cabang; setelah paket tiba di gudang, klik <b>Catat pengembalian</b>. Barang belum dipakai → QC grade A kembali ke stok layak.
          </Callout>
        </div>
      )}
      <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['nik', 'nama', 'cabang_nama']} searchPlaceholder="Cari NIK / nama / cabang…"
        exportName={sumber === 'cabang' ? 'permintaan-retur-cabang' : 'wajib-kembali'} onRowClick={(r) => setCard(r.nik)}
        rowClassName={(r) => (r.sisa > 0 && ['RESIGN', 'PKL_SELESAI'].includes(r.sumber) && (r.aging_hari ?? 0) > batas ? 'bg-red-50/40' : undefined)}
        toolbar={<>
          <Select aria-label="Filter sebab" value={sumber} onChange={(e) => set('sumber', e.target.value)} className="h-10 w-52">
            <option value="">Semua sebab</option>
            <option value="cabang">Permintaan retur ke cabang</option>
            {Object.entries(RETUR_SUMBER_LABEL).filter(([k]) => !['TUKAR', 'OPNAME'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Filter status" value={status} onChange={(e) => set('status', e.target.value === 'belum' ? '' : e.target.value)} className="h-10 w-44">
            <option value="belum">Belum selesai</option>
            {Object.entries(RETUR_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="semua">Semua</option>
          </Select>
          {terlambat && <Button size="sm" variant="soft" onClick={() => set('terlambat', '')}>Lewat {batas} hari ✕</Button>}
        </>}
        empty={<EmptyState icon={<PackageOpen className="size-5" />} title="Tidak ada seragam yang wajib kembali">Daftar terisi otomatis dari data PPM: resign, batal join, no-show, dan mutasi yang membuat item tidak lagi menjadi hak.</EmptyState>} />
      {ret && <ReturnModal emp={ret} onClose={() => setRet(null)} />}
      {card && <EmployeeCard nik={card} onClose={() => setCard(null)} />}
    </Card>
  )
}

function AkanTable({ q }: { q: ReturnType<typeof useView<AkanResign>> }) {
  const columns = useMemo<ColumnDef<AkanResign>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.nama} {r.is_loan && <Chip tone="violet">PKL</Chip>}</p><p className="text-xs text-muted">{r.nik} · {r.jabatan}</p></div> },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'cabang_nama', header: 'Cabang' },
    { accessorKey: 'planned_resign_date', header: 'Hari terakhir', cell: ({ row: { original: r } }) => <div><p>{fmtDate(r.planned_resign_date)}</p><p className={clsx('text-xs', r.hari_lagi <= 7 ? 'font-semibold text-amber-700' : 'text-muted')}>{r.hari_lagi >= 0 ? `${r.hari_lagi} hari lagi` : `lewat ${-r.hari_lagi} hari`}</p></div> },
    { id: 'items', header: 'Diambil kembali', accessorFn: (r) => r.items.map((i) => `${i.item_nama} ×${i.qty}`).join(', '), cell: ({ row: { original: r } }) => <ul className="text-sm">{r.items.map((i) => <li key={i.item_nama}>{i.item_nama} × {i.qty}</li>)}</ul> },
  ], [])
  return (
    <Card bodyClass="p-0">
      <p className="border-b border-line px-5 py-3 text-sm text-muted">Dari data PPM (rencana resign). Kirim daftar ke APA supaya seragam diambil pada hari terakhir kerja. Setelah status resign masuk dari PPM, karyawan pindah ke tab Wajib kembali.</p>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} searchKeys={['nik', 'nama', 'cabang_nama']} exportName="akan-resign"
        empty={<p className="p-8 text-center text-sm text-muted">Tidak ada rencana resign di data PPM terakhir.</p>} />
    </Card>
  )
}

/** Catat barang kembali + (admin) hapuskan sisa. */
export function ReturnModal({ emp, onClose }: { emp: ReturEmp; onClose: () => void }) {
  const { isAdmin } = usePerm()
  const openItems = emp.items.filter((i) => i.sisa > 0)
  const [tgl, setTgl] = useState(isoToday())
  const [catatan, setCatatan] = useState('')
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(openItems.map((i) => [i.item_code, String(i.sisa)])))
  const [wo, setWo] = useState<ReturItem | null>(null)
  const m = useRpc<unknown, { kode: string; pcs: number }>('fn_return_receive', { success: (r) => `${r.kode}: ${r.pcs} pcs diterima dan masuk karantina (menunggu QC).` })
  const errOf = (i: ReturItem) => {
    const v = (qty[i.item_code] ?? '').trim()
    if (v === '') return null
    if (!/^\d+$/.test(v)) return 'Bilangan bulat'
    if (Number(v) > i.sisa) return `Maks. ${i.sisa}`
    return null
  }
  const total = openItems.reduce((a, i) => a + (errOf(i) ? 0 : Number(qty[i.item_code] || 0)), 0)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title={`Catat pengembalian — ${emp.nama}`}
      description={`${emp.nik} · ${emp.cabang_nama} · ${RETUR_SUMBER_LABEL[emp.sumber]}. Hitung fisik barang yang benar-benar diterima gudang. Barang masuk karantina sampai di-QC.`}
      footer={<>
        <span className="mr-auto text-sm text-muted">Diterima <b className="text-ink">{fmtNum(total)} pcs</b></span>
        <Button onClick={onClose}>Batal</Button>
        <Button variant="primary" icon={<Undo2 className="size-4" />} loading={m.isPending} disabled={total === 0 || openItems.some(errOf)}
          onClick={async () => { try { await m.mutateAsync({ nik: emp.nik, tanggal: tgl, catatan, lines: openItems.map((i) => ({ item_code: i.item_code, sku_code: i.sku_code, qty: Number(qty[i.item_code] || 0) })) }); onClose() } catch { /* toast */ } }}>
          Simpan pengembalian
        </Button>
      </>}>
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Item</th><th className="py-2 text-right">Wajib</th><th className="py-2 text-right">Sudah</th><th className="py-2 text-right">Sisa</th><th className="w-28 py-2 text-right">Diterima</th>{isAdmin && <th className="w-24" />}</tr>
          </thead>
          <tbody>
            {openItems.map((i) => {
              const err = errOf(i)
              return (
                <tr key={i.item_code} className="border-t border-line align-top">
                  <td className="py-2"><p className="font-semibold">{i.item_nama}</p><p className="text-xs text-muted">{i.sku_label ?? '—'}</p></td>
                  <td className="py-2 text-right num">{i.wajib}</td>
                  <td className="py-2 text-right num">{i.dikembalikan + i.dihapuskan}</td>
                  <td className="py-2 text-right font-semibold num">{i.sisa}</td>
                  <td className="py-2 pl-2 text-right">
                    <Input aria-label={`Qty diterima ${i.item_nama}`} inputMode="numeric" className="h-9 text-right num" value={qty[i.item_code] ?? ''} aria-invalid={!!err}
                      onChange={(e) => setQty((q) => ({ ...q, [i.item_code]: e.target.value }))} />
                    {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
                  </td>
                  {isAdmin && <td className="py-2 pl-2 text-right"><Button size="sm" variant="ghost" onClick={() => setWo(i)}>Hapuskan…</Button></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal diterima gudang" required><Input type="date" value={tgl} max={isoToday()} onChange={(e) => setTgl(e.target.value)} /></Field>
          <Field label="Catatan"><Textarea className="min-h-10" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. dikirim APA via ekspedisi, 1 polo kotor" /></Field>
        </div>
        <p className="text-xs text-muted">Barang hasil beli tidak perlu dikembalikan dan tidak tercantum di sini.</p>
      </div>
      {wo && <WriteoffModal nik={emp.nik} item={wo} onClose={() => setWo(null)} />}
    </Modal>
  )
}

function WriteoffModal({ nik, item, onClose }: { nik: string; item: ReturItem; onClose: () => void }) {
  const [qty, setQty] = useState(String(item.sisa))
  const [alasan, setAlasan] = useState('')
  const m = useRpc('fn_return_writeoff', { success: 'Kewajiban retur dihapuskan dan tercatat di audit log.' })
  const q = Number(qty)
  const bad = !/^\d+$/.test(qty) || q <= 0 || q > item.sisa
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="sm" title={`Hapuskan kewajiban — ${item.item_nama}`}
      description="Untuk kasus barang tidak mungkin kembali (hilang, rusak total, disetujui manajemen). Stok tidak berubah."
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="danger" loading={m.isPending} disabled={bad || alasan.trim().length < 5}
          onClick={async () => { try { await m.mutateAsync({ nik, item_code: item.item_code, qty: q, alasan }); onClose() } catch { /* toast */ } }}>Hapuskan</Button></>}>
      <div className="space-y-4">
        <Field label="Qty" required error={bad ? `1–${item.sisa}` : undefined}><Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Alasan" required hint="Minimal 5 karakter. Tercatat di audit log."><Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. karyawan meninggal; disetujui Div. Lead" /></Field>
      </div>
    </Modal>
  )
}
