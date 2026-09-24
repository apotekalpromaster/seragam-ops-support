# CLAUDE.md — Dashboard Alokasi Seragam (Ops Support Apotek Alpro)

Dashboard kerja staf Ops Support: alokasi, stok, distribusi, dan retur seragam. UI Bahasa Indonesia; kode & istilah teknis boleh Inggris.
PRD: `C:\Users\ALPNB092\Downloads\PRD_Dashboard_Seragam_OpsSupport.md` (rujuk § nomor PRD di komentar/commit).

## Status milestone
- ✅ M1 Fondasi · ✅ M2 Distribusi (migration sudah dijalankan di Supabase user)
- ⏭ **M3 Stok & Pengadaan**: AvgDemand, SafetyStock, ROP, SuggestedOrder (bulatkan ke MOQ, AC #6), PO per vendor + terima parsial (ledger IN), status KRITIS/ORDER/AMAN (PRD §6, §7.5). Opname + ADJ sudah ada sejak M1.
- M4 Transaksi & Retur (tukar ≤14 hari, beli + export potong gaji, retur resign/mutasi/no-show, QC, afkir) · M5 KPI lengkap + email + link konfirmasi APA.
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
- **Migration baru = file baru** `supabase/migrations/YYYYMMDD00000N_*.sql`. Jangan ubah migration yang sudah dijalankan user (M1 `20260924…`, M2 `20260925000001`). Akhiri dengan RLS + grant untuk objek baru dan `revoke execute` untuk fungsi internal `_*`.
- **Performa**: filter pada view turunan `v_outstanding` bisa didorong optimizer → O(n²). Pasang pagar `from (select * from seragam.v_outstanding offset 0) o`, dan CTE `as materialized` di view agregat (lihat `v_alert`, `v_kpi_current`). Test `perf.test.ts` dikalibrasi relatif ke kecepatan mesin (batas 40× unit).
- **Frontend data layer**: `src/lib/db.ts` (`Db.select(view, {filters, order, limit, columns})`, `Db.rpc`, `uploadFile/fileUrl`), implementasi Supabase & demo (`src/lib/demo/demoDb.ts`, PGlite di Web Worker, satu inisialisasi bersama + penanda `demo_store.ready`). Hooks: `useView`, `useRpc` (toast sukses/error, invalidate semua query), `useRpcQuery` di `src/lib/api.tsx`.
- Data demo: `src/lib/demo/demoData.ts` (deterministik; ubah migration/seed → DB demo otomatis dibuat ulang).

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
