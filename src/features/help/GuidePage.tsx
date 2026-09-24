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
        <li><b>Kebutuhan antrian</b> = hak karyawan yang belum masuk batch untuk SKU tersebut. <b>Dalam pemesanan</b> = sisa PO yang sudah dikirim ke vendor.</li>
      </ul>
    ),
  },
  {
    id: 'pengadaan', title: 'Pengadaan: saran order & purchase order', body: (
      <div className="space-y-3">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Buka <Link to="/pengadaan" className="font-semibold text-brand-600">Pengadaan</Link>. Mulai dari SKU <b>Kritis</b>, lalu <b>Perlu order</b>.</li>
          <li>Centang SKU (atau klik <b>Buat PO dari saran</b>). Sistem membuat satu PO per vendor dengan qty = saran order; ubah qty bila perlu, lalu simpan sebagai draft.</li>
          <li>Periksa PO draft → <b>Cetak PO</b> → kirim ke vendor → klik <b>Kirim ke vendor</b>. Sejak itu qty dihitung <i>dalam pemesanan</i> dan tidak disarankan lagi.</li>
          <li>Saat barang datang, hitung fisik lalu <b>Terima barang</b> sesuai surat jalan. Boleh bertahap; stok Layak langsung bertambah.</li>
          <li>Vendor tidak sanggup mengirim sisa? <b>Tutup PO</b> dengan alasan, supaya sisa tidak lagi dianggap akan datang.</li>
        </ol>
        <div className="rounded-xl bg-slate-50 p-3 font-mono text-xs leading-6 text-slate-700">
          Rata-rata/bln = keluar (kirim + beli + tukar) dalam jendela histori ÷ jumlah bulan<br />
          Safety stock (SS) = rata-rata × parameter SS (bulan)<br />
          ROP = rata-rata × lead time/30 + SS<br />
          Saran order = rata-rata × cakupan order + SS + kebutuhan antrian − available − dalam pemesanan, dibulatkan ke pcs terdekat, lalu ke atas ke kelipatan MOQ
        </div>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Kritis</b>: available kurang dari kebutuhan antrian, atau ≤ SS. <b>Perlu order</b>: available + dalam pemesanan ≤ ROP. Selain itu <b>Aman</b>. SS/ROP di bawah ½ pcs diabaikan supaya ukuran yang sangat jarang dipakai tidak selalu merah.</li>
          <li>SKU tanpa histori memakai perkiraan: rencana hire/bulan × rata-rata qty item per karyawan × size curve (bertanda "perkiraan").</li>
          <li>Kebutuhan cabang baru ikut terhitung setelah karyawannya masuk data PPM (sebagai joiner).</li>
          <li>Parameter (SS, cakupan order, jendela histori, rencana hire, lead time default) diatur admin di Parameter; lead time & MOQ per SKU di Harga & Vendor.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'transaksi', title: 'Tukar barang cacat & pembelian', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li><b>Tukar</b> hanya untuk <b>cacat produksi</b> atau <b>deviasi spek vendor</b>, paling lambat sesuai batas hari (default 14) sejak barang dikirim, dan wajib nama atasan yang menyetujui. Barang cacat masuk <i>karantina</i>, pengganti keluar dari stok layak.</li>
        <li>Salah pilih ukuran atau lewat batas → sistem menolak dan menawarkan <b>Proses sebagai pembelian</b>.</li>
        <li><b>Pembelian</b>: harga otomatis dari price list, periode potong gaji wajib. Barang beli tidak dihitung pemenuhan hak dan tidak wajib dikembalikan saat resign.</li>
        <li>Salah input pembelian → admin klik <b>Batalkan</b>; barang kembali ke stok dan hilang dari export potong gaji.</li>
        <li>Tukar/beli juga bisa langsung dari kartu karyawan.</li>
      </ul>
    ),
  },
  {
    id: 'retur', title: 'Resign & pengembalian', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Daftar <b>wajib kembali</b> terbentuk otomatis dari data PPM: resign, PKL selesai, batal join, no-show (tidak hadir sampai masa tunggu), dan mutasi/promosi yang membuat item tidak lagi menjadi hak (mis. Blazer TTK saat jadi Apoteker).</li>
        <li>Yang wajib kembali = item alokasi netto yang pernah diterima. Barang hasil beli tidak termasuk.</li>
        <li>Barang tiba di gudang → <b>Catat pengembalian</b> (boleh sebagian). Barang masuk karantina sampai di-QC.</li>
        <li><b>Permintaan retur ke cabang</b>: paket joiner batal join/no-show yang masih ditahan APA. Export daftar dan kirim ke cabang.</li>
        <li>Barang yang tidak mungkin kembali: admin klik <b>Hapuskan…</b> dengan alasan (status Dihapuskan). Nilai outstanding hanya informasi; aturan tagih masih TBD.</li>
        <li>Tab <b>Akan resign</b>: rencana resign dari PPM, supaya APA mengambil seragam di hari terakhir.</li>
      </ul>
    ),
  },
  {
    id: 'qc', title: 'QC & afkir', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Barang karantina tidak bisa dikirim. QC per piece: <b>A</b> layak pakai, <b>B</b> cacat minor → Cadangan, <b>C</b> rusak → Afkir.</li>
        <li>Grade A barang <b>bekas pakai</b> masuk Cadangan selama parameter "Retur grade A boleh untuk joiner baru" = Tidak. Barang batal join/no-show (belum dipakai) grade A langsung Layak.</li>
        <li>Centang beberapa baris → <b>Semua grade A</b> untuk QC cepat.</li>
        <li>Afkir: musnahkan logo, lalu <b>Catat pemusnahan</b> (tanggal, cara, saksi).</li>
        <li>Salah grade → admin koreksi di Stok → Riwayat transaksi (kedua baris QC dibalik bersama).</li>
      </ul>
    ),
  },
  {
    id: 'laporan', title: 'Laporan & export', body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li><b>Potong gaji</b>: pilih periode → Export XLSX → kirim ke Payroll. Pembelian yang dibatalkan tidak ikut.</li>
        <li><b>Outstanding resign</b>: sisa seragam karyawan resign/PKL beserta nilai (harga price list).</li>
        <li><b>Rekap tukar per SKU</b>: tingkat tukar 12 bulan per SKU & vendor; ≥ 3% ditandai merah.</li>
        <li>Semua tabel lain di aplikasi juga bisa di-export lewat tombol Export XLSX.</li>
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
