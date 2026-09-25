# Setup email ringkasan harian (Gmail + Supabase Edge Function + Cron)

Email berisi KPI utama, semua alert "Perlu tindakan", batch berjalan, joiner 7 hari ke depan yang paketnya belum lengkap, PO lewat ETA, dan resign yang belum mengembalikan seragam. Penerima default: **operation@apotekalpro.id** (ubah di aplikasi: Master & Config → Notifikasi Email).

Cara kerja: **Supabase Cron** memanggil Edge Function `seragam-daily-digest` setiap pagi. Fungsi itu menyusun isi email lalu mengirimnya lewat **Gmail (SMTP)** memakai akun Gmail gratis. Tidak perlu Google Workspace, domain, atau layanan email berbayar.

Prasyarat: migration `20260928000001_m5_monitoring.sql` sudah dijalankan.

## 1. Akun Gmail pengirim
1. Siapkan akun Gmail khusus, mis. `seragam.opsalpro@gmail.com`. Jangan pakai akun pribadi: password aplikasinya akan disimpan di Supabase, dan email keluar tercatat di *Terkirim* akun ini.
2. Aktifkan **Verifikasi 2 Langkah**: https://myaccount.google.com/signinoptions/twosv. App Password hanya tersedia bila ini aktif.
3. Buat **App Password** di https://myaccount.google.com/apppasswords (nama bebas, mis. `Seragam Dashboard`). Salin 16 hurufnya; hanya tampil sekali.
   - Ini **bukan** password login Gmail. Bisa dicabut kapan saja dari halaman yang sama tanpa mengganti password akun.
   - Password login Gmail yang biasa akan ditolak Google untuk SMTP.

Batas Gmail gratis ±500 penerima/hari, jauh di atas kebutuhan (1 email/hari).

## 2. Deploy Edge Function
Dari folder proyek (butuh Node.js; Supabase CLI dijalankan lewat `npx`):

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase secrets set GMAIL_USER=seragam.opsalpro@gmail.com GMAIL_APP_PASSWORD="<16 huruf App Password>" CRON_SECRET=<teks_acak_panjang> APP_URL=https://<domain-vercel-anda>
npx supabase functions deploy seragam-daily-digest --no-verify-jwt
```

- `<PROJECT_REF>`: Supabase → Project Settings → General → Reference ID.
- `GMAIL_APP_PASSWORD`: boleh dengan atau tanpa spasi (spasi dibuang otomatis).
- Opsional: `DIGEST_FROM_NAME="Ops Support Alpro"` untuk nama pengirim (default *Seragam Ops Support*). Alamat pengirim selalu `GMAIL_USER`, karena Gmail tidak mengizinkan alamat lain.
- `CRON_SECRET`: buat sendiri (mis. 40 karakter acak). Hanya pemanggil yang tahu rahasia ini yang bisa memicu email terjadwal.
- `--no-verify-jwt`: fungsi memeriksa sendiri — terjadwal via `x-cron-secret`, atau admin yang sedang login (tombol **Kirim email tes**). Pengguna lain ditolak.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sudah tersedia otomatis di Edge Function; **jangan** taruh service role key atau App Password di frontend/Vercel.
- Sebelumnya sempat memakai Resend? Hapus secret lamanya: `npx supabase secrets unset RESEND_API_KEY DIGEST_FROM`.

Uji: login sebagai admin → Master & Config → **Notifikasi Email** → **Kirim email tes sekarang**. Hasilnya tercatat di *Riwayat pengiriman*. Email pertama dari alamat Gmail baru kadang masuk folder **Spam** di penerima; tandai *Bukan spam* sekali, atau minta IT memasukkan alamat pengirim ke daftar aman.

## 3. Jadwal harian (07.00 WIB = 00.00 UTC)
Supabase → **Integrations → Cron** (aktifkan bila belum) → **Create job**:
- Name: `seragam-daily-digest`
- Schedule: `0 0 * * *`
- Type: **Supabase Edge Function** → pilih `seragam-daily-digest`, method POST
- HTTP headers: tambahkan `x-cron-secret` = nilai `CRON_SECRET` di atas
- Body: `{}`

Alternatif lewat SQL Editor (ekstensi `pg_cron` & `pg_net` aktif):
```sql
select cron.schedule('seragam-daily-digest', '0 0 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/seragam-daily-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb)
$$);
```

Setiap kali jalan, fungsi juga menyimpan **snapshot KPI harian** (kelengkapan seragam, SKU stock-out) yang dipakai grafik tren & Laporan → KPI bulanan. Karena itu jadwal tetap di Supabase Cron: snapshot perlu jalan setiap hari, dan tombol **Kirim email tes** di aplikasi memakai fungsi yang sama.

## Masalah umum
| Gejala di Riwayat pengiriman | Penyebab / solusi |
|---|---|
| *GAGAL · Gmail menolak login (535)* | `GMAIL_USER` salah, App Password salah/dicabut, atau yang diisi password login biasa. Buat App Password baru → `npx supabase secrets set GMAIL_APP_PASSWORD=…`. |
| *GAGAL · Secret GMAIL_USER / GMAIL_APP_PASSWORD belum diisi* | Langkah 2 (`secrets set`) belum dijalankan. |
| *GAGAL · Gmail ETIMEDOUT / ESOCKET / ECONNECTION* | Gangguan jaringan sesaat; kirim tes lagi. Bila terus terjadi, cek status Gmail. |
| *GAGAL · Gmail … 550 / 421 Daily sending quota exceeded* | Batas harian Gmail tercapai (akun dipakai kirim email lain). Pakai akun khusus. |
| *TERKIRIM* dengan catatan merah *Snapshot KPI gagal: …* | Email tetap terkirim, tetapi snapshot KPI hari itu tidak tersimpan (grafik tren bolong sehari). Laporkan pesannya ke tim IT. |
| Terkirim tapi tidak sampai | Cek folder Spam penerima; lihat juga folder *Terkirim* di akun Gmail pengirim. |
| *DILEWATI · Email harian dinonaktifkan* | Centang "Kirim email setiap hari" di halaman Notifikasi Email. |
| Tidak ada baris sama sekali | Cron belum dibuat, atau header `x-cron-secret` tidak cocok (fungsi menolak dengan 403). |
| Tombol tes: "Fungsi email belum dipasang" | Langkah 2 belum dijalankan. |
| Google mengirim peringatan keamanan ke akun pengirim | Normal saat App Password pertama dipakai dari server Supabase. |
