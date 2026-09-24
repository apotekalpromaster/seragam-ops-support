-- =====================================================================
-- Migration 3: views perhitungan (PRD §6)
--
-- Semua view memakai security_invoker supaya RLS tabel dasar berlaku.
-- Angka stok SELALU hasil hitung dari ledger; tidak ada kolom stok yang
-- disimpan atau diketik.
-- =====================================================================

-- ---------- SKU & harga ----------
create view seragam.v_sku_price_current with (security_invoker = true) as
select distinct on (sku_code) sku_code, price, valid_from
from seragam.sku_price
where valid_from <= current_date
order by sku_code, valid_from desc;

create view seragam.v_sku with (security_invoker = true) as
select
  s.sku_code, s.item_code, i.nama as item_nama, s.gender, s.size_code, sz.size_order,
  i.nama
    || case s.gender when 'P' then ' Pria' when 'W' then ' Wanita' else '' end
    || ' ' || s.size_code as label,
  p.price, p.valid_from as price_valid_from,
  s.vendor_id, v.nama as vendor_nama,
  coalesce(s.lead_time_days, v.lead_time_default) as lead_time_days,
  s.lead_time_days as lead_time_override,
  s.moq, s.active and i.active as active, i.sort_order as item_sort
from seragam.sku s
join seragam.item i on i.item_code = s.item_code
join seragam.size sz on sz.size_code = s.size_code
left join seragam.v_sku_price_current p on p.sku_code = s.sku_code
left join seragam.vendor v on v.id = s.vendor_id;

-- ---------- Stok ----------
-- OnHand per SKU × status. Hanya baris affects_stock.
create view seragam.v_stock as
select sku_code, stock_status, sum(qty)::int as qty
from seragam.ledger
where affects_stock
group by sku_code, stock_status;
alter view seragam.v_stock set (security_invoker = true);

-- Reserved = qty di batch DRAFT/PICKING/PACKED. Tabel batch dibuat di M2;
-- sampai saat itu reserved = 0. Migration M2 mengganti view ini.
create view seragam.v_reserved with (security_invoker = true) as
select null::text as sku_code, 0::int as qty where false;

create view seragam.v_stock_sku with (security_invoker = true) as
select
  s.sku_code, s.item_code, s.item_nama, s.gender, s.size_code, s.size_order, s.label,
  s.item_sort, s.price, s.active,
  coalesce(sum(st.qty) filter (where st.stock_status = 'LAYAK'), 0)::int as layak,
  coalesce(sum(st.qty) filter (where st.stock_status = 'KARANTINA'), 0)::int as karantina,
  coalesce(sum(st.qty) filter (where st.stock_status = 'CADANGAN'), 0)::int as cadangan,
  coalesce(sum(st.qty) filter (where st.stock_status = 'AFKIR'), 0)::int as afkir,
  coalesce((select sum(r.qty) from seragam.v_reserved r where r.sku_code = s.sku_code), 0)::int as reserved,
  (coalesce(sum(st.qty) filter (where st.stock_status = 'LAYAK'), 0)
    - coalesce((select sum(r.qty) from seragam.v_reserved r where r.sku_code = s.sku_code), 0))::int as available
from seragam.v_sku s
left join seragam.v_stock st on st.sku_code = s.sku_code
group by s.sku_code, s.item_code, s.item_nama, s.gender, s.size_code, s.size_order, s.label,
         s.item_sort, s.price, s.active;

-- ---------- Paket berlaku per karyawan ----------
-- PaketAktif = override jika ada, selain itu paket dari position_map.
-- VersiBerlaku = versi terbaru yang (a) SEMUA_AKTIF & sudah efektif, atau
-- (b) KARYAWAN_BARU & effective_date <= tanggal join (rencana/aktual).
create view seragam.v_employee_package with (security_invoker = true) as
select
  e.nik,
  coalesce(o.package_code, pm.package_code) as package_code,
  case when o.nik is not null then 'OVERRIDE' when pm.jabatan is not null then 'JABATAN' end as sumber,
  (select pv.version_no
     from seragam.package_version pv
    where pv.package_code = coalesce(o.package_code, pm.package_code)
      and (   (pv.scope = 'SEMUA_AKTIF' and pv.effective_date <= current_date)
           or (pv.scope = 'KARYAWAN_BARU'
               and pv.effective_date <= coalesce(e.planned_join_date, e.join_date)))
    order by pv.version_no desc
    limit 1) as version_no
from seragam.employee e
left join seragam.employee_package_override o on o.nik = e.nik
left join seragam.position_map pm on pm.jabatan = e.jabatan;

-- Entitlement per karyawan × item, beserta SKU target sesuai gender & ukuran.
create view seragam.v_entitlement with (security_invoker = true) as
select
  ep.nik, ep.package_code, ep.version_no, pi.item_code, i.nama as item_nama, pi.qty,
  i.size_group, sz.size_code,
  case when i.gender_specific then e.gender else 'U' end as sku_gender,
  s.sku_code as sku_target,
  case
    when sz.size_code is null then 'KOSONG'
    when s.sku_code is null or not exists (
      select 1 from seragam.item_size isz where isz.item_code = pi.item_code and isz.size_code = sz.size_code
    ) then 'TIDAK_TERSEDIA'
    else 'OK'
  end as size_status
from seragam.v_employee_package ep
join seragam.employee e on e.nik = ep.nik
join seragam.package_item pi on pi.package_code = ep.package_code and pi.version_no = ep.version_no and pi.qty > 0
join seragam.item i on i.item_code = pi.item_code and i.active
cross join lateral (
  select nullif(upper(trim(case i.size_group
    when 'KEMEJA' then e.size_kemeja
    when 'POLO' then e.size_polo
    when 'BLAZER' then e.size_blazer
    else e.size_lain ->> i.size_group end)), '') as size_code
) sz
left join seragam.sku s
  on s.item_code = pi.item_code
 and s.gender = case when i.gender_specific then e.gender else 'U' end
 and s.size_code = sz.size_code
 and s.active;

-- Issued_net = Σ ISSUE − Σ RET (termasuk reversal-nya). EXC & SALE tidak dihitung.
create view seragam.v_issued with (security_invoker = true) as
select
  l.nik, s.item_code,
  sum(case when l.tx_type = 'ISSUE' or (l.tx_type = 'REVERSAL' and l.reversed_tx_type = 'ISSUE') then -l.qty else 0 end)::int as issued,
  sum(case when l.tx_type = 'RET' or (l.tx_type = 'REVERSAL' and l.reversed_tx_type = 'RET') then l.qty else 0 end)::int as returned,
  max(l.tanggal) filter (where l.tx_type = 'ISSUE') as last_issue_date
from seragam.ledger l
join seragam.sku s on s.sku_code = l.sku_code
where l.nik is not null
  and (l.tx_type in ('ISSUE', 'RET') or (l.tx_type = 'REVERSAL' and l.reversed_tx_type in ('ISSUE', 'RET')))
group by l.nik, s.item_code;

-- Status hak per karyawan × item: entitlement, sudah diterima, outstanding, over-issued.
create view seragam.v_employee_item with (security_invoker = true) as
select
  k.nik, k.item_code, i.nama as item_nama, i.sort_order as item_sort,
  coalesce(en.qty, 0) as entitlement,
  coalesce(iss.issued, 0) - coalesce(iss.returned, 0) as issued_net,
  greatest(0, coalesce(en.qty, 0) - (coalesce(iss.issued, 0) - coalesce(iss.returned, 0))) as outstanding,
  greatest(0, (coalesce(iss.issued, 0) - coalesce(iss.returned, 0)) - coalesce(en.qty, 0)) as over_issued,
  en.sku_target, en.size_code, en.sku_gender, en.size_status, iss.last_issue_date
from (
  select nik, item_code from seragam.v_entitlement
  union
  select nik, item_code from seragam.v_issued
) k
join seragam.item i on i.item_code = k.item_code
left join seragam.v_entitlement en on en.nik = k.nik and en.item_code = k.item_code
left join seragam.v_issued iss on iss.nik = k.nik and iss.item_code = k.item_code;

-- Antrian: karyawan AKTIF/OFFERING dengan outstanding > 0.
create view seragam.v_outstanding with (security_invoker = true) as
select ei.*, e.nama, e.jabatan, e.kode_cabang, b.nama as cabang_nama, b.area, e.status,
       e.planned_join_date, e.join_date,
       (current_date - coalesce(e.join_date, e.planned_join_date)) as aging_hari
from seragam.v_employee_item ei
join seragam.employee e on e.nik = ei.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
where e.status in ('AKTIF', 'OFFERING') and ei.outstanding > 0;

-- Daftar karyawan dengan ringkasan status seragam.
create view seragam.v_employee_list with (security_invoker = true) as
select
  e.nik, e.nama, e.gender, e.jabatan, e.kode_cabang, b.nama as cabang_nama, b.area,
  e.status, e.status_karyawan, e.is_loan, e.is_late_hire,
  e.planned_join_date, e.join_date, e.planned_resign_date, e.resign_date,
  e.size_kemeja, e.size_polo, e.size_blazer, e.size_lain,
  ep.package_code, ep.version_no as package_version, ep.sumber as package_sumber,
  coalesce(agg.entitlement, 0) as entitlement_total,
  coalesce(agg.issued_net, 0) as issued_total,
  coalesce(agg.outstanding, 0) as outstanding_total,
  coalesce(agg.over_issued, 0) as over_issued_total,
  coalesce(agg.size_problem, false) as size_problem,
  (ep.package_code is null) as jabatan_unmapped,
  e.updated_at
from seragam.employee e
join seragam.branch b on b.kode_cabang = e.kode_cabang
left join seragam.v_employee_package ep on ep.nik = e.nik
left join (
  select ei.nik,
         sum(ei.entitlement)::int as entitlement, sum(ei.issued_net)::int as issued_net,
         sum(ei.outstanding)::int as outstanding, sum(ei.over_issued)::int as over_issued,
         bool_or(ei.outstanding > 0 and ei.size_status <> 'OK') as size_problem
  from seragam.v_employee_item ei
  group by ei.nik
) agg on agg.nik = e.nik;

-- Jabatan dari data PPM yang belum dimapping ke paket.
create view seragam.v_unmapped_position with (security_invoker = true) as
select e.jabatan, count(*)::int as jumlah_karyawan,
       count(*) filter (where e.status = 'OFFERING')::int as jumlah_offering
from seragam.employee e
where e.status in ('AKTIF', 'OFFERING')
  and not exists (select 1 from seragam.position_map pm where pm.jabatan = e.jabatan)
  and not exists (select 1 from seragam.employee_package_override o where o.nik = e.nik)
group by e.jabatan;

-- Semua jabatan yang dikenal (dari mapping maupun data karyawan).
create view seragam.v_position with (security_invoker = true) as
select j.jabatan, pm.package_code, pm.updated_at,
       (select count(*) from seragam.employee e where e.jabatan = j.jabatan and e.status in ('AKTIF', 'OFFERING'))::int as jumlah_karyawan
from (
  select jabatan from seragam.position_map
  union
  select distinct jabatan from seragam.employee where status in ('AKTIF', 'OFFERING')
) j
left join seragam.position_map pm on pm.jabatan = j.jabatan;

-- Ukuran kosong / tidak tersedia yang menghalangi pengiriman.
create view seragam.v_size_issue with (security_invoker = true) as
select o.nik, o.nama, o.jabatan, o.kode_cabang, o.cabang_nama, o.area, o.status,
       o.planned_join_date, o.join_date,
       o.item_code, o.item_nama, o.size_code, o.sku_gender, o.size_status, o.outstanding
from seragam.v_outstanding o
where o.size_status <> 'OK';

-- ---------- Paket ----------
create view seragam.v_package with (security_invoker = true) as
select
  p.package_code, p.nama, p.deskripsi, p.active, p.created_at,
  lv.version_no as latest_version, lv.effective_date, lv.scope,
  (select count(*) from seragam.position_map pm where pm.package_code = p.package_code)::int as jumlah_jabatan,
  (select count(*) from seragam.employee_package_override o where o.package_code = p.package_code)::int as jumlah_override,
  (select count(*) from seragam.v_employee_package ep join seragam.employee e on e.nik = ep.nik
    where ep.package_code = p.package_code and e.status in ('AKTIF', 'OFFERING'))::int as jumlah_karyawan,
  coalesce((select jsonb_object_agg(pi.item_code, pi.qty) from seragam.package_item pi
             where pi.package_code = p.package_code and pi.version_no = lv.version_no), '{}'::jsonb) as items
from seragam.package p
left join lateral (
  select * from seragam.package_version pv where pv.package_code = p.package_code
  order by pv.version_no desc limit 1
) lv on true;

create view seragam.v_package_version with (security_invoker = true) as
select pv.*, u.nama as created_by_nama,
       coalesce((select jsonb_object_agg(pi.item_code, pi.qty) from seragam.package_item pi
                  where pi.package_code = pv.package_code and pi.version_no = pv.version_no), '{}'::jsonb) as items
from seragam.package_version pv
left join seragam.app_user u on u.user_id = pv.created_by;

create view seragam.v_override with (security_invoker = true) as
select o.nik, e.nama, e.jabatan, e.kode_cabang, b.nama as cabang_nama, e.status,
       o.package_code, pm.package_code as package_jabatan, o.alasan, o.created_at, u.nama as created_by_nama
from seragam.employee_package_override o
join seragam.employee e on e.nik = o.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
left join seragam.position_map pm on pm.jabatan = e.jabatan
left join seragam.app_user u on u.user_id = o.created_by;

create view seragam.v_item with (security_invoker = true) as
select i.*,
       coalesce((select array_agg(isz.size_code order by sz.size_order)
                   from seragam.item_size isz join seragam.size sz on sz.size_code = isz.size_code
                  where isz.item_code = i.item_code), '{}') as sizes,
       (select count(*) from seragam.sku s where s.item_code = i.item_code and s.active)::int as jumlah_sku
from seragam.item i;

-- ---------- Ledger & riwayat ----------
create view seragam.v_ledger with (security_invoker = true) as
select l.*, s.label as sku_label, s.item_code, e.nama as nama_karyawan, u.nama as created_by_nama,
       exists (select 1 from seragam.ledger r where r.reversal_of = l.id) as sudah_dikoreksi
from seragam.ledger l
join seragam.v_sku s on s.sku_code = l.sku_code
left join seragam.employee e on e.nik = l.nik
left join seragam.app_user u on u.user_id = l.created_by;

create view seragam.v_import_log with (security_invoker = true) as
select il.*, u.nama as created_by_nama,
       (il.committed_at is not null
        and il.committed_at::date <= make_date(extract(year from il.periode)::int,
                                               extract(month from il.periode)::int,
                                               least(seragam.cfg_int('cutoff_day', 5), 28))) as tepat_waktu
from seragam.import_log il
left join seragam.app_user u on u.user_id = il.created_by;

create view seragam.v_import_diff with (security_invoker = true) as
select d.*, e.nama, e.jabatan, e.kode_cabang
from seragam.import_diff d
left join seragam.employee e on e.nik = d.nik;

create view seragam.v_audit_log with (security_invoker = true) as
select a.*, coalesce(u.nama, a.user_email) as user_nama
from seragam.audit_log a
left join seragam.app_user u on u.user_id = a.user_id;

create view seragam.v_opname with (security_invoker = true) as
select o.*, uc.nama as created_by_nama, ua.nama as approved_by_nama,
       (select count(*) from seragam.stock_opname_line l where l.opname_id = o.id)::int as jumlah_baris,
       (select count(*) from seragam.stock_opname_line l where l.opname_id = o.id and l.qty_fisik is not null)::int as jumlah_terisi,
       (select count(*) from seragam.stock_opname_line l where l.opname_id = o.id
          and l.qty_fisik is not null and l.qty_fisik <> l.qty_sistem)::int as jumlah_selisih
from seragam.stock_opname o
left join seragam.app_user uc on uc.user_id = o.created_by
left join seragam.app_user ua on ua.user_id = o.approved_by;

create view seragam.v_opname_line with (security_invoker = true) as
select l.*, s.label as sku_label, s.item_code, s.gender, s.size_code, s.size_order, s.item_sort,
       case when l.qty_fisik is null then null else l.qty_fisik - l.qty_sistem end as selisih
from seragam.stock_opname_line l
join seragam.v_sku s on s.sku_code = l.sku_code;

-- ---------- Overview: alert & KPI ----------
create view seragam.v_alert with (security_invoker = true) as
with
outs as materialized (
  select nik, sku_target, size_status, outstanding from seragam.v_outstanding
),
unmapped as materialized (select count(*)::int n, coalesce(sum(jumlah_karyawan), 0)::int k from seragam.v_unmapped_position),
size_kosong as materialized (select count(distinct nik)::int n from outs where size_status = 'KOSONG'),
size_invalid as materialized (select count(distinct nik)::int n from outs where size_status = 'TIDAK_TERSEDIA'),
demand as materialized (
  select sku_target, sum(outstanding)::int need
  from outs where sku_target is not null and size_status = 'OK'
  group by sku_target
),
stok as materialized (select sku_code, available from seragam.v_stock_sku),
kurang as materialized (
  select count(*)::int n from demand d join stok s on s.sku_code = d.sku_target
  where s.available < d.need
),
imp as materialized (
  select exists (
    select 1 from seragam.import_log
    where status = 'COMMITTED' and periode = date_trunc('month', current_date)::date
  ) as sudah
),
opening as materialized (select exists (select 1 from seragam.ledger where tx_type = 'OPENING') as ada)
select * from (
  select 'IMPORT_TERLAMBAT' as kode, 'KRITIS' as level,
         'Import data PPM bulan ini belum dilakukan' as judul,
         'Lewat tanggal cutoff (' || seragam.cfg_int('cutoff_day', 5) || '). Antrian alokasi memakai data lama.' as detail,
         1 as jumlah, '/import' as link, 1 as urutan
  from imp where not imp.sudah and extract(day from current_date) > seragam.cfg_int('cutoff_day', 5)
  union all
  select 'STOK_KURANG', 'KRITIS', 'SKU dengan stok tidak cukup untuk antrian',
         'Available lebih kecil dari kebutuhan outstanding karyawan.', n, '/stok', 2
  from kurang where n > 0
  union all
  select 'JABATAN_BELUM_DIMAPPING', 'PERINGATAN', 'Jabatan belum dimapping ke paket',
         k || ' karyawan tidak masuk antrian sampai jabatannya dimapping.', n, '/master/jabatan', 3
  from unmapped where n > 0
  union all
  select 'UKURAN_TIDAK_TERSEDIA', 'PERINGATAN', 'Ukuran tidak tersedia untuk item',
         'Perlu keputusan manual: ganti ukuran, pesan khusus, atau ganti item.', n, '/karyawan?filter=ukuran', 4
  from size_invalid where n > 0
  union all
  select 'UKURAN_KOSONG', 'PERINGATAN', 'Karyawan belum punya data ukuran',
         'Tagih ke PPM sebelum cutoff berikutnya.', n, '/karyawan?filter=ukuran', 5
  from size_kosong where n > 0
  union all
  select 'STOK_AWAL_BELUM', 'INFO', 'Stok awal belum diinput',
         'Lakukan stock opname pertama untuk membentuk saldo awal (OPENING).', 1, '/opname', 6
  from opening where not opening.ada
) a;

create view seragam.v_kpi_current with (security_invoker = true) as
with
el as materialized (select status, outstanding_total, jabatan_unmapped from seragam.v_employee_list),
st as materialized (select active, available from seragam.v_stock_sku),
o as materialized (select nik, outstanding from seragam.v_outstanding)
select
  (select count(*) from el where status = 'AKTIF')::int as karyawan_aktif,
  (select count(*) from el where status = 'OFFERING')::int as joiner_offering,
  (select count(*) from el where status = 'AKTIF' and outstanding_total = 0 and not jabatan_unmapped)::int as aktif_lengkap,
  (select count(*) from st where active and available <= 0)::int as sku_stockout,
  (select count(*) from st where active)::int as sku_aktif,
  (select coalesce(sum(outstanding), 0) from o)::int as total_outstanding_pcs,
  (select count(distinct nik) from o)::int as karyawan_outstanding,
  (select max(committed_at) from seragam.import_log where status = 'COMMITTED') as import_terakhir;

-- Kepatuhan import PPM 6 bulan terakhir (KPI "Kepatuhan data PPM").
create view seragam.v_kpi_import_monthly with (security_invoker = true) as
select m.periode::date as periode,
       exists (select 1 from seragam.v_import_log il
                where il.status = 'COMMITTED' and il.periode = m.periode::date and il.tepat_waktu) as tepat_waktu,
       exists (select 1 from seragam.import_log il
                where il.status = 'COMMITTED' and il.periode = m.periode::date) as ada_import
from generate_series(date_trunc('month', current_date) - interval '5 months',
                     date_trunc('month', current_date), interval '1 month') as m(periode);

-- Baris staging import untuk layar preview (diff_types sebagai text[]).
create view seragam.v_import_staging with (security_invoker = true) as
select s.import_id, s.row_no, s.nik, s.data, s.errors, s.warnings, s.diff_types::text[] as diff_types, s.diff_detail,
       case when jsonb_array_length(s.errors) > 0 then 'ERROR'
            when jsonb_array_length(s.warnings) > 0 then 'PERINGATAN'
            else 'OK' end as hasil
from seragam.import_staging s;
