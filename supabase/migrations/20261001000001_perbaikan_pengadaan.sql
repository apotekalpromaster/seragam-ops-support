-- =====================================================================
-- Perbaikan perencanaan pengadaan (v_sku_planning)
--
-- Masalah: rata-rata permintaan/bulan menjumlahkan SEMUA transaksi keluar, termasuk
--   (a) riwayat distribusi lama dari Migrasi Data Awal (affects_stock = false) — seragam
--       yang sudah dimiliki seluruh karyawan, bukan kebutuhan bulanan;
--   (b) pengiriman "tunggakan" ke karyawan lama dan pengiriman ulang karena paket berubah —
--       sekali jalan, dan sebelum dikirim sudah dihitung sebagai kebutuhan antrian.
--   Akibatnya saran order membengkak (mis. 5.377 pcs untuk ±870 karyawan).
--
-- Aturan baru:
-- - Permintaan rutin = transaksi yang mengubah stok, berupa
--     · kirim (ISSUE) ke karyawan baru: tanggal kirim ≤ tanggal join + new_hire_days
--       (paket yang dikirim sebelum join ikut dihitung), atau karyawan yang join sejak sistem
--       dipakai (import PPM pertama) — supaya joiner yang terlambat dikirim saat stok habis tetap
--       terhitung;
--     · kirim karena mutasi jabatan: dalam new_hire_days setelah import PPM yang mencatat mutasinya;
--     · tukar (EXC_OUT) dan pembelian (SALE);
--   masing-masing dikurangi koreksinya (REVERSAL dinilai dari transaksi aslinya).
-- - Histori baru dipakai bila transaksi rutin pertama sudah ≥ demand_min_months bulan lalu.
--   Sebelum itu semua SKU memakai perkiraan rencana hire.
-- - Perkiraan rencana hire = rencana hire/bulan × qty item per karyawan × sebaran ukuran.
--   Sebaran ukuran diambil dari ukuran karyawan sungguhan bila datanya ≥ 20 orang untuk
--   item × gender itu; selain itu memakai size curve.
-- - Kolom baru (di akhir): avg_rencana (perkiraan rencana hire, selalu dihitung sebagai
--   pembanding), proporsi_sumber, histori_cukup.
-- =====================================================================

insert into seragam.config (key, value, type, label, description, grup, sort_order) values
  ('demand_min_months', '3', 'int', 'Histori minimal (bulan)',
   'Rata-rata dari histori baru dipakai bila transaksi keluar rutin pertama sudah sekian bulan lalu. Sebelum itu memakai rencana hire.',
   'Perencanaan stok', 15),
  ('new_hire_days', '60', 'int', 'Batas karyawan baru (hari)',
   'Kiriman dihitung sebagai permintaan rutin bila dikirim paling lambat sekian hari setelah join atau setelah mutasi jabatan. Kiriman tunggakan ke karyawan lama tidak dihitung.',
   'Perencanaan stok', 16)
on conflict (key) do nothing;

update seragam.config
   set description = 'Rentang histori permintaan rutin (kirim ke karyawan baru/mutasi, tukar, beli) untuk rata-rata bulanan per SKU.'
 where key = 'demand_window_months';
update seragam.config
   set description = 'Dipakai untuk perkiraan permintaan bila histori belum cukup, dan sebagai pembanding di halaman Pengadaan.'
 where key = 'planned_hires_per_month';

create or replace view seragam.v_sku_planning with (security_invoker = true) as
with
cfg as materialized (
  select seragam.cfg_num('ss_months', 0.5) as ss_m, seragam.cfg_num('cover_months', 2) as cover_m,
         seragam.cfg_int('planned_hires_per_month', 50) as hires, seragam.cfg_int('demand_window_months', 6) as w,
         seragam.cfg_int('default_lead_time_days', 30) as lt, seragam.cfg_int('demand_min_months', 3) as min_m,
         seragam.cfg_int('new_hire_days', 60) as nh, seragam.today() as today
),
golive as materialized (
  select min((committed_at at time zone 'Asia/Jakarta')::date) as d from seragam.import_log where status = 'COMMITTED'
),
mutasi as materialized (
  select d.nik, (il.committed_at at time zone 'Asia/Jakarta')::date as dari
  from seragam.import_diff d
  join seragam.import_log il on il.id = d.import_id
  where d.change_type = 'MUTASI_JABATAN' and il.status = 'COMMITTED' and il.committed_at is not null
),
-- Transaksi keluar rutin (lihat header). Reversal dinilai dari transaksi aslinya (o).
rec as materialized (
  select coalesce(o.tanggal, l.tanggal) as tanggal, l.sku_code, -l.qty as q
  from seragam.ledger l
  left join seragam.ledger o on o.id = l.reversal_of
  left join seragam.employee e on e.nik = l.nik
  cross join cfg
  cross join golive g
  where l.affects_stock
    and coalesce(o.tx_type, l.tx_type) in ('ISSUE', 'SALE', 'EXC_OUT')
    and (l.tx_type <> 'REVERSAL' or o.id is not null)
    and (coalesce(o.tx_type, l.tx_type) <> 'ISSUE'
         or coalesce(o.tanggal, l.tanggal) <= coalesce(e.join_date, e.planned_join_date) + cfg.nh
         or coalesce(e.join_date, e.planned_join_date) >= g.d
         or exists (select 1 from mutasi m
                     where m.nik = l.nik and coalesce(o.tanggal, l.tanggal) between m.dari and m.dari + cfg.nh))
),
first_out as materialized (select min(tanggal) as d from rec),
win as materialized (
  select greatest(1, least(cfg.w,
           coalesce((date_part('year', age(cfg.today, f.d)) * 12 + date_part('month', age(cfg.today, f.d)))::int + 1, 1)))::int as m,
         coalesce(f.d <= cfg.today - make_interval(months => cfg.min_m), false) as cukup
  from cfg, first_out f
),
hist as materialized (
  select r.sku_code, sum(r.q)::int as q
  from rec r, win, cfg
  where r.tanggal > cfg.today - make_interval(months => win.m)
  group by r.sku_code
),
ent as materialized (
  select en.nik, en.item_code, en.sku_gender, en.qty, en.sku_target, en.size_status
  from seragam.v_entitlement en
  join seragam.employee e on e.nik = en.nik
  where e.status in ('AKTIF', 'OFFERING')
),
nemp as materialized (select count(distinct nik)::numeric as n from ent),
qph as materialized (
  select item_code, sku_gender, sum(qty)::numeric / nullif((select n from nemp), 0) as q
  from ent group by item_code, sku_gender
),
-- Sebaran ukuran dari hak karyawan yang ukurannya valid.
mix as materialized (
  select sku_target as sku_code, sum(qty)::numeric as q
  from ent where size_status = 'OK' and sku_target is not null
  group by sku_target
),
mix_tot as materialized (
  select item_code, sku_gender, sum(qty)::numeric as q, count(distinct nik) >= 20 as cukup
  from ent where size_status = 'OK' and sku_target is not null
  group by item_code, sku_gender
),
-- Sama dengan Σ v_queue.sisa (ukuran valid), tetapi dihitung dari `ent` yang sudah ada supaya
-- hak karyawan tidak dihitung ulang (view ini juga dipakai v_alert di setiap halaman).
pipe as materialized (
  select ent.sku_target as sku_code,
         sum(greatest(0, greatest(0, ent.qty - coalesce(i.issued, 0) + coalesce(i.returned, 0)) - coalesce(ib.qty, 0)))::int as q
  from ent
  left join seragam.v_issued i on i.nik = ent.nik and i.item_code = ent.item_code
  left join seragam.v_in_batch ib on ib.nik = ent.nik and ib.item_code = ent.item_code
  where ent.size_status = 'OK' and ent.sku_target is not null
  group by ent.sku_target
),
st as materialized (select * from seragam.v_stock_sku),
sk as materialized (select sku_code, vendor_id, vendor_nama, lead_time_days, moq from seragam.v_sku),
oo as materialized (select * from seragam.v_on_order),
pre as (
  select st.sku_code, st.item_code, st.item_nama, st.gender, st.size_code, st.size_order, st.label, st.item_sort,
         st.price, st.active, st.layak, st.karantina, st.cadangan, st.afkir, st.reserved, st.available,
         sk.vendor_id, sk.vendor_nama, coalesce(sk.lead_time_days, cfg.lt) as lead_time_days, sk.moq,
         coalesce(oo.on_order, 0) as on_order, coalesce(oo.qty_po_draft, 0) as qty_po_draft,
         coalesce(pipe.q, 0) as pipeline_demand,
         coalesce(h.q, 0) as demand_histori, win.m as demand_bulan, win.cukup as histori_cukup,
         cfg.hires * coalesce(qph.q, 0) *
           case when mt.cukup then coalesce(mix.q, 0) / mt.q else coalesce(sc.proporsi, 0) end as rencana_raw,
         case when mt.cukup then 'DATA_KARYAWAN' when sc.proporsi is not null then 'SIZE_CURVE' end as proporsi_sumber,
         cfg.ss_m, cfg.cover_m
  from st
  cross join cfg
  cross join win
  join sk on sk.sku_code = st.sku_code
  left join oo on oo.sku_code = st.sku_code
  left join pipe on pipe.sku_code = st.sku_code
  left join hist h on h.sku_code = st.sku_code
  left join qph on qph.item_code = st.item_code and qph.sku_gender = st.gender
  left join mix on mix.sku_code = st.sku_code
  left join mix_tot mt on mt.item_code = st.item_code and mt.sku_gender = st.gender
  left join seragam.size_curve sc on sc.item_code = st.item_code and sc.gender = st.gender and sc.size_code = st.size_code
),
base as (
  select p.*,
         case when p.histori_cukup and p.demand_histori > 0 then p.demand_histori::numeric / p.demand_bulan
              else p.rencana_raw end as avg_raw,
         case when p.histori_cukup and p.demand_histori > 0 then 'HISTORI'
              when p.rencana_raw > 0 then 'RENCANA_HIRE'
              else 'TIDAK_ADA' end as demand_sumber
  from pre p
),
calc as (
  select b.*,
         b.avg_raw * b.ss_m as ss_raw,
         b.avg_raw * (b.lead_time_days / 30.0) + b.avg_raw * b.ss_m as rop_raw,
         greatest(0, round(b.avg_raw * b.cover_m + b.avg_raw * b.ss_m + b.pipeline_demand - b.available - b.on_order))::int as order_raw
  from base b
)
select c.sku_code, c.item_code, c.item_nama, c.gender, c.size_code, c.size_order, c.label, c.item_sort, c.price, c.active,
       c.layak, c.karantina, c.cadangan, c.afkir, c.reserved, c.available,
       c.vendor_id, c.vendor_nama, c.lead_time_days, c.moq, c.on_order, c.qty_po_draft, c.pipeline_demand,
       c.demand_histori, c.demand_bulan, c.demand_sumber,
       round(c.avg_raw, 2) as avg_demand, round(c.ss_raw, 2) as safety_stock, round(c.rop_raw, 2) as rop,
       c.order_raw as kebutuhan_order,
       case when c.active then (ceil(c.order_raw::numeric / c.moq) * c.moq)::int else 0 end as suggested_order,
       case
         when c.available < c.pipeline_demand or (round(c.ss_raw) >= 1 and c.available <= c.ss_raw) then 'KRITIS'
         when round(c.rop_raw) >= 1 and c.available + c.on_order <= c.rop_raw then 'ORDER'
         else 'AMAN'
       end as status,
       round(c.rencana_raw, 2) as avg_rencana, c.proporsi_sumber, c.histori_cukup
from calc c;

select seragam._apply_hardening();
