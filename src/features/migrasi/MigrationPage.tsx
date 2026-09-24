import clsx from 'clsx'
import { CheckCircle2, Circle, Download, Upload, XCircle } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Page } from '../../components/AppShell'
import { Modal } from '../../components/dialog'
import { Button, Callout, Card } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { fmtNum } from '../../lib/format'
import { BRANCH_TEMPLATE, CHART_TEMPLATE, HISTORY_TEMPLATE, MAPPING_TEMPLATE, OPNAME_TEMPLATE, PPM_TEMPLATE, PRICE_TEMPLATE } from '../../lib/templates'
import { downloadTemplate, readSheet, type TemplateSpec } from '../../lib/xlsx'


interface Counts { cabang: number; harga: number; mapping: number; karyawan: number; opening: boolean; riwayat: number; chart: number }

function useCounts(): Counts | null {
  const b = useView<{ kode_cabang: string }>('branch', { columns: 'kode_cabang' })
  const p = useView<{ sku_code: string }>('v_sku_price_current', { columns: 'sku_code' })
  const m = useView<{ jabatan: string }>('position_map', { columns: 'jabatan' })
  const e = useView<{ nik: string }>('employee', { columns: 'nik' })
  const o = useView<{ id: number }>('ledger', { columns: 'id', filters: [['tx_type', 'eq', 'OPENING']], limit: 1 })
  const r = useView<{ id: number }>('ledger', { columns: 'id', filters: [['affects_stock', 'is', false]] })
  const c = useView<{ item_code: string }>('size_chart', { columns: 'item_code' })
  if (!b.data || !p.data || !m.data || !e.data || !o.data || !r.data || !c.data) return null
  return { cabang: b.data.length, harga: p.data.length, mapping: m.data.length, karyawan: e.data.length, opening: o.data.length > 0, riwayat: r.data.length, chart: c.data.length }
}

export default function MigrationPage() {
  const c = useCounts()
  const [errors, setErrors] = useState<{ title: string; list: { baris: number; pesan: string }[] } | null>(null)
  const steps: { n: number; title: string; desc: string; tpl: TemplateSpec; done?: boolean; status: string; action: ReactNode }[] = [
    { n: 1, title: 'Price list, vendor, lead time, MOQ', desc: 'Harga per SKU dan vendornya.', tpl: PRICE_TEMPLATE, done: !!c && c.harga > 0, status: c ? `${c.harga} SKU berharga` : '…',
      action: <Link to="/master/harga"><Button size="sm">Buka Harga & Vendor</Button></Link> },
    { n: 2, title: 'Daftar cabang & area', desc: 'Termasuk jadwal Grand Opening cabang baru.', tpl: BRANCH_TEMPLATE, done: !!c && c.cabang > 0, status: c ? `${c.cabang} cabang` : '…',
      action: <Link to="/master/cabang"><Button size="sm">Buka Cabang</Button></Link> },
    { n: 3, title: 'Mapping jabatan → paket', desc: 'Satu jabatan satu paket.', tpl: MAPPING_TEMPLATE, done: !!c && c.mapping > 0, status: c ? `${c.mapping} jabatan` : '…',
      action: <UploadButton label="Upload mapping" fn="fn_mapping_bulk" onErrors={(l) => setErrors({ title: 'Mapping jabatan', list: l })} /> },
    { n: 4, title: 'Snapshot karyawan dari PPM', desc: 'Karyawan aktif terbaru, termasuk ukuran bila ada.', tpl: PPM_TEMPLATE, done: !!c && c.karyawan > 0, status: c ? `${fmtNum(c.karyawan)} karyawan` : '…',
      action: <Link to="/import"><Button size="sm">Buka Import PPM</Button></Link> },
    { n: 5, title: 'Stok awal (stock opname)', desc: 'Hasil hitung fisik per SKU → saldo awal.', tpl: OPNAME_TEMPLATE, done: !!c && c.opening, status: c ? (c.opening ? 'Saldo awal terbentuk' : 'Belum') : '…',
      action: <Link to="/opname"><Button size="sm">Buka Stock Opname</Button></Link> },
    { n: 6, title: 'Riwayat distribusi lama', desc: 'Seragam yang sudah diterima sebelum sistem. Mengurangi outstanding, tidak mengubah stok.', tpl: HISTORY_TEMPLATE, done: !!c && c.riwayat > 0, status: c ? `${fmtNum(c.riwayat)} baris` : '…',
      action: <UploadButton label="Upload riwayat" fn="fn_issue_history_import" onErrors={(l) => setErrors({ title: 'Riwayat distribusi', list: l })} /> },
    { n: 7, title: 'Size chart vendor', desc: 'Ukuran badan (cm) per item & gender.', tpl: CHART_TEMPLATE, done: !!c && c.chart > 0, status: c ? `${c.chart} ukuran` : '…',
      action: <UploadButton label="Upload size chart" fn="fn_size_chart_save" onErrors={(l) => setErrors({ title: 'Size chart', list: l })} /> },
  ]
  return (
    <Page title="Migrasi Data Awal" subtitle="Pindahkan data dari spreadsheet lama — ikuti urutan 1 sampai 7" help="migrasi">
      <Callout tone="brand" title="Urutan penting">Cabang dan mapping harus ada sebelum import karyawan; karyawan harus ada sebelum riwayat distribusi. Setiap template berisi sheet <b>Petunjuk</b>.</Callout>
      <Card bodyClass="p-0">
        <ol className="divide-y divide-slate-100">
          {steps.map((s) => (
            <li key={s.n} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full', s.done ? 'text-emerald-600' : 'text-slate-300')}>
                {s.done ? <CheckCircle2 className="size-6" /> : <Circle className="size-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.n}. {s.title}</p>
                <p className="text-sm text-muted">{s.desc} <span className={clsx('ml-1 font-semibold', s.done ? 'text-emerald-700' : 'text-slate-500')}>· {s.status}</span></p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => downloadTemplate(s.tpl)}>Template</Button>
                {s.action}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {errors && (
        <Modal open onOpenChange={() => setErrors(null)} title={`${errors.title}: ${errors.list.length} baris bermasalah`} description="Tidak ada data yang disimpan. Perbaiki baris berikut lalu upload ulang."
          footer={<Button onClick={() => setErrors(null)}>Tutup</Button>}>
          <ul className="space-y-1.5 text-sm">
            {errors.list.map((e, i) => <li key={i} className="flex gap-2 text-red-700"><XCircle className="mt-0.5 size-4 shrink-0" />Baris {e.baris + 1}: {e.pesan}</li>)}
          </ul>
        </Modal>
      )}
    </Page>
  )
}

function UploadButton({ label, fn, onErrors }: { label: string; fn: string; onErrors: (l: { baris: number; pesan: string }[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const m = useRpc<unknown, { ok: boolean; jumlah?: number; errors?: { baris: number; pesan: string }[] }>(fn)
  async function go(file?: File) {
    if (!file) return
    try {
      const { rows } = await readSheet(file)
      const r = await m.mutateAsync({ rows })
      if (r.ok) toast.success(`${fmtNum(r.jumlah ?? rows.length)} baris disimpan.`)
      else onErrors(r.errors ?? [])
    } catch { /* toast dari useRpc */ }
  }
  return (
    <>
      <Button size="sm" variant="primary" icon={<Upload className="size-3.5" />} loading={m.isPending} onClick={() => ref.current?.click()}>{label}</Button>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void go(e.target.files?.[0]); e.target.value = '' }} />
    </>
  )
}
