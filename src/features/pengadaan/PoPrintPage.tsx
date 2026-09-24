import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, LoadingBlock } from '../../components/ui'
import { useView } from '../../lib/api'
import { fmtDate, fmtDateLong, fmtNum, fmtRp } from '../../lib/format'
import type { PoLine, PoRow } from './planning'

const th = 'border border-black px-2 py-1 text-left font-bold bg-slate-100'
const td = 'border border-black px-2 py-1 align-top'

/** Dokumen PO untuk dikirim ke vendor. Dicetak / disimpan PDF lewat dialog print browser. */
export default function PoPrintPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const po = useView<PoRow>('v_po', { filters: [['id', 'eq', Number(id)]] }).data?.[0]
  const lines = useView<PoLine>('v_po_line', { filters: [['po_id', 'eq', Number(id)]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  useEffect(() => { if (po) document.title = `Purchase Order — ${po.kode}` }, [po])
  if (!po || lines.isLoading) return <LoadingBlock />
  const draft = po.status === 'DRAFT'

  return (
    <div className="min-h-full bg-slate-100 print:bg-white">
      <style>{'@page { size: A4; margin: 12mm } @media print { .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important } }'}</style>
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-6 py-3">
        <Button icon={<ArrowLeft className="size-4" />} onClick={() => nav(`/pengadaan/po/${po.id}`)}>Kembali ke PO</Button>
        <p className="font-bold">Purchase Order · {po.kode}</p>
        {draft && <span className="text-sm font-semibold text-amber-700">Masih draft — dokumen bertanda DRAFT.</span>}
        <Button variant="primary" className="ml-auto" icon={<Printer className="size-4" />} onClick={() => window.print()}>Cetak</Button>
      </div>
      <div className="py-6 print:py-0">
        <section className="sheet relative mx-auto w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-black shadow">
          {draft && <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] font-black tracking-[0.2em] text-slate-200/60 [transform:rotate(-24deg)]">DRAFT</p>}
          <header className="relative mb-4 flex items-start justify-between border-b-2 border-black pb-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide">Apotek Alpro · Departemen Ops Support</p>
              <h1 className="text-xl font-extrabold">PURCHASE ORDER</h1>
              <p>Seragam karyawan</p>
            </div>
            <table className="text-right">
              <tbody>
                <tr><td className="pr-2">No. PO</td><td className="font-bold">{po.kode}</td></tr>
                <tr><td className="pr-2">Tanggal</td><td>{fmtDate(po.sent_at ?? po.tanggal)}</td></tr>
                <tr><td className="pr-2">Perkiraan tiba</td><td>{fmtDate(po.eta)}</td></tr>
              </tbody>
            </table>
          </header>
          <div className="mb-4 grid grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] font-bold uppercase">Kepada (vendor)</p>
              <p className="font-bold">{po.vendor_nama}</p>
              {po.vendor_kontak && <p>{po.vendor_kontak}</p>}
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase">Kirim ke</p>
              <p className="font-bold">Gudang Ops Support HQ</p>
              <p>Apotek Alpro Indonesia</p>
            </div>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr><th className={th}>No</th><th className={th}>Kode SKU</th><th className={th}>Deskripsi</th><th className={`${th} text-right`}>Qty (pcs)</th><th className={`${th} text-right`}>Harga satuan</th><th className={`${th} text-right`}>Jumlah</th></tr>
            </thead>
            <tbody>
              {lines.data?.map((l, i) => (
                <tr key={l.sku_code}>
                  <td className={td}>{i + 1}</td><td className={`${td} font-mono`}>{l.sku_code}</td><td className={td}>{l.sku_label}</td>
                  <td className={`${td} text-right`}>{fmtNum(l.qty_order)}</td><td className={`${td} text-right`}>{fmtRp(l.harga)}</td><td className={`${td} text-right`}>{fmtRp(l.nilai)}</td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-bold`} colSpan={3}>Total</td>
                <td className={`${td} text-right font-bold`}>{fmtNum(po.qty_order)}</td><td className={td} />
                <td className={`${td} text-right font-bold`}>{fmtRp(po.nilai)}</td>
              </tr>
            </tbody>
          </table>
          {po.catatan && <p className="mt-3"><b>Catatan:</b> {po.catatan}</p>}
          <p className="mt-3 text-[11px]">Mohon cantumkan nomor PO pada surat jalan. Pengiriman sebagian diperbolehkan; setiap pengiriman disertai surat jalan.</p>
          <div className="mt-10 grid grid-cols-3 gap-6 text-center">
            {['Dibuat oleh', 'Disetujui', 'Diterima vendor'].map((t) => (
              <div key={t}><p>{t}</p><div className="h-20" /><p className="border-t border-black pt-1">Nama & tanggal</p></div>
            ))}
          </div>
          <p className="mt-6 text-right text-[10px] text-slate-500">Dicetak {fmtDateLong(new Date())}</p>
        </section>
      </div>
    </div>
  )
}
