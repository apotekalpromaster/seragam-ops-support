import { useState } from 'react'
import { Modal } from '../../components/dialog'
import { Button, Callout, Field, Input, Select } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { isoToday } from '../../lib/format'
import { useConfig } from '../../lib/schedule'

const HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']

/** Input hire mendadak (joiner di luar data forward PPM) — PRD §4.2. */
export function HireEventModal({ onClose }: { onClose: () => void }) {
  const branches = useView<{ kode_cabang: string; nama: string }>('branch', { filters: [['active', 'eq', true]], order: [['nama', 'asc']] })
  const positions = useView<{ jabatan: string; package_code: string | null }>('v_position', { order: [['jabatan', 'asc']] })
  const sizes = useView<{ size_code: string }>('size', { order: [['size_order', 'asc']] })
  const items = useView<{ size_group: string; sizes: string[] }>('v_item', { filters: [['active', 'eq', true]] })
  // Ukuran yang tersedia per kolom ukuran (mis. polo hanya S–3XL)
  const allowed = (grp: string) => new Set((items.data ?? []).filter((i) => i.size_group === grp).flatMap((i) => i.sizes))
  const cfg = useConfig()
  const [f, setF] = useState({ nik: '', nama: '', gender: '', jabatan: '', kode_cabang: '', status_karyawan: 'PROBATION', planned_join_date: isoToday(), size_kemeja: '', size_polo: '', size_blazer: '' })
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  const m = useRpc('fn_hire_event', { success: `Hire mendadak ${f.nama} tercatat. Masuk antrian untuk batch ad-hoc.` })
  const unmapped = f.jabatan && positions.data && !positions.data.find((p) => p.jabatan.toLowerCase() === f.jabatan.trim().toLowerCase())?.package_code
  const ok = f.nik.trim() && f.nama.trim() && f.gender && f.jabatan.trim() && f.kode_cabang && f.planned_join_date
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Input hire mendadak" size="lg"
      description="Untuk joiner yang offering-nya setelah cutoff dan join sebelum data PPM berikutnya. Karyawan ditandai hire mendadak (KPI joiner di luar data forward)."
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={m.isPending} disabled={!ok}
        onClick={async () => { try { await m.mutateAsync(f); onClose() } catch { /* toast */ } }}>Simpan</Button></>}>
      <div className="space-y-4">
        <Callout tone="blue">Diproses lewat batch ad-hoc mingguan (setiap <b>{HARI[Number(cfg.get('adhoc_batch_weekday', 1))]}</b>). Pastikan ukuran diisi supaya bisa langsung dikirim.</Callout>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NIK" required><Input value={f.nik} onChange={(e) => set('nik', e.target.value)} /></Field>
          <Field label="Nama" required><Input value={f.nama} onChange={(e) => set('nama', e.target.value)} /></Field>
          <Field label="Gender" required>
            <Select value={f.gender} onChange={(e) => set('gender', e.target.value)}><option value="">— pilih —</option><option value="P">Pria</option><option value="W">Wanita</option></Select>
          </Field>
          <Field label="Jabatan" required error={unmapped ? 'Jabatan ini belum dimapping ke paket — karyawan belum masuk antrian sampai dimapping.' : undefined}>
            <Input list="jabatan-list" value={f.jabatan} onChange={(e) => set('jabatan', e.target.value)} placeholder="Ketik atau pilih" />
            <datalist id="jabatan-list">{positions.data?.map((p) => <option key={p.jabatan} value={p.jabatan} />)}</datalist>
          </Field>
          <Field label="Cabang" required>
            <Select value={f.kode_cabang} onChange={(e) => set('kode_cabang', e.target.value)}>
              <option value="">— pilih cabang —</option>
              {branches.data?.map((b) => <option key={b.kode_cabang} value={b.kode_cabang}>{b.nama} ({b.kode_cabang})</option>)}
            </Select>
          </Field>
          <Field label="Rencana tanggal join" required><Input type="date" value={f.planned_join_date} onChange={(e) => set('planned_join_date', e.target.value)} /></Field>
          <Field label="Status kepegawaian">
            <Select value={f.status_karyawan} onChange={(e) => set('status_karyawan', e.target.value)}>
              {['PROBATION', 'KONTRAK', 'TETAP', 'PART_TIME', 'PKL'].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['size_kemeja', 'size_polo', 'size_blazer'] as const).map((k) => (
            <Field key={k} label={{ size_kemeja: 'Ukuran kemeja', size_polo: 'Ukuran polo', size_blazer: 'Ukuran blazer' }[k]}>
              <Select value={f[k]} onChange={(e) => set(k, e.target.value)}>
                <option value="">— kosong —</option>
                {sizes.data?.map((s) => {
                  const a = allowed(k.replace('size_', '').toUpperCase())
                  const off = a.size > 0 && !a.has(s.size_code)
                  return <option key={s.size_code} value={s.size_code} disabled={off}>{s.size_code}{off ? ' (tidak tersedia)' : ''}</option>
                })}
              </Select>
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  )
}
