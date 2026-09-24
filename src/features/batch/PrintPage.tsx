import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, LoadingBlock } from '../../components/ui'
import { useView } from '../../lib/api'
import { fmtDate, fmtDateLong, fmtMonth, fmtNum } from '../../lib/format'
import { BATCH_JENIS_LABEL } from '../../lib/labels'
import type { Line } from './BatchDetailPage'
import type { BatchRow } from './BatchListPage'

interface BranchRow { kode_cabang: string; cabang_nama: string; area: string | null; alamat: string | null; jumlah_karyawan: number; jumlah_pcs: number }

const TITLES: Record<string, string> = { pick: 'Pick List', packing: 'Packing List per Cabang', label: 'Label Nama Paket', bast: 'Berita Acara Serah Terima Seragam' }

/** Dokumen cetak batch (PRD §7.4). Dicetak / disimpan PDF lewat dialog print browser. */
export default function PrintPage() {
  const { id, doc = 'pick' } = useParams()
  const nav = useNavigate()
  const b = useView<BatchRow>('v_batch', { filters: [['id', 'eq', Number(id)]] }).data?.[0]
  const lines = useView<Line>('v_batch_line', { filters: [['batch_id', 'eq', Number(id)]], order: [['cabang_nama', 'asc'], ['nama', 'asc'], ['item_sort', 'asc']] })
  const branches = useView<BranchRow>('v_batch_branch', { filters: [['batch_id', 'eq', Number(id)]], order: [['cabang_nama', 'asc']] })
  useEffect(() => { if (b) document.title = `${TITLES[doc]} — ${b.kode}` }, [b, doc])

  const byBranch = useMemo(() => {
    const m = new Map<string, Map<string, Line[]>>()
    for (const l of lines.data ?? []) {
      const emp = m.get(l.kode_cabang) ?? new Map<string, Line[]>()
      emp.set(l.nik, [...(emp.get(l.nik) ?? []), l])
      m.set(l.kode_cabang, emp)
    }
    return m
  }, [lines.data])

  if (!b || lines.isLoading || branches.isLoading) return <LoadingBlock />

  return (
    <div className="min-h-full bg-slate-100 print:bg-white">
      <style>{`@page { size: A4; margin: 12mm } .sheet { break-after: page } .sheet:last-child { break-after: auto } @media print { .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important } }`}</style>
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-6 py-3">
        <Button icon={<ArrowLeft className="size-4" />} onClick={() => nav(`/batch/${b.id}`)}>Kembali ke batch</Button>
        <p className="font-bold">{TITLES[doc]} · {b.kode}</p>
        <span className="text-sm text-muted">Gunakan kertas A4. Pilih "Simpan sebagai PDF" di dialog cetak untuk arsip.</span>
        <Button variant="primary" className="ml-auto" icon={<Printer className="size-4" />} onClick={() => window.print()}>Cetak</Button>
      </div>
      <div className="py-6 print:py-0">
        {doc === 'pick' && <PickList b={b} lines={lines.data ?? []} />}
        {doc === 'packing' && branches.data?.map((br) => <Packing key={br.kode_cabang} b={b} br={br} emps={byBranch.get(br.kode_cabang)} />)}
        {doc === 'label' && <Labels b={b} lines={lines.data ?? []} />}
        {doc === 'bast' && branches.data?.map((br) => <Bast key={br.kode_cabang} b={b} br={br} emps={byBranch.get(br.kode_cabang)} />)}
      </div>
    </div>
  )
}

function Sheet({ children }: { children: ReactNode }) {
  return <section className="sheet mx-auto mb-6 w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-black shadow">{children}</section>
}

function Head({ b, title, right }: { b: BatchRow; title: string; right?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide">Apotek Alpro · Ops Support</p>
        <h1 className="text-lg font-extrabold">{title}</h1>
        <p>Batch <b>{b.kode}</b> · {BATCH_JENIS_LABEL[b.jenis]} · periode {fmtMonth(b.periode)} · deadline kirim {fmtDate(b.deadline_kirim)}</p>
      </div>
      <div className="shrink-0 whitespace-nowrap pl-4 text-right">{right}</div>
    </header>
  )
}

const th = 'border border-black px-2 py-1 text-left font-bold bg-slate-100'
const td = 'border border-black px-2 py-1 align-top'

function PickList({ b, lines }: { b: BatchRow; lines: Line[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { sku: string; label: string; qty: number; sort: number }>()
    for (const l of lines) {
      const r = m.get(l.sku_code) ?? { sku: l.sku_code, label: l.sku_label, qty: 0, sort: l.item_sort }
      r.qty += l.qty
      m.set(l.sku_code, r)
    }
    return [...m.values()].sort((a, c) => a.sort - c.sort || a.sku.localeCompare(c.sku))
  }, [lines])
  return (
    <Sheet>
      <Head b={b} title="Pick List" right={<p>Dicetak {fmtDateLong(new Date())}</p>} />
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>No</th><th className={th}>Kode SKU</th><th className={th}>Nama</th><th className={`${th} text-right`}>Qty</th><th className={th}>Diambil ✓</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sku}><td className={td}>{i + 1}</td><td className={`${td} font-mono`}>{r.sku}</td><td className={td}>{r.label}</td><td className={`${td} text-right font-bold`}>{r.qty}</td><td className={td} /></tr>
          ))}
          <tr><td className={td} colSpan={3}><b>Total</b></td><td className={`${td} text-right font-bold`}>{fmtNum(rows.reduce((a, r) => a + r.qty, 0))}</td><td className={td} /></tr>
        </tbody>
      </table>
      <Signatures left="Diambil oleh (gudang)" right="Diperiksa oleh (Ops Support)" />
    </Sheet>
  )
}

function empRows(emps?: Map<string, Line[]>) {
  return [...(emps?.values() ?? [])]
}

function Packing({ b, br, emps }: { b: BatchRow; br: BranchRow; emps?: Map<string, Line[]> }) {
  return (
    <Sheet>
      <Head b={b} title="Packing List" right={<><p className="font-bold">{br.cabang_nama}</p><p>{br.kode_cabang} · {br.area}</p></>} />
      <p className="mb-3"><b>Alamat kirim:</b> {br.alamat ?? '—'} · <b>{br.jumlah_karyawan}</b> paket karyawan · <b>{br.jumlah_pcs}</b> pcs</p>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>No</th><th className={th}>NIK</th><th className={th}>Nama / jabatan</th><th className={th}>Isi paket</th><th className={`${th} text-right`}>Pcs</th><th className={th}>Dikemas ✓</th></tr></thead>
        <tbody>
          {empRows(emps).map((ls, i) => (
            <tr key={ls[0].nik}>
              <td className={td}>{i + 1}</td><td className={`${td} font-mono`}>{ls[0].nik}</td>
              <td className={td}><b>{ls[0].nama}</b><br />{ls[0].jabatan}{ls[0].employee_status === 'OFFERING' && <><br /><i>Joiner — join {fmtDate(ls[0].planned_join_date)}</i></>}</td>
              <td className={td}>{ls.map((l) => <div key={l.id}>{l.sku_label} × {l.qty}</div>)}</td>
              <td className={`${td} text-right font-bold`}>{ls.reduce((a, l) => a + l.qty, 0)}</td><td className={td} />
            </tr>
          ))}
        </tbody>
      </table>
      <Signatures left="Dikemas oleh" right="Diperiksa oleh" />
    </Sheet>
  )
}

function Labels({ b, lines }: { b: BatchRow; lines: Line[] }) {
  const emps = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of lines) m.set(l.nik, [...(m.get(l.nik) ?? []), l])
    return [...m.values()]
  }, [lines])
  const pages: Line[][][] = []
  for (let i = 0; i < emps.length; i += 10) pages.push(emps.slice(i, i + 10))
  return (
    <>
      {pages.map((pg, pi) => (
        <Sheet key={pi}>
          <div className="grid grid-cols-2 gap-[4mm]">
            {pg.map((ls) => (
              <div key={ls[0].nik} className="flex h-[50mm] flex-col rounded border-2 border-dashed border-black p-3">
                <p className="text-[10px] uppercase tracking-wide">Seragam Apotek Alpro · {b.kode}</p>
                <p className="mt-1 text-[16px] font-extrabold leading-tight">{ls[0].nama}</p>
                <p className="font-mono">{ls[0].nik} · {ls[0].jabatan}</p>
                <p className="font-bold">{ls[0].cabang_nama}</p>
                <div className="mt-1 flex-1 text-[11px]">{ls.map((l) => <span key={l.id} className="mr-2 inline-block">{l.sku_label} ×{l.qty}</span>)}</div>
                {ls[0].employee_status === 'OFFERING' && <p className="rounded bg-black px-1.5 py-0.5 text-center text-[11px] font-bold text-white">SIMPAN DI APA — serahkan saat join {fmtDate(ls[0].planned_join_date)}</p>}
              </div>
            ))}
          </div>
        </Sheet>
      ))}
    </>
  )
}

function Bast({ b, br, emps }: { b: BatchRow; br: BranchRow; emps?: Map<string, Line[]> }) {
  const joiners = empRows(emps).filter((ls) => ls[0].employee_status === 'OFFERING').length
  return (
    <Sheet>
      <Head b={b} title="Berita Acara Serah Terima Seragam" right={<><p>No: <b>{b.kode}/{br.kode_cabang}</b></p><p>Tanggal: ____________</p></>} />
      <p className="mb-3">
        Pada tanggal tersebut di atas, Ops Support menyerahkan seragam kepada cabang <b>{br.cabang_nama} ({br.kode_cabang})</b> sebanyak <b>{br.jumlah_karyawan} paket</b> ({br.jumlah_pcs} pcs) dengan rincian berikut. APA/BM memeriksa kelengkapan dan menyerahkan paket kepada karyawan.
      </p>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>No</th><th className={th}>NIK / nama</th><th className={th}>Isi paket</th><th className={`${th} text-right`}>Pcs</th><th className={th}>Tgl serah ke karyawan</th><th className={th}>Paraf karyawan</th></tr></thead>
        <tbody>
          {empRows(emps).map((ls, i) => (
            <tr key={ls[0].nik}>
              <td className={td}>{i + 1}</td>
              <td className={td}><span className="font-mono">{ls[0].nik}</span><br /><b>{ls[0].nama}</b>{ls[0].employee_status === 'OFFERING' && <><br /><i>Joiner, join {fmtDate(ls[0].planned_join_date)}</i></>}</td>
              <td className={td}>{ls.map((l) => <div key={l.id}>{l.sku_label} × {l.qty}</div>)}</td>
              <td className={`${td} text-right`}>{ls.reduce((a, l) => a + l.qty, 0)}</td>
              <td className={`${td} w-[28mm]`} /><td className={`${td} w-[24mm]`} />
            </tr>
          ))}
        </tbody>
      </table>
      {joiners > 0 && <p className="mt-2 text-[11px]"><b>Catatan:</b> {joiners} paket joiner disimpan APA dan diserahkan pada hari join. Bila joiner batal/tidak hadir, paket dikembalikan ke Ops Support.</p>}
      <p className="mt-2 text-[11px]">Kekurangan / kerusakan: ______________________________________________________________</p>
      <Signatures left="Diserahkan oleh (Ops Support)" right="Diterima oleh (APA / Branch Manager)" />
      <p className="mt-3 text-[10px]">Setelah ditandatangani, foto/scan BAST ini diunggah di menu Batch Distribusi → Per cabang → Konfirmasi terima.</p>
    </Sheet>
  )
}

function Signatures({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-12 text-center">
      {[left, right].map((t) => <div key={t}><p>{t}</p><div className="h-16" /><p className="border-t border-black pt-1">Nama & tanda tangan</p></div>)}
    </div>
  )
}
