/** Field sistem untuk import snapshot PPM, beserta sinonim judul kolom yang umum. */
export const PPM_FIELDS = [
  { key: 'nik', label: 'NIK', required: true, syn: ['nik', 'no induk', 'nomor induk', 'employee id', 'id karyawan'] },
  { key: 'nama', label: 'Nama', required: true, syn: ['nama', 'nama karyawan', 'name', 'nama lengkap'] },
  { key: 'gender', label: 'Gender', required: true, syn: ['gender', 'jenis kelamin', 'jk', 'sex', 'l/p'] },
  { key: 'jabatan', label: 'Jabatan', required: true, syn: ['jabatan', 'posisi', 'position', 'job title'] },
  { key: 'kode_cabang', label: 'Kode cabang', required: true, syn: ['kode cabang', 'kode_cabang', 'cabang', 'kode outlet', 'outlet', 'branch', 'store code'] },
  { key: 'status', label: 'Status (AKTIF/OFFERING/RESIGN/BATAL_JOIN)', required: true, syn: ['status', 'status data', 'status karyawan aktif'] },
  { key: 'status_karyawan', label: 'Status kepegawaian (TETAP/KONTRAK/PKL…)', required: false, syn: ['status karyawan', 'status_karyawan', 'status kepegawaian', 'tipe karyawan', 'employment type'] },
  { key: 'planned_join_date', label: 'Rencana tanggal join', required: false, syn: ['rencana join', 'planned join date', 'planned_join_date', 'tanggal rencana join', 'tgl rencana join'] },
  { key: 'join_date', label: 'Tanggal join', required: false, syn: ['tanggal join', 'join date', 'join_date', 'tgl join', 'tanggal masuk', 'tmt'] },
  { key: 'planned_resign_date', label: 'Rencana tanggal resign', required: false, syn: ['rencana resign', 'planned resign date', 'planned_resign_date', 'tgl rencana resign'] },
  { key: 'resign_date', label: 'Tanggal resign', required: false, syn: ['tanggal resign', 'resign date', 'resign_date', 'tgl resign', 'tanggal keluar'] },
  { key: 'size_kemeja', label: 'Ukuran kemeja', required: false, syn: ['ukuran kemeja', 'size kemeja', 'size_kemeja', 'kemeja'] },
  { key: 'size_polo', label: 'Ukuran polo', required: false, syn: ['ukuran polo', 'size polo', 'size_polo', 'polo', 'kaos'] },
  { key: 'size_blazer', label: 'Ukuran blazer', required: false, syn: ['ukuran blazer', 'size blazer', 'size_blazer', 'blazer'] },
] as const

export type PpmField = (typeof PPM_FIELDS)[number]['key']

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ').trim()

/** Tebak mapping: pakai mapping tersimpan bila kolomnya ada, selain itu cocokkan sinonim. */
export function guessMapping(headers: string[], saved: Record<string, string>): Record<PpmField, string> {
  const out = {} as Record<PpmField, string>
  const used = new Set<string>()
  for (const f of PPM_FIELDS) {
    const s = saved[f.key]
    if (s && headers.includes(s)) { out[f.key] = s; used.add(s); continue }
    const h = headers.find((h) => !used.has(h) && (f.syn as readonly string[]).includes(norm(h)))
    out[f.key] = h ?? ''
    if (h) used.add(h)
  }
  return out
}

