-- =====================================================================
-- Seed awal (PRD §4.1a, §4.1b, §4.2, config). Aman dijalankan ulang.
-- Jalankan setelah semua migration.
-- =====================================================================

-- ---------- Config ----------
insert into seragam.config (key, value, type, label, description, grup, sort_order) values
  ('cutoff_day', '5', 'int', 'Tanggal cutoff', 'Tanggal data PPM diimport dan batch reguler dibentuk setiap bulan.', 'Jadwal distribusi', 10),
  ('ship_deadline_day', '20', 'int', 'Tanggal deadline kirim', 'Batas batch reguler berstatus SHIPPED.', 'Jadwal distribusi', 20),
  ('ship_deadline_next_month', 'false', 'bool', 'Deadline di bulan berikutnya', 'Ya = deadline jatuh di bulan setelah cutoff (mis. tanggal 5 bulan berikut).', 'Jadwal distribusi', 30),
  ('adhoc_batch_weekday', '1', 'int', 'Hari batch ad-hoc mingguan', '1 = Senin … 7 = Minggu. Untuk hire mendadak.', 'Jadwal distribusi', 40),
  ('noshow_grace_days', '7', 'int', 'Masa tunggu no-show (hari)', 'Joiner yang tidak hadir sampai sekian hari setelah rencana join dianggap no-show.', 'Jadwal distribusi', 50),
  ('exchange_window_days', '14', 'int', 'Batas pengajuan tukar (hari)', 'Tukar karena cacat hanya boleh diajukan dalam sekian hari sejak barang diterima.', 'Transaksi', 10),
  ('return_alert_days', '14', 'int', 'Alert retur resign (hari)', 'Karyawan resign yang belum mengembalikan lebih dari sekian hari muncul di alert.', 'Transaksi', 20),
  ('allow_reissue_grade_a', 'false', 'bool', 'Retur grade A boleh untuk joiner baru', 'Tidak = stok LAYAK hasil retur hanya dipakai untuk tukar cacat/darurat.', 'Transaksi', 30),
  ('replacement_cycle_months', '0', 'int', 'Siklus penggantian (bulan)', '0 = nonaktif. Rusak = beli.', 'Transaksi', 40),
  ('demand_window_months', '6', 'int', 'Jendela rata-rata permintaan (bulan)', 'Rentang histori untuk menghitung rata-rata permintaan bulanan per SKU.', 'Perencanaan stok', 10),
  ('ss_months', '0.5', 'number', 'Safety stock (bulan)', 'Safety stock = rata-rata permintaan × nilai ini.', 'Perencanaan stok', 20),
  ('cover_months', '2', 'number', 'Cakupan order (bulan)', 'Saran order menutup kebutuhan sekian bulan ke depan.', 'Perencanaan stok', 30),
  ('planned_hires_per_month', '50', 'int', 'Rencana hire per bulan', 'Dipakai untuk forecast SKU yang belum punya histori.', 'Perencanaan stok', 40),
  ('employee_estimate', '800', 'int', 'Estimasi karyawan aktif', 'Referensi perencanaan.', 'Perencanaan stok', 50)
on conflict (key) do nothing;

-- ---------- Ukuran ----------
insert into seragam.size (size_code, size_order) values
  ('S', 1), ('M', 2), ('L', 3), ('XL', 4), ('XXL', 5), ('3XL', 6), ('4XL', 7), ('5XL', 8)
on conflict (size_code) do nothing;

-- ---------- Item ----------
insert into seragam.item (item_code, nama, gender_specific, size_group, sort_order) values
  ('KMJ', 'Kemeja Panjang', true, 'KEMEJA', 10),
  ('POLO', 'Kaos Polo', false, 'POLO', 20),
  ('BLZ-TTK', 'Blazer TTK', true, 'BLAZER', 30),
  ('BLZ-APT', 'Blazer Apoteker', true, 'BLAZER', 40)
on conflict (item_code) do nothing;

insert into seragam.item_size (item_code, size_code)
select i, s from unnest(array['KMJ', 'BLZ-TTK', 'BLZ-APT']) i, unnest(array['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL']) s
union all
select 'POLO', s from unnest(array['S', 'M', 'L', 'XL', 'XXL', '3XL']) s
on conflict do nothing;

-- SKU = item + gender + ukuran (55 SKU)
insert into seragam.sku (sku_code, item_code, gender, size_code)
select i.item_code || '-' || g || '-' || isz.size_code, i.item_code, g, isz.size_code
from seragam.item i
join seragam.item_size isz on isz.item_code = i.item_code
cross join lateral unnest(case when i.gender_specific then array['P', 'W'] else array['U'] end) g
on conflict (sku_code) do nothing;

-- ---------- Paket (versi 1) ----------
insert into seragam.package (package_code, nama, deskripsi) values
  ('STD', 'Standar', 'Default semua jabatan'),
  ('STD-TTK', 'Standar TTK', 'Tenaga Teknis Kefarmasian'),
  ('STD-APT', 'Standar Apoteker', 'Apoteker'),
  ('GA-A', 'GA A', 'Jabatan GA tertentu (1 kemeja, 2 polo)'),
  ('GA-B', 'GA B', 'Jabatan GA tertentu (2 polo)')
on conflict (package_code) do nothing;

insert into seragam.package_version (package_code, version_no, effective_date, scope, catatan)
select package_code, 1, date '2020-01-01', 'SEMUA_AKTIF', 'Versi awal (seed)' from seragam.package
on conflict do nothing;

insert into seragam.package_item (package_code, version_no, item_code, qty) values
  ('STD', 1, 'KMJ', 2), ('STD', 1, 'POLO', 1), ('STD', 1, 'BLZ-TTK', 0), ('STD', 1, 'BLZ-APT', 0),
  ('STD-TTK', 1, 'KMJ', 2), ('STD-TTK', 1, 'POLO', 1), ('STD-TTK', 1, 'BLZ-TTK', 1), ('STD-TTK', 1, 'BLZ-APT', 0),
  ('STD-APT', 1, 'KMJ', 2), ('STD-APT', 1, 'POLO', 1), ('STD-APT', 1, 'BLZ-TTK', 0), ('STD-APT', 1, 'BLZ-APT', 1),
  ('GA-A', 1, 'KMJ', 1), ('GA-A', 1, 'POLO', 2), ('GA-A', 1, 'BLZ-TTK', 0), ('GA-A', 1, 'BLZ-APT', 0),
  ('GA-B', 1, 'KMJ', 0), ('GA-B', 1, 'POLO', 2), ('GA-B', 1, 'BLZ-TTK', 0), ('GA-B', 1, 'BLZ-APT', 0)
on conflict do nothing;

-- ---------- Size curve awal (estimasi, bisa diedit admin) ----------
insert into seragam.size_curve (item_code, gender, size_code, proporsi)
select i, g, s, p from (values
  ('P', 'S', 0.05), ('P', 'M', 0.20), ('P', 'L', 0.30), ('P', 'XL', 0.25), ('P', 'XXL', 0.12), ('P', '3XL', 0.05), ('P', '4XL', 0.02), ('P', '5XL', 0.01),
  ('W', 'S', 0.12), ('W', 'M', 0.30), ('W', 'L', 0.28), ('W', 'XL', 0.17), ('W', 'XXL', 0.08), ('W', '3XL', 0.03), ('W', '4XL', 0.01), ('W', '5XL', 0.01)
) v(g, s, p), unnest(array['KMJ', 'BLZ-TTK', 'BLZ-APT']) i
union all
select 'POLO', 'U', s, p from (values ('S', 0.08), ('M', 0.25), ('L', 0.30), ('XL', 0.22), ('XXL', 0.10), ('3XL', 0.05)) v(s, p)
on conflict do nothing;
