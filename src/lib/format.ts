const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  // "YYYY-MM-DD" diperlakukan sebagai tanggal lokal (bukan UTC)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 23 Sep 2026 */
export function fmtDate(v: string | Date | null | undefined, fallback = '—') {
  const d = toDate(v)
  return d ? `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}` : fallback
}

/** 23 Sep 2026, 08.55 */
export function fmtDateTime(v: string | Date | null | undefined, fallback = '—') {
  const d = toDate(v)
  if (!d) return fallback
  return `${fmtDate(d)}, ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`
}

/** Rabu, 23 September 2026 */
export function fmtDateLong(v: string | Date | null | undefined) {
  const d = toDate(v)
  return d ? `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}` : '—'
}

/** September 2026 */
export function fmtMonth(v: string | Date | null | undefined) {
  const d = toDate(v)
  return d ? `${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}` : '—'
}
export function fmtMonthShort(v: string | Date | null | undefined) {
  const d = toDate(v)
  return d ? `${BULAN[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : '—'
}

export function fmtNum(n: number | null | undefined, fallback = '—') {
  return n === null || n === undefined || Number.isNaN(n) ? fallback : new Intl.NumberFormat('id-ID').format(n)
}

export function fmtRp(n: number | null | undefined, fallback = '—') {
  return n === null || n === undefined ? fallback : `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(n))}`
}

export function fmtPct(n: number | null | undefined, digits = 1) {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(digits).replace('.', ',')}%`
}

/** Tanggal hari ini menurut WIB (sama dengan seragam.today() di server), apa pun zona waktu perangkat. */
export function isoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysBetween(a: Date, b: Date) {
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  return Math.round(ms / 86400000)
}
