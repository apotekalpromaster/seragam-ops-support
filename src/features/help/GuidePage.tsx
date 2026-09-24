import clsx from 'clsx'
import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { Card } from '../../components/ui'

/** Panduan kontekstual (heuristik #10). Anchor id dipakai tombol "?" di header tiap halaman. */
const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'import', title: 'Cara import data PPM (setiap bulan, paling lambat tanggal cutoff)', body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Minta file snapshot dari PPM. Isinya: karyawan <b>AKTIF</b>, joiner <b>OFFERING</b> (bulan ini s/d 1 bulan ke depan), <b>RESIGN</b> (termasuk rencana resign), dan <b>BATAL_JOIN</b>.</li>
        <li>Buka <Link to="/import" className="font-semibold text-brand-600">Import Data PPM</Link> → pilih periode → tarik file ke kotak upload.</li>
        <li>Cocokkan kolom file dengan field sistem. Pencocokan disimpan untuk bulan berikutnya.</li>
        <li>Periksa hasil: tab <b>Error</b> (baris dilewati), <b>Peringatan</b> (masuk tapi perlu tindakan: jabatan belum dimapping, ukuran kosong/tidak tersedia), dan daftar perubahan (baru, resign, mutasi).</li>
        <li>Tekan <b>Simpan</b>. Belum ada data yang berubah sebelum langkah ini. File yang sama tidak bisa disimpan dua kali.</li>
        <li>Tindak lanjuti peringatan: petakan jabatan baru di <Link to="/master/jabatan" className="font-semibold text-brand-600">Mapping Jabatan</Link>, tagih ukuran kosong ke PPM.</li>
      </ol>
    ),
  },
  {
    id: 'opname', title: 'Cara stock opname', body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Buka <Link to="/opname" className="font-semibold text-brand-600">Stock Opname</Link> → <b>Buat lembar opname</b>. Opname pertama membentuk saldo awal.</li>
        <li>Hitung fisik per SKU. Isi langsung di layar (tersimpan otomatis) atau <b>Unduh lembar hitung</b>, isi di Excel, lalu <b>Upload hasil hitung</b>.</li>
        <li>Untuk opname berkala, setiap selisih wajib diberi alasan.</li>
        <li><b>Ajukan untuk approval</b>. Admin memeriksa, lalu <b>Setujui</b> — sistem otomatis membuat transaksi penyesuaian. Admin juga bisa mengembalikan ke draft.</li>
      </ol>
    ),
  },
  {
    id: 'batch', title: 'Cara membuat & mengirim batch distribusi', body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Setelah import PPM, buka <Link to="/antrian" className="font-semibold text-brand-600">Antrian Alokasi</Link> → <b>Buat batch</b>. Pilih <b>Reguler</b> (sekali per periode cutoff), <b>Ad-hoc</b> (susulan / hire mendadak), atau <b>Cabang baru</b>.</li>
        <li>Periksa preview: jumlah baris, pcs, cabang, dan <b>kekurangan stok</b>. Baris yang stoknya kurang tidak masuk batch dan tetap di antrian.</li>
        <li>Setelah dibuat, stok untuk batch langsung <b>dipesan (reserved)</b> sehingga tidak dipakai batch lain.</li>
        <li><b>Mulai picking</b> → cetak <b>Pick list</b> dan ambil barang per SKU. <b>Selesai packing</b> → kemas per karyawan, tempel <b>Label nama</b>, sertakan <b>Packing list</b> dan <b>Form BAST</b> per cabang.</li>
        <li><b>Tandai sudah dikirim</b> (ketik KIRIM) pada tanggal barang dikirim. Sistem otomatis mencatat transaksi "Kirim ke karyawan", stok berkurang, dan hak karyawan terpenuhi.</li>
        <li>Saat BAST bertanda tangan kembali, buka tab <b>Per cabang</b> → <b>Konfirmasi terima</b> + unggah foto/scan BAST. Batch otomatis <b>Selesai</b> bila semua cabang terkonfirmasi.</li>
        <li>Paket joiner yang tiba sebelum tanggal join berstatus <b>Ditahan APA</b> dan diserahkan pada hari join.</li>
      </ol>
    ),
  },
  {
    id: 'antrian', title: 'Antrian alokasi', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li><b>Siap dikirim</b>: hak yang belum dikirim dan ukurannya valid. Centang beberapa karyawan untuk membuat batch ad-hoc khusus mereka.</li>
        <li><b>Menunggu ukuran</b>: ukuran kosong — tagih ke PPM (Export XLSX) sebelum cutoff. <b>Ukuran tidak tersedia</b>: perlu keputusan manual lewat kartu karyawan.</li>
        <li><b>Hire mendadak</b>: joiner yang tidak ada di data PPM. Input lewat tombol <b>Input hire mendadak</b>; dikirim lewat batch ad-hoc mingguan.</li>
        <li><b>Aging</b> = hari sejak join. Merah bila lebih dari 90 hari.</li>
      </ul>
    ),
  },
  {
    id: 'beranda', title: 'Membaca Beranda', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li><b>Kelengkapan seragam</b>: % karyawan aktif yang sudah menerima semua haknya. Target ≥ 98%.</li>
        <li><b>SKU stock-out</b>: SKU dengan Available ≤ 0. Target 0.</li>
        <li><b>Kepatuhan data PPM</b>: bulan di mana import disimpan paling lambat tanggal cutoff. Kotak hijau = tepat waktu, kuning = terlambat, abu = tidak ada import.</li>
        <li><b>Perlu tindakan</b>: diurutkan dari paling mendesak (merah) ke informasi (biru). Klik untuk langsung ke layar penyelesaiannya.</li>
      </ul>
    ),
  },
  {
    id: 'karyawan', title: 'Karyawan & kartu karyawan', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Data karyawan hanya berubah lewat import PPM, kecuali ukuran yang bisa dikoreksi manual (dengan alasan) untuk kasus ukuran tidak tersedia.</li>
        <li><b>Belum dikirim</b> = hak paket − yang sudah diterima. Pembelian karyawan tidak mengurangi hak.</li>
        <li>Tekan <kbd className="rounded border px-1">/</kbd> untuk langsung ke kotak pencarian di tabel mana pun.</li>
      </ul>
    ),
  },
  {
    id: 'stok', title: 'Stok', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Stok = jumlah semua transaksi. Tidak ada angka stok yang bisa diketik; koreksi selalu lewat opname atau transaksi koreksi (reversal) oleh admin.</li>
        <li><b>Available</b> = Layak − Reserved. <b>Karantina</b> = barang kembali yang belum di-QC, tidak bisa dikirim.</li>
        <li><b>Kebutuhan antrian</b> = total yang harus dikirim ke karyawan untuk SKU tersebut.</li>
      </ul>
    ),
  },
  {
    id: 'paket', title: 'Paket alokasi', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Mengubah qty membuat <b>versi baru</b>. Pilih cakupan: <b>Hanya karyawan baru</b> (rencana join ≥ tanggal berlaku) atau <b>Semua karyawan aktif</b>.</li>
        <li>Lihat <b>preview dampak</b> sebelum menyimpan: jumlah karyawan terdampak, tambahan outstanding per SKU, dan yang menjadi over-issued.</li>
        <li>Over-issued tidak memicu retur otomatis — hanya ditandai.</li>
        <li>Paket yang pernah dipakai tidak bisa dihapus, hanya dinonaktifkan setelah jabatannya dipindah.</li>
      </ul>
    ),
  },
  { id: 'jabatan', title: 'Mapping jabatan', body: <p>Satu jabatan = satu paket. Centang beberapa jabatan untuk menetapkan paket sekaligus. Jabatan baru dari PPM otomatis muncul di filter “Belum dimapping”.</p> },
  { id: 'override', title: 'Override karyawan', body: <p>Untuk kebutuhan khusus satu karyawan. Override mengalahkan mapping jabatan dan wajib beralasan.</p> },
  { id: 'item', title: 'Item & SKU', body: <p>Menambah item baru (mis. rompi) otomatis membuat SKU untuk setiap kombinasi gender × ukuran, dan item muncul di Master Paket dengan qty 0. SKU tidak pernah dihapus, hanya dinonaktifkan.</p> },
  { id: 'harga', title: 'Harga & vendor', body: <p>Harga baru disimpan dengan tanggal berlaku; harga lama tetap sebagai riwayat. Harga saat transaksi tercatat di setiap transaksi.</p> },
  { id: 'cabang', title: 'Cabang', body: <p>Kode cabang harus sama dengan data PPM. Tambahkan cabang baru sebelum import supaya karyawannya tidak ditolak.</p> },
  { id: 'ukuran', title: 'Size curve & size chart', body: <p>Size curve (proporsi ukuran, total 100%) dipakai untuk forecast SKU yang belum punya histori. Size chart ditampilkan saat mengubah ukuran karyawan.</p> },
  { id: 'parameter', title: 'Parameter', body: <p>Tanggal cutoff, deadline kirim, masa tunggu no-show, batas tukar, safety stock, dan lainnya. Setiap perubahan tercatat di audit log.</p> },
  { id: 'pengguna', title: 'Pengguna & role', body: <p><b>Admin</b>: semua fitur. <b>Staf</b>: transaksi & opname, tidak bisa ubah master/config. <b>Viewer</b>: lihat & export.</p> },
  { id: 'migrasi', title: 'Migrasi data awal', body: <p>Ikuti urutan di menu <Link to="/migrasi" className="font-semibold text-brand-600">Migrasi Data Awal</Link>. Setiap template punya sheet Petunjuk.</p> },
  { id: 'audit', title: 'Audit log', body: <p>Catatan permanen semua perubahan master & config: siapa, kapan, sebelum dan sesudah. Tidak bisa diubah atau dihapus.</p> },
]

export default function GuidePage() {
  const { hash } = useLocation()
  const target = hash.slice(1)
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [target])
  return (
    <Page title="Panduan" subtitle="SOP singkat & penjelasan istilah">
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="hidden lg:block" aria-label="Daftar isi panduan">
          <ul className="sticky top-4 space-y-1 text-sm">
            {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} className={clsx('block rounded-lg px-3 py-1.5 hover:bg-slate-100', target === s.id && 'bg-brand-50 font-semibold text-brand-700')}>{s.title.split(' (')[0]}</a></li>)}
          </ul>
        </nav>
        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <Card title={s.title} className={clsx(target === s.id && 'ring-2 ring-brand-300')}>
                <div className="text-sm leading-relaxed text-slate-700">{s.body}</div>
              </Card>
            </section>
          ))}
        </div>
      </div>
    </Page>
  )
}
