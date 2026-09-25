# CLAUDE.md — Dashboard Alokasi Seragam (Ops Support Apotek Alpro)

Dashboard kerja staf Ops Support: alokasi, stok, distribusi, dan retur seragam. UI Bahasa Indonesia; kode & istilah teknis boleh Inggris.
PRD: `C:\Users\ALPNB092\Downloads\PRD_Dashboard_Seragam_OpsSupport.md` (rujuk § nomor PRD di komentar/commit).

## Status milestone
- ✅ M1 Fondasi · ✅ M2 Distribusi · ✅ M3 Stok & Pengadaan (semua migration sudah dijalankan user) · ✅ M4 Transaksi & Retur (`20260927000001_m4_transaksi_retur.sql`)
- ✅ M5 Monitoring (`20260928000001_m5_monitoring.sql`): email harian ke `operation@apotekalpro.id` via **Gmail SMTP** (akun Gmail gratis + App Password, port 465 karena Edge Function memblokir 25/587; secrets `GMAIL_USER`, `GMAIL_APP_PASSWORD`; Edge Function `supabase/functions/seragam-daily-digest`, template bersama `supabase/functions/_shared/digest.ts` juga dipakai pratinjau di app; setup `docs/SETUP-email-harian.md`); `kpi_daily` (snapshot), `v_kpi_monthly` + `src/lib/kpi.ts` (10 KPI); **role `apa`** terikat `app_user.kode_cabang`, `is_app_user()` mengecualikan apa → APA hanya lewat RPC `fn_apa_home` / `fn_batch_receive` (wajib BAST), UI `src/features/apa/ApaApp.tsx`, link `/apa?batch=ID`. Batas tukar dari **tanggal diterima cabang** (fallback tanggal kirim). Nilai outstanding resign = harga price list. `_is_service()` harus `coalesce(..., false)` (NULL pernah membuat cek role terlewati).
- Semua milestone PRD (M1–M5) selesai + perbaikan code review (`20260929000001_perbaikan_review.sql`). Pekerjaan berikutnya = UAT & perbaikan dari pengguna.
- Setiap milestone ditutup dengan audit UX (skill `ux-heuristics-audit`, lulus bila tidak ada skor 3–4) → `docs/UX-audit-Mx.md`.

## Stack & perintah
React 19 + Vite + TS + Tailwind v4 · TanStack Query & Table **v8** (jangan v9) · Supabase (schema `seragam`, Auth email+password, RLS, Storage bucket `seragam-bast`) · Vercel (`vercel.json` SPA rewrite).
```bash
npm run dev        # memakai .env (Supabase ASLI milik user — jangan tulis data uji ke sana)
npm run dev:demo   # port 5176, .env.demo → mode demo PGlite di browser (pakai ini untuk uji UI)
npm test           # vitest: PGlite menjalankan semua migration + seed (supabase/tests/*.test.ts)
npx tsc -b && npm run build
npm run templates  # tulis template XLSX ke templates/
```
Port 5175 dipakai proyek lain user (Antigravity) — jangan diganggu.

## Arsitektur (penting)
- **Tulis hanya lewat RPC** `seragam.fn_*(p jsonb) returns jsonb`, security definer, `perform seragam.require_role(...)` di awal. Tabel tidak punya policy INSERT/UPDATE/DELETE. Error: `raise exception 'KODE: pesan Indonesia'` (kode dipetakan di `src/lib/errors.ts`).
- **Ledger immutable** (trigger tolak UPDATE/DELETE/TRUNCATE). Tulis ledger hanya via `seragam._ledger_insert(...)` (cek stok negatif, param `p_batch`). Koreksi = REVERSAL. Stok = SUM ledger (`v_stock`, `v_stock_sku`); tidak ada angka stok yang disimpan.
- **Perhitungan PRD §6 ada di view SQL** (security_invoker): `v_employee_package` → `v_entitlement` → `v_issued` → `v_employee_item` → `v_outstanding` → `v_queue` (dikurangi batch terbuka) ; `v_reserved` dari batch DRAFT/PICKING/PACKED.
- **Migration baru = file baru** `supabase/migrations/YYYYMMDD00000N_*.sql`. Jangan ubah migration yang sudah dijalankan user (M1 `20260924…`, M2 `20260925000001`, M3 `20260926000001`, M4 `20260927000001` setelah user menjalankannya). Akhiri dengan RLS + `grant select on all tables … to authenticated` untuk objek baru, lalu **`select seragam._apply_hardening();`** (wajib, baris terakhir): mencabut EXECUTE dari PUBLIC (default PostgreSQL — `revoke … from authenticated` saja TIDAK cukup), memberi authenticated hanya `fn_*` + helper view/RLS, dan memasang `SET timezone = Asia/Jakarta` pada semua fungsi (`create or replace` menghapusnya). Jangan lagi `grant execute on all functions`. Di view pakai `seragam.today()`, bukan `current_date` (DB UTC, pengguna WIB). Test `supabase/tests/review.test.ts` menjaga kedua aturan ini.
- **Performa**: filter pada view turunan `v_outstanding` bisa didorong optimizer → O(n²). Pasang pagar `from (select * from seragam.v_outstanding offset 0) o`, dan CTE `as materialized` di view agregat (lihat `v_alert`, `v_kpi_current`). Test `perf.test.ts` dikalibrasi relatif ke kecepatan mesin (batas 40× unit).
- **Frontend data layer**: `src/lib/db.ts` (`Db.select(view, {filters, order, limit, columns})`, `Db.rpc`, `uploadFile/fileUrl`), implementasi Supabase & demo (`src/lib/demo/demoDb.ts`, PGlite di Web Worker, satu inisialisasi bersama + penanda `demo_store.ready`). Hooks: `useView`, `useRpc` (toast sukses/error, invalidate semua query), `useRpcQuery` di `src/lib/api.tsx`.
- Data demo: `src/lib/demo/demoData.ts` (deterministik; ubah migration/seed/demoData → DB demo otomatis dibuat ulang).
- **Pengadaan (M3)**: `v_sku_planning` (per SKU: stok, on_order, qty_po_draft, pipeline, avg/SS/ROP, suggested_order, status). Status PO SENT/PARTIAL/RECEIVED **dihitung** di `v_po` dari ledger IN (± REVERSAL); tabel hanya menyimpan `fase` DRAFT/DIKIRIM/DIBATALKAN/DITUTUP. `_ledger_insert` punya `p_po`, `p_receipt`. `v_alert` memakai `v_sku_planning` → jaga agar planning tidak memanggil `v_queue`/`v_outstanding` (pipeline dihitung dari CTE `ent`).
- **Transaksi & retur (M4)**: `exchange` (EXC_IN +KARANTINA & EXC_OUT −LAYAK, `pair_id`), `sale` (SALE, `periode_potong`), `return_receipt` (RET +KARANTINA), `return_writeoff`. Kewajiban retur = view `v_return_leaver` (murah, dipakai alert) + `v_return_obligation` (termasuk kelebihan hak/mutasi dari `v_employee_item`). QC per lot: `v_karantina_lot` (lot = baris masuk KARANTINA), `fn_qc` menulis QC_MOVE dua baris dengan `lot_id` & `pair_id`. `fn_ledger_reverse` membalik pasangan dua-baris dan menolak lot yang sudah di-QC. `_ledger_insert` kini 20 parameter (p_sale, p_exchange, p_return, p_lot, p_pair).
- Halaman di `App.tsx` dimuat lazy (`React.lazy`) dan SheetJS di-`import()` saat export/import; isi halaman dibungkus `ErrorBoundary` (reset per path). Beranda menampilkan kartu "Persiapan sebelum dipakai" selama data inti (`features/migrasi/setup.ts`) belum lengkap.
- `useRpc` tidak menunggu refetch (invalidate di latar) supaya dialog cepat tertutup; `Modal` tidak tertutup oleh klik di luar.

## Konvensi UI (konsisten dgn app Alpro: Room Booking HQ, Lapor Sales, Short ED)
- Token tema di `src/index.css` (`brand-*` oranye, font Plus Jakarta Sans). Gunakan `cn()` dari `components/ui.tsx` (tailwind-merge).
- Halaman: `<Page title subtitle help="anchor-panduan" actions=…>` dari `components/AppShell.tsx`; tambah menu di `useNav()`; route di `src/App.tsx`; bagian panduan di `features/help/GuidePage.tsx`.
- Komponen bersama: `DataTable` (search `/`, export XLSX, bulk select), `Card`, `Chip`, `Callout`, `Field`, `Tabs`, `Stepper`, `Modal`, `Drawer`, `ConfirmDialog` (aksi tak terbalik → `irreversible` + `typeToConfirm`), `InfoTip/Term` untuk istilah teknis.
- Label kode → Indonesia di `src/lib/labels.ts`; format tanggal/Rupiah di `src/lib/format.ts`. Jangan tampilkan kode teknis mentah ke user.
- Role: `admin` (semua), `staf` (transaksi & opname, bukan master/config), `viewer` (baca + export). Cek via `usePerm()`; tetap ditegakkan di RPC.
- NIK tidak boleh masuk URL; cache query dibersihkan saat login/logout.

## Catatan data & keputusan
- 54 SKU (PRD bilang 55, tapi Polo S–3XL = 6 ukuran). Ukuran karyawan: `size_kemeja/polo/blazer` + `size_lain` jsonb (item.size_group).
- Gender import: Pria/Wanita/L/P — bila file berisi "L", "P" = Perempuan.
- Skala: ±800 karyawan aktif, ±50 hire/bulan (config). Notifikasi M5 = email + alert in-app.
- Repo: github.com/apotekalpromaster/seragam-ops-support (disarankan private). `.env` jangan pernah di-commit; `.env.demo` aman.
- Commit hanya bila user minta. Akhiri pesan commit dengan `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
