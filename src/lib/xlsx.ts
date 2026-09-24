import * as XLSX from 'xlsx'

/** Baca sheet pertama (atau sheet bernama) menjadi array objek per baris header. */
export async function readSheet(file: File, sheetName?: string) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true, dense: true })
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0]
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true })
  const headers = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map((h) => String(h ?? '').trim())
  return { rows: rows.map((r) => normalizeRow(r)), headers: headers.filter(Boolean), sheetNames: wb.SheetNames, sheet: name, hash: await sha256(buf) }
}

function normalizeRow(r: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) out[k.trim()] = cellToString(v)
  return out
}

/** Tanggal Excel → YYYY-MM-DD; angka → string tanpa format. */
export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    // SheetJS membuat Date di zona lokal; ambil komponen lokal
    const d = new Date(v.getTime() + 12 * 3600 * 1000) // hindari geser hari karena DST/offset detik
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  // dd/mm/yyyy atau dd-mm-yyyy (format umum Indonesia)
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s
}

export async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

export function exportXlsx<T>(fileName: string, rows: T[], columns: ExportColumn<T>[], sheet = 'Data') {
  const data = [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r) ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, Math.min(40, c.header.length + 4)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

export interface TemplateSpec {
  file: string
  sheet: string
  columns: { key: string; header: string; wajib: boolean; contoh: string; keterangan: string }[]
  petunjuk: string[]
}

/** Template import: sheet data (header + 1 contoh) dan sheet Petunjuk. */
export function downloadTemplate(t: TemplateSpec) {
  const wb = XLSX.utils.book_new()
  const data = XLSX.utils.aoa_to_sheet([t.columns.map((c) => c.key), t.columns.map((c) => c.contoh)])
  data['!cols'] = t.columns.map((c) => ({ wch: Math.max(14, c.key.length + 4) }))
  XLSX.utils.book_append_sheet(wb, data, t.sheet)
  const help = XLSX.utils.aoa_to_sheet([
    ['PETUNJUK'], ...t.petunjuk.map((p) => [p]), [],
    ['Kolom', 'Judul', 'Wajib', 'Contoh', 'Keterangan'],
    ...t.columns.map((c) => [c.key, c.header, c.wajib ? 'Ya' : 'Tidak', c.contoh, c.keterangan]),
  ])
  help['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 8 }, { wch: 18 }, { wch: 70 }]
  XLSX.utils.book_append_sheet(wb, help, 'Petunjuk')
  XLSX.writeFile(wb, t.file)
}
