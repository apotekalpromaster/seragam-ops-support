import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, FileUp, History, Upload, XCircle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog, Drawer } from '../../components/dialog'
import { Stepper } from '../../components/Stepper'
import { Button, Callout, Card, Chip, Field, Input, Select, Tabs, type Tone } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { toAppError } from '../../lib/errors'
import { fmtDateTime, fmtMonth, fmtNum, isoToday } from '../../lib/format'
import { DIFF_LABEL } from '../../lib/labels'
import { downloadTemplate, exportXlsx, readSheet } from '../../lib/xlsx'
import { PPM_TEMPLATE } from '../../lib/templates'
import { guessMapping, PPM_FIELDS, type PpmField } from './fields'

interface ImportLog {
  id: number; periode: string; file_name: string; status: string; total_rows: number; n_new: number; n_resign: number
  n_mutasi: number; n_error: number; n_warning: number; created_at: string; committed_at: string | null; created_by_nama: string | null; tepat_waktu: boolean
}
interface Msg { field: string; message: string; kode?: string }
interface StagingRow {
  import_id: number; row_no: number; nik: string | null; data: Record<string, string | null>
  errors: Msg[]; warnings: Msg[]; diff_types: string[]; diff_detail: { type: string; old: string | null; new: string | null }[]; hasil: 'ERROR' | 'PERINGATAN' | 'OK'
}

const DIFF_TONE: Record<string, Tone> = {
  NEW_OFFERING: 'brand', NEW_AKTIF: 'blue', JOINED: 'green', BATAL_JOIN: 'red', JOIN_DATE_CHANGE: 'amber',
  RENCANA_RESIGN: 'amber', RESIGN: 'red', MUTASI_JABATAN: 'violet', PINDAH_CABANG: 'violet', UBAH_UKURAN: 'slate', TIDAK_BERUBAH: 'slate',
}

type Step = 0 | 1 | 2 | 3
interface Parsed { file: File; headers: string[]; rows: Record<string, string>[]; hash: string; sheet: string; sheetNames: string[] }

export default function ImportPage() {
  const { isAdmin } = usePerm()
  const [step, setStep] = useState<Step>(0)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [periode, setPeriode] = useState(isoToday().slice(0, 7))
  const [mapping, setMapping] = useState<Record<PpmField, string> | null>(null)
  const [importId, setImportId] = useState<number | null>(null)
  const [result, setResult] = useState<{ baris_diproses: number; baris_dilewati: number } | null>(null)

  function reset() {
    setStep(0); setParsed(null); setMapping(null); setImportId(null); setResult(null)
  }

  return (
    <Page title="Import Data PPM" subtitle="Snapshot karyawan bulanan dari Dept. PPM" help="import"
      actions={<Button icon={<Download className="size-4" />} onClick={() => downloadTemplate(PPM_TEMPLATE)}>Unduh template</Button>}>
      {!isAdmin && <Callout tone="amber" title="Hanya admin yang bisa import">Anda bisa melihat riwayat import, tetapi upload data PPM hanya bisa dilakukan admin Ops Support.</Callout>}

      {isAdmin && (
        <Card bodyClass="p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <Stepper steps={['Upload file', 'Cocokkan kolom', 'Periksa hasil', 'Selesai']} current={step} />
            {step > 0 && step < 3 && <span className="text-sm text-muted truncate max-w-xs" title={parsed?.file.name}><FileSpreadsheet className="mr-1 inline size-4" />{parsed?.file.name}</span>}
          </div>
          {step === 0 && <UploadStep periode={periode} setPeriode={setPeriode} onParsed={(p) => { setParsed(p); setStep(1) }} />}
          {step === 1 && parsed && (
            <MappingStep parsed={parsed} periode={periode} onBack={reset}
              onChangeSheet={async (name) => { const p = await readSheet(parsed.file, name); setParsed({ ...p, file: parsed.file }) }}
              onPreview={(id, m) => { setImportId(id); setMapping(m); setStep(2) }} />
          )}
          {step === 2 && importId && (
            <PreviewStep importId={importId} onBack={() => setStep(1)} onCancelled={reset}
              onCommitted={(r) => { setResult(r); setStep(3) }} />
          )}
          {step === 3 && result && <DoneStep result={result} onAgain={reset} />}
          {mapping && null}
        </Card>
      )}

      <HistoryCard />
    </Page>
  )
}

// ---------- Langkah 1 ----------
function UploadStep({ periode, setPeriode, onParsed }: { periode: string; setPeriode: (v: string) => void; onParsed: (p: Parsed) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handle(file: File | undefined) {
    if (!file) return
    setErr(null)
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setErr('Format file harus .xlsx, .xls, atau .csv.'); return }
    if (file.size > 15 * 1024 * 1024) { setErr('File lebih dari 15 MB. Pastikan hanya berisi satu sheet data karyawan.'); return }
    setBusy(true)
    try {
      const p = await readSheet(file)
      if (!p.rows.length) { setErr('Sheet pertama tidak berisi baris data. Pastikan baris 1 adalah judul kolom.'); return }
      onParsed({ ...p, file })
    } catch {
      setErr('File tidak bisa dibaca. Simpan ulang sebagai .xlsx lalu coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files[0]) }}
        className={clsx('flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          drag ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50/60')}
      >
        <div className="flex size-14 items-center justify-center rounded-full bg-white text-brand-500 shadow-sm"><Upload className="size-6" /></div>
        <p className="mt-4 font-semibold">Tarik file snapshot PPM ke sini</p>
        <p className="mt-1 text-sm text-muted">atau pilih dari komputer — .xlsx, .xls, .csv</p>
        <Button variant="primary" className="mt-4" loading={busy} icon={<FileUp className="size-4" />} onClick={() => input.current?.click()}>Pilih file</Button>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = '' }} />
        {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
      </div>
      <div className="space-y-4">
        <Field label="Periode cutoff" hint="Bulan data ini dipakai. Dipakai untuk KPI kepatuhan data PPM." required>
          <Input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} max={isoToday().slice(0, 7)} />
        </Field>
        <Callout tone="blue" title="Sebelum upload">
          <ul className="list-disc space-y-1 pl-4">
            <li>Baris pertama = judul kolom.</li>
            <li>Pastikan kode cabang baru sudah ada di Master → Cabang.</li>
            <li>Belum ada data yang berubah sampai Anda menekan <b>Simpan</b> di langkah 3.</li>
          </ul>
        </Callout>
      </div>
    </div>
  )
}

// ---------- Langkah 2 ----------
function MappingStep({ parsed, periode, onBack, onPreview, onChangeSheet }: {
  parsed: Parsed; periode: string; onBack: () => void; onChangeSheet: (name: string) => Promise<void>
  onPreview: (id: number, m: Record<PpmField, string>) => void
}) {
  const saved = useView<{ field: string; source_column: string }>('import_column_map')
  const savedMap = useMemo(() => Object.fromEntries((saved.data ?? []).map((r) => [r.field, r.source_column])), [saved.data])
  const [map, setMap] = useState<Record<PpmField, string> | null>(null)
  const current = map ?? (saved.isSuccess ? guessMapping(parsed.headers, savedMap) : null)
  const [remember, setRemember] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const saveMap = useRpc('fn_column_map_save', { invalidate: false, silentError: true })
  const preview = useRpc<unknown, { id: number }>('fn_import_preview', { silentError: true })

  const missing = current ? PPM_FIELDS.filter((f) => f.required && !current[f.key]) : []
  const sample = parsed.rows[0] ?? {}

  async function submit() {
    if (!current) return
    setErr(null)
    if (missing.length) { setErr(`Kolom wajib belum dipilih: ${missing.map((m) => m.label).join(', ')}.`); return }
    try {
      if (remember) await saveMap.mutateAsync({ map: current })
      const rows = parsed.rows.map((r, i) => {
        const o: Record<string, string | number> = { _row: i + 2 }
        for (const f of PPM_FIELDS) o[f.key] = current[f.key] ? r[current[f.key]] ?? '' : ''
        return o
      })
      const res = await preview.mutateAsync({ file_name: parsed.file.name, file_hash: parsed.hash, periode: `${periode}-01`, rows })
      onPreview(res.id, current)
    } catch (e) {
      const a = toAppError(e)
      setErr(`${a.title}. ${a.message}`)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <p className="text-sm text-muted">
          Ditemukan <b className="text-ink">{fmtNum(parsed.rows.length)} baris</b> di sheet <b className="text-ink">{parsed.sheet}</b>. Periode: <b className="text-ink">{fmtMonth(`${periode}-01`)}</b>.
        </p>
        {parsed.sheetNames.length > 1 && (
          <Field label="Sheet" className="w-52">
            <Select value={parsed.sheet} onChange={(e) => void onChangeSheet(e.target.value)}>
              {parsed.sheetNames.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2.5">Field sistem</th><th className="px-4 py-2.5">Kolom di file</th><th className="px-4 py-2.5">Contoh isi (baris 2)</th></tr>
          </thead>
          <tbody>
            {PPM_FIELDS.map((f) => {
              const col = current?.[f.key] ?? ''
              const bad = f.required && !col
              return (
                <tr key={f.key} className={clsx('border-t border-slate-100', bad && 'bg-red-50/50')}>
                  <td className="px-4 py-2.5 font-medium">{f.label}{f.required && <span className="ml-1 text-red-500">*</span>}</td>
                  <td className="px-4 py-2">
                    <Select value={col} aria-label={`Kolom untuk ${f.label}`} aria-invalid={bad || undefined} className="h-9 max-w-xs"
                      onChange={(e) => setMap({ ...(current as Record<PpmField, string>), [f.key]: e.target.value })}>
                      <option value="">{f.required ? '— pilih kolom —' : '— tidak ada —'}</option>
                      {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-2.5 text-muted">{col ? sample[col] || <i>kosong</i> : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-brand-500" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Simpan pencocokan kolom ini untuk import berikutnya
      </label>
      {err && <Callout tone="red" icon={<XCircle className="size-4" />}>{err}</Callout>}
      <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-5">
        <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>Ganti file</Button>
        <Button variant="primary" onClick={() => void submit()} loading={preview.isPending || saveMap.isPending} disabled={!current}>Periksa data</Button>
      </div>
    </div>
  )
}

// ---------- Langkah 3 ----------
type Filter = 'semua' | 'ERROR' | 'PERINGATAN' | 'baru' | 'resign' | 'mutasi' | 'lain' | 'tetap'

function PreviewStep({ importId, onBack, onCancelled, onCommitted }: {
  importId: number; onBack: () => void; onCancelled: () => void
  onCommitted: (r: { baris_diproses: number; baris_dilewati: number }) => void
}) {
  const log = useView<ImportLog>('v_import_log', { filters: [['id', 'eq', importId]] })
  const rows = useView<StagingRow>('v_import_staging', { filters: [['import_id', 'eq', importId]], order: [['row_no', 'asc']] })
  const [tab, setTab] = useState<Filter>('semua')
  const [confirm, setConfirm] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const commit = useRpc<unknown, { baris_diproses: number; baris_dilewati: number }>('fn_import_commit', { success: (r) => `Import berhasil: ${r.baris_diproses} baris diproses.` })
  const cancel = useRpc('fn_import_cancel', { success: 'Import dibatalkan. Tidak ada data yang diubah.' })
  const l = log.data?.[0]
  const data = rows.data ?? []

  const has = (r: StagingRow, ...t: string[]) => r.diff_types.some((d) => t.includes(d))
  const groups: Record<Filter, (r: StagingRow) => boolean> = {
    semua: (r) => r.hasil === 'ERROR' || !has(r, 'TIDAK_BERUBAH') || r.hasil === 'PERINGATAN',
    ERROR: (r) => r.hasil === 'ERROR',
    PERINGATAN: (r) => r.hasil === 'PERINGATAN',
    baru: (r) => has(r, 'NEW_OFFERING', 'NEW_AKTIF'),
    resign: (r) => has(r, 'RESIGN', 'RENCANA_RESIGN', 'BATAL_JOIN'),
    mutasi: (r) => has(r, 'MUTASI_JABATAN', 'PINDAH_CABANG'),
    lain: (r) => has(r, 'JOINED', 'JOIN_DATE_CHANGE', 'UBAH_UKURAN'),
    tetap: (r) => has(r, 'TIDAK_BERUBAH') && r.hasil === 'OK',
  }
  const count = (f: Filter) => data.filter(groups[f]).length
  const filtered = data.filter(groups[tab])
  const valid = data.filter((r) => r.hasil !== 'ERROR').length
  // Kode gender "P" ambigu (Pria vs Perempuan). Tampilkan cara sistem membacanya.
  const rawG = new Set(data.map((r) => (r.data.gender_raw ?? '').toUpperCase()))
  const genderNote = rawG.has('P')
    ? rawG.has('L')
      ? 'Kode gender L/P terdeteksi: L dibaca Pria, P dibaca Perempuan (Wanita).'
      : 'Kode gender "P" dibaca sebagai Pria (tidak ada kode "L" di file). Jika maksudnya Perempuan, ubah menjadi W/Wanita di file.'
    : null

  const columns = useMemo<ColumnDef<StagingRow>[]>(() => [
    { accessorKey: 'row_no', header: 'Baris', meta: { align: 'right', className: 'w-16' } },
    { accessorKey: 'nik', header: 'NIK', cell: (c) => c.getValue() ?? <i className="text-muted">kosong</i> },
    { id: 'nama', header: 'Nama', accessorFn: (r) => r.data.nama, cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { id: 'jabatan', header: 'Jabatan', accessorFn: (r) => r.data.jabatan },
    { id: 'cabang', header: 'Cabang', accessorFn: (r) => r.data.kode_cabang },
    {
      id: 'perubahan', header: 'Perubahan', enableSorting: false,
      meta: { exportValue: (r) => r.diff_types.map((d) => DIFF_LABEL[d]).join(', ') },
      cell: ({ row: { original: r } }) => r.hasil === 'ERROR' ? <Chip tone="red">Dilewati</Chip> : (
        <div className="flex flex-wrap gap-1">
          {r.diff_detail.length ? r.diff_detail.map((d, i) => (
            <Chip key={i} tone={DIFF_TONE[d.type]} title={d.old || d.new ? `${d.old ?? '—'} → ${d.new ?? '—'}` : undefined}>
              {DIFF_LABEL[d.type]}{d.type !== 'NEW_OFFERING' && d.type !== 'NEW_AKTIF' && d.type !== 'RESIGN' && (d.old || d.new) ? `: ${d.old ?? '—'} → ${d.new ?? '—'}` : ''}
            </Chip>
          )) : r.diff_types.map((d) => <Chip key={d} tone={DIFF_TONE[d]}>{DIFF_LABEL[d]}</Chip>)}
        </div>
      ),
    },
    {
      id: 'pesan', header: 'Catatan', enableSorting: false,
      meta: { exportValue: (r) => [...r.errors, ...r.warnings].map((m) => m.message).join(' | ') },
      cell: ({ row: { original: r } }) => (
        <ul className="space-y-1 text-xs">
          {r.errors.map((m, i) => <li key={`e${i}`} className="flex gap-1.5 text-red-700"><XCircle className="mt-px size-3.5 shrink-0" />{m.message}</li>)}
          {r.warnings.map((m, i) => <li key={`w${i}`} className="flex gap-1.5 text-amber-700"><AlertTriangle className="mt-px size-3.5 shrink-0" />{m.message}</li>)}
        </ul>
      ),
    },
  ], [])

  function exportErrors() {
    const bad = data.filter((r) => r.hasil !== 'OK')
    exportXlsx(`catatan-import-${importId}`, bad, [
      { header: 'Baris di file', value: (r) => r.row_no },
      { header: 'NIK', value: (r) => r.nik },
      { header: 'Nama', value: (r) => r.data.nama },
      { header: 'Hasil', value: (r) => (r.hasil === 'ERROR' ? 'Dilewati' : 'Masuk dengan peringatan') },
      { header: 'Catatan', value: (r) => [...r.errors, ...r.warnings].map((m) => m.message).join(' | ') },
    ])
  }

  return (
    <div className="space-y-5">
      {l && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Summary label="Total baris" value={l.total_rows} />
          <Summary label="Baru" value={l.n_new} tone="brand" />
          <Summary label="Resign" value={l.n_resign} tone="red" />
          <Summary label="Mutasi / pindah" value={l.n_mutasi} tone="violet" />
          <Summary label="Peringatan" value={l.n_warning} tone="amber" hint="tetap masuk" />
          <Summary label="Error" value={l.n_error} tone="red" hint="dilewati" strong={l.n_error > 0} />
        </div>
      )}
      {genderNote && <Callout tone="blue">{genderNote}</Callout>}
      {l && l.n_error > 0 && (
        <Callout tone="red" icon={<XCircle className="size-4" />} title={`${l.n_error} baris akan dilewati`}
          action={<Button size="sm" icon={<Download className="size-3.5" />} onClick={exportErrors}>Unduh daftar catatan</Button>}>
          Baris ini tidak disimpan. Perbaiki di file lalu import ulang, atau simpan baris yang valid sekarang dan susulkan sisanya.
        </Callout>
      )}
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'semua', label: 'Perlu dilihat', count: count('semua') },
        { value: 'ERROR', label: 'Error', count: count('ERROR'), hidden: !count('ERROR') },
        { value: 'PERINGATAN', label: 'Peringatan', count: count('PERINGATAN'), hidden: !count('PERINGATAN') },
        { value: 'baru', label: 'Baru', count: count('baru') },
        { value: 'resign', label: 'Resign / batal', count: count('resign') },
        { value: 'mutasi', label: 'Mutasi', count: count('mutasi') },
        { value: 'lain', label: 'Perubahan lain', count: count('lain') },
        { value: 'tetap', label: 'Tidak berubah', count: count('tetap') },
      ]} />
      <div className="rounded-xl border border-line">
        <DataTable data={filtered} columns={columns} loading={rows.isLoading} error={rows.error} searchKeys={['nik']}
          searchPlaceholder="Cari NIK…" exportName={`preview-import-${importId}`} pageSize={25} dense
          rowClassName={(r) => (r.hasil === 'ERROR' ? 'bg-red-50/40' : undefined)}
          empty={<p className="p-8 text-center text-sm text-muted">Tidak ada baris di kategori ini.</p>} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5">
        <div className="flex gap-2">
          <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>Ubah pencocokan kolom</Button>
          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmCancel(true)}>Batalkan import</Button>
        </div>
        <Button variant="primary" onClick={() => setConfirm(true)} disabled={!valid}>Simpan {fmtNum(valid)} baris</Button>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Simpan hasil import ke data karyawan?" confirmLabel={`Simpan ${fmtNum(valid)} baris`} loading={commit.isPending}
        onConfirm={async () => {
          try { const r = await commit.mutateAsync({ import_id: importId }); setConfirm(false); onCommitted(r) } catch { setConfirm(false) }
        }}>
        <ul className="space-y-1.5">
          <li>• <b>{fmtNum(valid)}</b> baris karyawan disimpan/diperbarui.</li>
          {l && l.n_new > 0 && <li>• <b>{fmtNum(l.n_new)}</b> karyawan/joiner baru masuk antrian alokasi (jika jabatan sudah dimapping & ukuran lengkap).</li>}
          {l && l.n_resign > 0 && <li>• <b>{fmtNum(l.n_resign)}</b> karyawan berstatus resign.</li>}
          {l && l.n_error > 0 && <li className="text-red-700">• <b>{fmtNum(l.n_error)}</b> baris error dilewati.</li>}
        </ul>
        <p className="text-muted">File yang sama tidak bisa disimpan dua kali.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} title="Batalkan import ini?" confirmLabel="Ya, batalkan" danger loading={cancel.isPending}
        onConfirm={async () => { try { await cancel.mutateAsync({ import_id: importId }); setConfirmCancel(false); onCancelled() } catch { setConfirmCancel(false) } }}>
        Hasil pemeriksaan dibuang dan tidak ada data karyawan yang diubah. Anda bisa upload file lagi kapan saja.
      </ConfirmDialog>
    </div>
  )
}

function Summary({ label, value, tone, hint, strong }: { label: string; value: number; tone?: Tone; hint?: string; strong?: boolean }) {
  const t = { brand: 'text-brand-600', red: 'text-red-600', violet: 'text-violet-600', amber: 'text-amber-600', green: 'text-emerald-600', blue: 'text-sky-600', slate: 'text-ink' }[tone ?? 'slate']
  return (
    <div className={clsx('rounded-xl border px-4 py-3', strong ? 'border-red-200 bg-red-50' : 'border-line bg-slate-50/50')}>
      <p className="text-xs font-semibold text-muted">{label}{hint && <span className="font-normal"> · {hint}</span>}</p>
      <p className={clsx('mt-0.5 text-2xl font-extrabold num', value ? t : 'text-slate-300')}>{fmtNum(value)}</p>
    </div>
  )
}

// ---------- Langkah 4 ----------
function DoneStep({ result, onAgain }: { result: { baris_diproses: number; baris_dilewati: number }; onAgain: () => void }) {
  const unmapped = useView<{ jabatan: string }>('v_unmapped_position')
  const sizes = useView<{ nik: string }>('v_size_issue')
  const nSize = new Set(sizes.data?.map((s) => s.nik)).size
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-7" /></div>
      <h2 className="mt-4 text-xl font-bold">Import selesai</h2>
      <p className="mt-1 text-sm text-muted">{fmtNum(result.baris_diproses)} baris diproses{result.baris_dilewati ? `, ${fmtNum(result.baris_dilewati)} baris dilewati karena error` : ''}.</p>
      <div className="mt-6 w-full max-w-lg space-y-3 text-left">
        {!!unmapped.data?.length && (
          <Callout tone="amber" title={`${unmapped.data.length} jabatan belum dimapping ke paket`} action={<Link to="/master/jabatan"><Button size="sm" variant="soft">Mapping sekarang</Button></Link>}>
            Karyawan dengan jabatan ini belum masuk antrian.
          </Callout>
        )}
        {nSize > 0 && (
          <Callout tone="amber" title={`${nSize} karyawan ukurannya kosong / tidak tersedia`} action={<Link to="/karyawan?filter=ukuran"><Button size="sm" variant="soft">Lihat daftar</Button></Link>}>
            Tagih ukuran ke PPM sebelum cutoff berikutnya.
          </Callout>
        )}
      </div>
      <div className="mt-6 flex gap-2">
        <Button onClick={onAgain}>Import file lain</Button>
        <Link to="/karyawan"><Button variant="primary">Lihat data karyawan</Button></Link>
      </div>
    </div>
  )
}

// ---------- Riwayat ----------
function HistoryCard() {
  const log = useView<ImportLog>('v_import_log', { filters: [['status', 'neq', 'PREVIEW']], order: [['created_at', 'desc']] })
  const [open, setOpen] = useState<ImportLog | null>(null)
  const columns = useMemo<ColumnDef<ImportLog>[]>(() => [
    { accessorKey: 'created_at', header: 'Waktu upload', cell: ({ row: { original: r } }) => <div className="whitespace-nowrap"><p>{fmtDateTime(r.created_at)}</p><p className="text-xs text-muted">{r.created_by_nama ?? '—'}</p></div>, meta: { exportValue: (r) => r.created_at } },
    { accessorKey: 'periode', header: 'Periode', cell: (c) => fmtMonth(c.getValue() as string) },
    { accessorKey: 'file_name', header: 'File', cell: (c) => <span className="font-medium break-all">{c.getValue() as string}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: r } }) => r.status === 'COMMITTED'
      ? <Chip tone={r.tepat_waktu ? 'green' : 'amber'}>{r.tepat_waktu ? 'Masuk tepat waktu' : 'Masuk terlambat'}</Chip>
      : <Chip tone="slate">Dibatalkan</Chip> },
    { accessorKey: 'total_rows', header: 'Baris', meta: { align: 'right' } },
    { accessorKey: 'n_new', header: 'Baru', meta: { align: 'right' } },
    { accessorKey: 'n_resign', header: 'Resign', meta: { align: 'right' } },
    { accessorKey: 'n_mutasi', header: 'Mutasi', meta: { align: 'right' } },
    { accessorKey: 'n_error', header: 'Error', meta: { align: 'right' }, cell: (c) => <span className={(c.getValue() as number) ? 'font-semibold text-red-600' : ''}>{c.getValue() as number}</span> },
  ], [])
  return (
    <Card title={<span className="flex items-center gap-2"><History className="size-4 text-slate-400" /> Riwayat import</span>} subtitle="Klik baris untuk melihat detail perubahan" bodyClass="p-0">
      <DataTable data={log.data} columns={columns} loading={log.isLoading} error={log.error} onRowClick={setOpen} exportName="riwayat-import-ppm" pageSize={10}
        empty={<p className="p-8 text-center text-sm text-muted">Belum ada import. Mulai dengan mengunggah snapshot PPM di atas.</p>} />
      {open && <DiffDrawer log={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}

interface Diff { id: number; nik: string; nama: string | null; change_type: string; old_value: string | null; new_value: string | null }

function DiffDrawer({ log, onClose }: { log: ImportLog; onClose: () => void }) {
  const diffs = useView<Diff>('v_import_diff', { filters: [['import_id', 'eq', log.id]], order: [['nik', 'asc']] })
  const columns = useMemo<ColumnDef<Diff>[]>(() => [
    { accessorKey: 'nik', header: 'NIK' },
    { accessorKey: 'nama', header: 'Nama' },
    { accessorKey: 'change_type', header: 'Perubahan', cell: (c) => <Chip tone={DIFF_TONE[c.getValue() as string]}>{DIFF_LABEL[c.getValue() as string]}</Chip>, meta: { exportValue: (r) => DIFF_LABEL[r.change_type] } },
    { id: 'detail', header: 'Detail', accessorFn: (r) => `${r.old_value ?? '—'} → ${r.new_value ?? '—'}`, cell: (c) => <span className="text-muted">{c.getValue() as string}</span> },
  ], [])
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={log.file_name} subtitle={`Periode ${fmtMonth(log.periode)} · di-commit ${fmtDateTime(log.committed_at)} oleh ${log.created_by_nama ?? '—'}`}>
      <div className="rounded-xl border border-line bg-white">
        <DataTable data={diffs.data} columns={columns} loading={diffs.isLoading} searchKeys={['nik', 'nama']} searchPlaceholder="Cari NIK / nama…" exportName={`perubahan-import-${log.id}`} dense pageSize={30}
          empty={<p className="p-8 text-center text-sm text-muted">Tidak ada perubahan tercatat (semua baris sama dengan data sebelumnya).</p>} />
      </div>
    </Drawer>
  )
}
