# Setup email ringkasan harian (Resend + Supabase Edge Function + Cron)

Email berisi KPI utama, semua alert "Perlu tindakan", batch berjalan, joiner 7 hari ke depan yang paketnya belum lengkap, PO lewat ETA, dan resign yang belum mengembalikan seragam. Penerima default: **operation@apotekalpro.id** (ubah di aplikasi: Master & Config → Notifikasi Email).

Prasyarat: migration `20260928000001_m5_monitoring.sql` sudah dijalankan.

## 1. Resend
1. Daftar di https://resend.com (gratis: 3.000 email/bulan, 100/hari).
2. **Domains → Add domain** → `apotekalpro.id` → tambahkan record DNS yang diminta (minta tolong tim IT/pengelola DNS). Tunggu status *Verified*.
   Tanpa domain terverifikasi, Resend hanya bisa mengirim ke email pemilik akun Resend dengan pengirim `onboarding@resend.dev`.
3. **API Keys → Create API key** (permission: *Sending access*). Simpan kuncinya — hanya tampil sekali.

## 2. Deploy Edge Function
Dari folder proyek (butuh Node.js; Supabase CLI dijalankan lewat `npx`):

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase secrets set RESEND_API_KEY=<API_KEY_RESEND> CRON_SECRET=<teks_acak_panjang> DIGEST_FROM="Seragam Ops Support <seragam@apotekalpro.id>" APP_URL=https://<domain-vercel-anda>
npx supabase functions deploy seragam-daily-digest --no-verify-jwt
```

- `<PROJECT_REF>`: Supabase → Project Settings → General → Reference ID.
- `CRON_SECRET`: buat sendiri (mis. 40 karakter acak). Hanya pemanggil yang tahu rahasia ini yang bisa memicu email terjadwal.
- `--no-verify-jwt`: fungsi memeriksa sendiri — terjadwal via `x-cron-secret`, atau admin yang sedang login (tombol **Kirim email tes**). Pengguna lain ditolak.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sudah tersedia otomatis di Edge Function; **jangan** taruh service role key di frontend/Vercel.

Uji: login sebagai admin → Master & Config → **Notifikasi Email** → **Kirim email tes sekarang**. Hasilnya tercatat di *Riwayat pengiriman*.

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

Setiap kali jalan, fungsi juga menyimpan **snapshot KPI harian** (kelengkapan seragam, SKU stock-out) yang dipakai grafik tren & Laporan → KPI bulanan.

## Masalah umum
| Gejala di Riwayat pengiriman | Penyebab / solusi |
|---|---|
| *GAGAL · Resend 403 … domain is not verified* | Domain pengirim (`DIGEST_FROM`) belum diverifikasi di Resend. |
| *GAGAL · Resend 401* | `RESEND_API_KEY` salah → `npx supabase secrets set RESEND_API_KEY=…` lalu deploy ulang. |
| *DILEWATI · Email harian dinonaktifkan* | Centang "Kirim email setiap hari" di halaman Notifikasi Email. |
| Tidak ada baris sama sekali | Cron belum dibuat, atau header `x-cron-secret` tidak cocok (fungsi menolak dengan 403). |
| Tombol tes: "Fungsi email belum dipasang" | Langkah 2 belum dijalankan. |
