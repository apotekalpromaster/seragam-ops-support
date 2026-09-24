# Dashboard Alokasi Seragam — Ops Support Apotek Alpro

Dashboard kerja staf Ops Support untuk alokasi, stok, dan pengembalian seragam.
Stok **selalu** dihitung dari transaksi (ledger immutable); data karyawan dibentuk dari import snapshot PPM;
aturan bisnis (paket per jabatan, cutoff, safety stock, dll.) adalah konfigurasi.

Stack: React + Vite + TypeScript + Tailwind · Supabase (Postgres, Auth, RLS) · deploy Vercel.

## Status milestone

| Milestone | Status |
|---|---|
| M1 — Fondasi: master & config, import PPM + diff, kartu karyawan, ledger + OPENING, stok dasar, opname | ✅ selesai |
| M2 — Distribusi: antrian, batch cutoff/ad-hoc, reserve, shortage, pick/packing list, label, BAST, ISSUE otomatis, hire mendadak | ✅ selesai |
| M3 — Stok & Pengadaan: saran order (AvgDemand, SS, ROP, MOQ), status Kritis/Perlu order/Aman, PO per vendor, terima parsial (IN), cetak PO | ✅ selesai |
| M4 — Transaksi & Retur: tukar cacat ≤14 hari, pembelian + export potong gaji, kewajiban retur (resign/PKL/batal join/no-show/mutasi), QC per asal barang, afkir, laporan | ✅ selesai |
| M5 — Monitoring: 10 KPI + laporan KPI bulanan, snapshot harian, email ringkasan harian (Resend), alert konfirmasi tertunda, akun APA per cabang untuk konfirmasi terima + BAST | ✅ selesai |

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:5173
```

Untuk mencoba **mode demo** walau `.env` sudah terisi:

```bash
npm run dev:demo     # http://localhost:5176, memakai .env.demo (koneksi Supabase dikosongkan)
```

Tanpa `.env`, aplikasi juga berjalan dalam **mode demo**: Postgres (PGlite) berjalan di browser dengan migration
yang sama persis dengan Supabase (termasuk RLS & RPC) dan data contoh. Pilih peran Admin / Staf / Viewer di layar login.
Data demo tersimpan di IndexedDB browser tersebut saja.

## Menghubungkan ke Supabase (project yang sudah ada)

Semua objek dibuat di schema terpisah **`seragam`**, jadi tidak menyentuh tabel app lain.

1. **Jalankan migration** berurutan di SQL Editor (atau `supabase db push`):
   `supabase/migrations/20260924000001_schema.sql` … `20260924000006_rls_grants.sql`, lalu `supabase/seed.sql`.
   Milestone berikutnya menambah file migration baru (mis. `20260925000001_m2_distribusi.sql`) — jalankan file baru saja,
   jangan menjalankan ulang yang lama. Migration M2 juga membuat bucket Storage privat `seragam-bast` untuk file BAST.
   M3: `20260926000001_m3_pengadaan.sql` (purchase order & perencanaan stok).
   M4: `20260927000001_m4_transaksi_retur.sql` (tukar, pembelian, retur, QC, afkir).
   M5: `20260928000001_m5_monitoring.sql` (APA per cabang, KPI, email harian). Email harian butuh setup terpisah: `docs/SETUP-email-harian.md`.
   Perbaikan code review: `20260929000001_perbaikan_review.sql` (hak akses fungsi, zona waktu WIB, retur & QC).
   Muncul error *already exists* (mis. `relation "exchange" already exists`)? Artinya file itu sudah pernah berhasil dijalankan;
   SQL Editor menjalankan satu file sebagai satu transaksi, jadi percobaan yang gagal tidak mengubah apa pun. Lanjut ke file berikutnya.
2. **Expose schema**: Settings → API → *Exposed schemas* → tambahkan `seragam`.
3. **Admin pertama**: buat user di Authentication → Add user, lalu jalankan `supabase/bootstrap_admin.sql`
   (ganti email). Pengguna berikutnya ditambahkan dari menu **Pengguna** di aplikasi.
4. Buat `.env` (lihat `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. Deploy ke Vercel — lihat bagian **Deploy** di bawah.

## Deploy (GitHub → Vercel)

1. Push repo ini ke GitHub (repo **private**). File `.env` tidak ikut ter-push (sudah di `.gitignore`).
2. Vercel → **Add New… → Project** → pilih repo → Framework otomatis **Vite** (`vercel.json` sudah mengatur build & routing).
3. Di **Environment Variables** isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` → **Deploy**.
4. Supabase → Authentication → URL Configuration → **Site URL** = domain Vercel (mis. `https://seragam-alpro.vercel.app`).
5. Setiap push ke branch `main` otomatis deploy ulang; branch lain mendapat URL preview.

Kunci yang dipakai frontend hanya **anon/publishable key**. Jangan pernah memakai `service_role` / secret key di aplikasi ini.

Akun yang login tetapi tidak terdaftar di `seragam.app_user` tidak bisa membaca data apa pun (RLS default deny).

## Prinsip keamanan & integritas

- **Tulis hanya lewat RPC** `seragam.fn_*` (security definer, cek role di awal). Tabel tidak punya policy INSERT/UPDATE/DELETE.
- **Ledger immutable**: trigger menolak UPDATE/DELETE/TRUNCATE; koreksi lewat transaksi REVERSAL.
- **Audit log** otomatis untuk semua perubahan master, config, paket, mapping, override, dan pengguna.
- View memakai `security_invoker` sehingga RLS tetap berlaku.

## Struktur

```
supabase/migrations/   schema, guard & audit, views perhitungan (PRD §6), RPC, RLS
supabase/seed.sql      config default, 4 item → 54 SKU, 5 paket awal, size curve
supabase/tests/        uji acceptance criteria di PGlite (npm test)
src/lib/               akses data (Supabase / demo), auth, format, label, xlsx, template
src/components/        AppShell, DataTable, dialog, komponen UI bersama
src/features/          halaman per modul
templates/             template XLSX migrasi data (npm run templates)
docs/                  SOP singkat & laporan audit UX
```

## Pengujian

```bash
npm test             # acceptance criteria M1 + performa 3.000 karyawan (PGlite)
npx tsc -b           # typecheck
npm run build
```

Catatan: PRD §4.1a menyebut 55 SKU, tetapi Kaos Polo S–3XL = 6 ukuran sehingga totalnya **54 SKU**.
