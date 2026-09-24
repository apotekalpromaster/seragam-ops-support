// Menulis semua template import ke folder templates/ (untuk serah terima & distribusi ke PPM).
// Jalankan: npm run templates
import * as fs from 'node:fs'
import * as XLSX from 'xlsx'
import { ALL_TEMPLATES } from '../src/lib/templates'

XLSX.set_fs(fs)

for (const t of ALL_TEMPLATES) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t.columns.map((c) => c.key), t.columns.map((c) => c.contoh)]), t.sheet)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['PETUNJUK'], ...t.petunjuk.map((p) => [p]), [],
    ['Kolom', 'Judul', 'Wajib', 'Contoh', 'Keterangan'],
    ...t.columns.map((c) => [c.key, c.header, c.wajib ? 'Ya' : 'Tidak', c.contoh, c.keterangan]),
  ]), 'Petunjuk')
  XLSX.writeFile(wb, `templates/${t.file}`)
  console.log(`templates/${t.file}`)
}
