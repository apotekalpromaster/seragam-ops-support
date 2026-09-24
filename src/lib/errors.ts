/**
 * Pesan error dari RPC berformat "KODE: pesan". Pesan sudah Bahasa Indonesia
 * dan ramah pengguna. Error lain (jaringan, Postgres mentah) dipetakan ke
 * pesan umum — pesan teknis tidak pernah ditampilkan apa adanya.
 */
export interface AppError {
  code: string
  title: string
  message: string
}

const TITLES: Record<string, string> = {
  AKSES_DITOLAK: 'Akses ditolak',
  VALIDASI: 'Periksa kembali isian',
  DUPLIKAT: 'Data sudah ada',
  TIDAK_DITEMUKAN: 'Data tidak ditemukan',
  PAKET_DIPAKAI: 'Paket masih dipakai',
  IMPORT_DUPLIKAT: 'File sudah pernah diimport',
  STATUS: 'Tidak bisa diproses',
  STOK_TIDAK_CUKUP: 'Stok tidak cukup',
  IMMUTABLE: 'Data terkunci',
  TIDAK_BERUBAH: 'Tidak ada perubahan',
  OPNAME_AKTIF: 'Opname masih berjalan',
  USER_TIDAK_ADA: 'Akun belum ada',
  KOSONG: 'Tidak ada yang bisa diproses',
  UPLOAD: 'Upload gagal',
  TUKAR_DITOLAK: 'Tidak bisa ditukar',
  DEMO: 'Tidak tersedia di mode demo',
  FUNGSI_TIDAK_ADA: 'Fungsi email belum dipasang',
}

export function toAppError(e: unknown): AppError {
  const raw = e instanceof Error ? e.message : String(e)
  const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(raw.trim())
  if (m && TITLES[m[1]]) return { code: m[1], title: TITLES[m[1]], message: m[2] }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return { code: 'JARINGAN', title: 'Koneksi terputus', message: 'Tidak bisa terhubung ke server. Periksa internet lalu coba lagi.' }
  }
  if (/permission denied|row-level security|JWT/i.test(raw)) {
    return { code: 'AKSES_DITOLAK', title: 'Akses ditolak', message: 'Anda tidak punya akses untuk tindakan ini. Hubungi admin Ops Support.' }
  }
  if (/invalid login credentials/i.test(raw)) {
    return { code: 'LOGIN', title: 'Login gagal', message: 'Email atau password salah.' }
  }
  if (/duplicate key|unique constraint/i.test(raw)) {
    return { code: 'DUPLIKAT', title: 'Data sudah ada', message: 'Data dengan kode yang sama sudah tersimpan.' }
  }
  if (/foreign key/i.test(raw)) {
    return { code: 'VALIDASI', title: 'Data terkait tidak ada', message: 'Ada kode yang tidak dikenal (mis. SKU, cabang, atau paket). Periksa kembali isian.' }
  }
  console.error(e)
  return { code: 'LAINNYA', title: 'Terjadi kesalahan', message: 'Permintaan tidak berhasil diproses. Coba lagi; bila berulang, hubungi tim IT dengan menyebut waktu kejadian.' }
}
