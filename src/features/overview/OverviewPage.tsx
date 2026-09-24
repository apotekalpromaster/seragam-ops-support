import clsx from 'clsx'
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, CheckCircle2, FileUp, Info, PackageCheck, ShieldAlert, Shirt, UserPlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { Button, Card, Chip, InfoTip, Skeleton } from '../../components/ui'
import { useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtDateTime, fmtMonthShort, fmtNum, fmtPct } from '../../lib/format'
import { DIFF_LABEL } from '../../lib/labels'

interface Kpi {
  karyawan_aktif: number; joiner_offering: number; aktif_lengkap: number; sku_stockout: number; sku_aktif: number
  total_outstanding_pcs: number; karyawan_outstanding: number; import_terakhir: string | null
}
interface Alert { kode: string; level: 'KRITIS' | 'PERINGATAN' | 'INFO'; judul: string; detail: string; jumlah: number; link: string }
interface ImportMonth { periode: string; tepat_waktu: boolean; ada_import: boolean }
interface ImportLog { id: number; file_name: string; committed_at: string; n_new: number; n_resign: number; n_mutasi: number; n_error: number; status: string; total_rows: number }
interface BatchMonth { periode: string; batch_dikirim: number; tepat_waktu: number }
interface JoinerMonth { periode: string; joiner: number; tiba_sebelum_join: number; late_hire: number }
interface ExMonth { periode: string; tukar: number; issue: number }
interface KpiReturn { dikembalikan: number; sisa: number; dihapuskan: number; karyawan_belum: number }
interface Ship { nik: string; penyerahan: string; batch_kode: string }
interface Joiner { nik: string; nama: string; jabatan: string; cabang_nama: string; planned_join_date: string; outstanding_total: number; size_problem: boolean; jabatan_unmapped: boolean }

export default function OverviewPage() {
  const kpi = useView<Kpi>('v_kpi_current')
  const alerts = useView<Alert>('v_alert', { order: [['urutan', 'asc']] })
  const months = useView<ImportMonth>('v_kpi_import_monthly', { order: [['periode', 'asc']] })
  const lastImport = useView<ImportLog>('v_import_log', { filters: [['status', 'eq', 'COMMITTED']], order: [['committed_at', 'desc']], limit: 1 })
  const joiners = useView<Joiner>('v_employee_list', { filters: [['status', 'eq', 'OFFERING']], order: [['planned_join_date', 'asc']] })
  const bm = useView<BatchMonth>('v_kpi_batch_monthly', { order: [['periode', 'asc']] })
  const jm = useView<JoinerMonth>('v_kpi_joiner_monthly', { order: [['periode', 'asc']] })
  const exm = useView<ExMonth>('v_kpi_exchange_monthly', { order: [['periode', 'asc']] })
  const kr = useView<KpiReturn>('v_kpi_return').data?.[0]
  const ships = useView<Ship>('v_batch_line', { columns: 'nik,penyerahan,batch_kode', filters: [['employee_status', 'eq', 'OFFERING'], ['penyerahan', 'neq', 'DIBATALKAN']] })
  const shipOf = (nik: string) => ships.data?.find((x) => x.nik === nik)
  const sum = <T,>(rows: T[] | undefined, k: keyof T) => (rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const batchPct = sum(bm.data, 'batch_dikirim') ? (sum(bm.data, 'tepat_waktu') / sum(bm.data, 'batch_dikirim')) * 100 : null
  const tibaPct = sum(jm.data, 'joiner') ? (sum(jm.data, 'tiba_sebelum_join') / sum(jm.data, 'joiner')) * 100 : null
  const latePct = sum(jm.data, 'joiner') ? (sum(jm.data, 'late_hire') / sum(jm.data, 'joiner')) * 100 : null
  const tukarPct = sum(exm.data, 'issue') ? (sum(exm.data, 'tukar') / sum(exm.data, 'issue')) * 100 : null
  const returPct = kr && kr.dikembalikan + kr.sisa + kr.dihapuskan > 0 ? (kr.dikembalikan / (kr.dikembalikan + kr.sisa + kr.dihapuskan)) * 100 : null
  const { isAdmin } = usePerm()
  const nav = useNavigate()
  const k = kpi.data?.[0]
  const lengkapPct = k && k.karyawan_aktif ? (k.aktif_lengkap / k.karyawan_aktif) * 100 : null
  const tepat = months.data?.filter((m) => m.tepat_waktu).length ?? 0
  const kepatuhanPct = months.data?.length ? (tepat / months.data.length) * 100 : null

  return (
    <Page
      title="Beranda"
      subtitle={<>Dashboard Alokasi Seragam <span className="mx-1">•</span> <span className="font-semibold text-emerald-600">Sistem Aktif</span></>}
      help="beranda"
      actions={isAdmin && <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => nav('/import')}>Import Data PPM</Button>}
    >
      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          loading={kpi.isLoading}
          label="Kelengkapan seragam"
          tip="% karyawan aktif yang sudah menerima seluruh hak seragamnya (outstanding = 0)."
          value={fmtPct(lengkapPct)}
          sub={k ? `${fmtNum(k.aktif_lengkap)} dari ${fmtNum(k.karyawan_aktif)} karyawan aktif` : ''}
          target="≥ 98%" ok={lengkapPct !== null ? lengkapPct >= 98 : undefined}
          icon={<Shirt className="size-5" />} tone="brand"
        />
        <KpiCard
          loading={kpi.isLoading}
          label="SKU stock-out"
          tip="Jumlah SKU aktif dengan stok tersedia (Available) ≤ 0."
          value={k ? fmtNum(k.sku_stockout) : '—'}
          sub={k ? `dari ${fmtNum(k.sku_aktif)} SKU aktif` : ''}
          target="0" ok={k ? k.sku_stockout === 0 : undefined}
          icon={<Boxes className="size-5" />} tone="red" onClick={() => nav('/stok?filter=habis')}
          footer={alerts.data && (
            <Link to="/pengadaan" onClick={(e) => e.stopPropagation()} className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700 ring-1 ring-inset ring-red-200">{alerts.data.find((x) => x.kode === 'SKU_KRITIS')?.jumlah ?? 0} kritis</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-inset ring-amber-200">{alerts.data.find((x) => x.kode === 'SKU_ORDER')?.jumlah ?? 0} perlu order</span>
              <span className="text-brand-600 hover:underline">Saran order →</span>
            </Link>
          )}
        />
        <KpiCard
          loading={months.isLoading}
          label="Kepatuhan data PPM"
          tip="% bulan (6 bulan terakhir) di mana import data PPM disimpan paling lambat tanggal cutoff."
          value={fmtPct(kepatuhanPct, 0)}
          sub={months.data ? `${tepat} dari ${months.data.length} bulan tepat waktu` : ''}
          target="100%" ok={kepatuhanPct !== null ? kepatuhanPct === 100 : undefined}
          icon={<CalendarClock className="size-5" />} tone="blue"
          footer={
            <div className="mt-3 flex items-end gap-1.5" aria-label="Riwayat kepatuhan per bulan">
              {months.data?.map((m) => (
                <div key={m.periode} className="flex flex-1 flex-col items-center gap-1" title={`${fmtMonthShort(m.periode)}: ${m.tepat_waktu ? 'tepat waktu' : m.ada_import ? 'terlambat' : 'tidak ada import'}`}>
                  <div className={clsx('h-5 w-full rounded', m.tepat_waktu ? 'bg-emerald-400' : m.ada_import ? 'bg-amber-400' : 'bg-slate-200')} />
                  <span className="text-[10px] text-muted">{fmtMonthShort(m.periode).split(' ')[0]}</span>
                </div>
              ))}
            </div>
          }
        />
        <KpiCard
          loading={kpi.isLoading}
          label="Antrian outstanding"
          tip="Total pcs seragam yang menjadi hak karyawan aktif/joiner tetapi belum dikirim."
          value={k ? `${fmtNum(k.total_outstanding_pcs)} pcs` : '—'}
          sub={k ? `${fmtNum(k.karyawan_outstanding)} karyawan · ${fmtNum(k.joiner_offering)} joiner akan datang` : ''}
          icon={<PackageCheck className="size-5" />} tone="green" onClick={() => nav('/karyawan?filter=outstanding')}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        {/* Alert */}
        <Card title="Perlu tindakan" subtitle="Diurutkan dari yang paling mendesak" bodyClass="p-0">
          {alerts.isLoading ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : !alerts.data?.length ? (
            <div className="flex items-center gap-3 p-6 text-sm text-emerald-700">
              <CheckCircle2 className="size-5" /> Tidak ada yang perlu ditindaklanjuti saat ini.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.data.map((a) => (
                <li key={a.kode}>
                  <Link to={a.link} className={clsx(
                    'flex items-center gap-4 border-l-4 px-5 py-4 hover:bg-slate-50',
                    a.level === 'KRITIS' ? 'border-l-red-500' : a.level === 'PERINGATAN' ? 'border-l-amber-400' : 'border-l-sky-400',
                  )}>
                    <div className={clsx('flex size-9 shrink-0 items-center justify-center rounded-full',
                      a.level === 'KRITIS' ? 'bg-red-50 text-red-600' : a.level === 'PERINGATAN' ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600')}>
                      {a.level === 'KRITIS' ? <ShieldAlert className="size-4" /> : a.level === 'PERINGATAN' ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {a.judul}
                        {a.jumlah > 1 || a.kode !== 'IMPORT_TERLAMBAT' && a.kode !== 'STOK_AWAL_BELUM' ? <span className="ml-2 num text-muted">({fmtNum(a.jumlah)})</span> : null}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">{a.detail}</p>
                    </div>
                    <span className="hidden items-center gap-1 text-sm font-semibold text-brand-600 sm:flex">Tindak lanjut <ArrowRight className="size-4" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Import terakhir */}
        <Card title="Data PPM terakhir" actions={<Link to="/import" className="text-sm font-semibold text-brand-600 hover:underline">Riwayat import</Link>}>
          {lastImport.isLoading ? <Skeleton className="h-28" /> : !lastImport.data?.length ? (
            <div className="text-sm text-muted">
              Belum ada import. {isAdmin ? <Link to="/import" className="font-semibold text-brand-600">Mulai import data PPM →</Link> : 'Hubungi admin untuk import data PPM.'}
            </div>
          ) : (() => {
            const l = lastImport.data[0]
            return (
              <div className="space-y-4">
                <div>
                  <p className="truncate font-semibold">{l.file_name}</p>
                  <p className="text-sm text-muted">Disimpan {fmtDateTime(l.committed_at)} · {fmtNum(l.total_rows)} baris</p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Karyawan/joiner baru" value={l.n_new} />
                  <Stat label={DIFF_LABEL.RESIGN} value={l.n_resign} />
                  <Stat label="Mutasi / pindah cabang" value={l.n_mutasi} />
                  <Stat label="Baris dilewati (error)" value={l.n_error} warn={l.n_error > 0} />
                </dl>
              </div>
            )
          })()}
        </Card>
      </div>

      <Card title="KPI distribusi" subtitle="6 bulan terakhir" bodyClass="grid gap-4 p-5 md:grid-cols-3">
        <MiniKpi label="Ketepatan batch" tip="% batch yang berstatus dikirim paling lambat tanggal deadline kirim." value={fmtPct(batchPct, 0)}
          sub={`${sum(bm.data, 'tepat_waktu')} dari ${sum(bm.data, 'batch_dikirim')} batch`} target="100%" ok={batchPct === null ? undefined : batchPct === 100}
          bars={bm.data?.map((m) => ({ key: m.periode, label: fmtMonthShort(m.periode).split(' ')[0], v: m.batch_dikirim ? m.tepat_waktu / m.batch_dikirim : null }))} />
        <MiniKpi label="Seragam tiba sebelum join" tip="% joiner yang paketnya sudah diterima cabang paling lambat tanggal join." value={fmtPct(tibaPct, 0)}
          sub={`${sum(jm.data, 'tiba_sebelum_join')} dari ${sum(jm.data, 'joiner')} joiner`} target="≥ 95%" ok={tibaPct === null ? undefined : tibaPct >= 95}
          bars={jm.data?.map((m) => ({ key: m.periode, label: fmtMonthShort(m.periode).split(' ')[0], v: m.joiner ? m.tiba_sebelum_join / m.joiner : null }))} />
        <MiniKpi label="Joiner di luar data forward" tip="% joiner yang tercatat sebagai hire mendadak (tidak muncul di data PPM sebelum join)." value={fmtPct(latePct, 0)}
          sub={`${sum(jm.data, 'late_hire')} dari ${sum(jm.data, 'joiner')} joiner`} target="≤ 10%" ok={latePct === null ? undefined : latePct <= 10} />
      </Card>

      <Card title="KPI transaksi & retur" subtitle="Tukar 6 bulan terakhir · retur semua karyawan resign" bodyClass="grid gap-4 p-5 md:grid-cols-2"
        actions={<Link to="/laporan" className="text-sm font-semibold text-brand-600 hover:underline">Laporan</Link>}>
        <MiniKpi label="Tingkat tukar" tip="Barang pengganti tukar cacat ÷ barang dikirim ke karyawan (per bulan)." value={fmtPct(tukarPct, 1)}
          sub={`${sum(exm.data, 'tukar')} tukar dari ${sum(exm.data, 'issue')} pcs dikirim`} target="< 3%" ok={tukarPct === null ? undefined : tukarPct < 3}
          bars={exm.data?.map((m) => ({ key: m.periode, label: fmtMonthShort(m.periode).split(' ')[0], v: m.issue ? m.tukar / m.issue : null }))} />
        <MiniKpi label="Return rate resign" tip="Item kembali ÷ item wajib kembali untuk karyawan resign & PKL selesai. Yang dihapuskan dihitung tidak kembali." value={fmtPct(returPct, 0)}
          sub={kr ? `${kr.dikembalikan} kembali · ${kr.sisa} belum (${kr.karyawan_belum} karyawan)` : ''} target="≥ 90%" ok={returPct === null ? undefined : returPct >= 90} />
      </Card>

      <Card title="Joiner akan datang" subtitle="Status OFFERING dari data PPM. Paket dikirim pada batch cutoff pertama di mana nama muncul." bodyClass="p-0"
        actions={<Link to="/karyawan?status=OFFERING" className="text-sm font-semibold text-brand-600 hover:underline">Lihat semua</Link>}>
        {joiners.isLoading ? <div className="p-5"><Skeleton className="h-24" /></div> : !joiners.data?.length ? (
          <p className="p-5 text-sm text-muted">Tidak ada joiner di data PPM terakhir.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-2.5">Nama</th><th className="px-5 py-2.5">Jabatan</th><th className="px-5 py-2.5">Cabang</th><th className="px-5 py-2.5">Rencana join</th><th className="px-5 py-2.5">Kesiapan paket</th></tr>
              </thead>
              <tbody>
                {joiners.data.slice(0, 8).map((j) => (
                  <tr key={j.nik} className="border-t border-slate-100">
                    <td className="px-5 py-3"><p className="font-semibold">{j.nama}</p><p className="text-xs text-muted">{j.nik}</p></td>
                    <td className="px-5 py-3">{j.jabatan}</td>
                    <td className="px-5 py-3">{j.cabang_nama}</td>
                    <td className="px-5 py-3 num">{fmtDate(j.planned_join_date)}</td>
                    <td className="px-5 py-3">
                      {(() => {
                        const sh = shipOf(j.nik)
                        if (sh && j.outstanding_total > 0) return <Chip tone="amber">Sebagian {sh.penyerahan === 'DITAHAN_APA' ? 'di cabang' : 'dalam proses'} · sisa {j.outstanding_total} pcs</Chip>
                        if (sh?.penyerahan === 'DITAHAN_APA') return <Chip tone="green">Sudah di cabang (ditahan APA)</Chip>
                        if (sh?.penyerahan === 'DIKIRIM') return <Chip tone="blue">Dalam pengiriman ({sh.batch_kode})</Chip>
                        if (sh?.penyerahan === 'DISIAPKAN') return <Chip tone="blue">Masuk batch {sh.batch_kode}</Chip>
                        if (j.jabatan_unmapped) return <Chip tone="amber">Jabatan belum dimapping</Chip>
                        if (j.size_problem) return <Chip tone="amber">Ukuran belum lengkap</Chip>
                        if (j.outstanding_total > 0) return <Chip tone="brand"><UserPlus className="size-3" /> Siap masuk batch ({j.outstanding_total} pcs)</Chip>
                        return <Chip tone="green">Lengkap</Chip>
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        KPI no-show dan akurasi stok (hasil opname) menyusul pada tahap monitoring, bersama tren 6 bulan untuk semua KPI.
      </p>
    </Page>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-2', warn ? 'border-amber-200 bg-amber-50' : 'border-line bg-slate-50/60')}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-bold num">{fmtNum(value)}</dd>
    </div>
  )
}

function KpiCard({ label, value, sub, target, ok, icon, tone, tip, loading, footer, onClick }: {
  label: string; value: string; sub?: string; target?: string; ok?: boolean; icon: ReactNode
  tone: 'brand' | 'red' | 'blue' | 'green'; tip: string; loading?: boolean; footer?: ReactNode; onClick?: () => void
}) {
  const toneCls = { brand: 'bg-brand-50 text-brand-600', red: 'bg-red-50 text-red-600', blue: 'bg-sky-50 text-sky-600', green: 'bg-emerald-50 text-emerald-600' }[tone]
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-white p-5 text-left shadow-sm shadow-slate-200/50">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">{label} <InfoTip>{tip}</InfoTip></p>
        <div className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl', toneCls)}>{icon}</div>
      </div>
      {loading ? <Skeleton className="mt-2 h-9 w-28" /> : <p className="mt-1 text-3xl font-extrabold tracking-tight num">{value}</p>}
      <p className="mt-1 text-sm text-muted">{sub}</p>
      {target && (
        <p className="mt-2 text-xs">
          <span className="text-muted">Target {target}</span>
          {ok !== undefined && (ok ? <span className="ml-2 font-semibold text-emerald-600">✓ tercapai</span> : <span className="ml-2 font-semibold text-red-600">belum tercapai</span>)}
        </p>
      )}
      {footer}
      {onClick && (
        <button onClick={onClick} className="mt-3 inline-flex items-center gap-1 self-start text-xs font-semibold text-brand-600 hover:underline">
          Lihat detail <ArrowRight className="size-3" />
        </button>
      )}
    </div>
  )
}

function MiniKpi({ label, tip, value, sub, target, ok, bars }: {
  label: string; tip: string; value: string; sub: string; target: string; ok?: boolean
  bars?: { key: string; label: string; v: number | null }[]
}) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">{label} <InfoTip>{tip}</InfoTip></p>
      <p className="mt-1 text-2xl font-extrabold num">{value}</p>
      <p className="text-sm text-muted">{sub}</p>
      <p className="mt-1 text-xs"><span className="text-muted">Target {target}</span>
        {ok === true && <span className="ml-2 font-semibold text-emerald-600">✓ tercapai</span>}
        {ok === false && <span className="ml-2 font-semibold text-red-600">belum tercapai</span>}
        {ok === undefined && <span className="ml-2 text-muted">belum ada data</span>}
      </p>
      {bars && (
        <div className="mt-3 flex items-end gap-1.5">
          {bars.map((b) => (
            <div key={b.key} className="flex flex-1 flex-col items-center gap-1" title={b.v === null ? `${b.label}: tidak ada data` : `${b.label}: ${Math.round(b.v * 100)}%`}>
              <div className="flex h-8 w-full items-end rounded bg-slate-100">
                {b.v !== null && <div className={clsx('w-full rounded', b.v >= 0.95 ? 'bg-emerald-400' : b.v >= 0.8 ? 'bg-amber-400' : 'bg-red-400')} style={{ height: `${Math.max(8, b.v * 100)}%` }} />}
              </div>
              <span className="text-[10px] text-muted">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
