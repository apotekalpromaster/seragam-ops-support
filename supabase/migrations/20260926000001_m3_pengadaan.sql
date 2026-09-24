-- =====================================================================
-- Migration M3: Stok & Pengadaan (PRD §6, §7.5, AC #6)
--
-- - Purchase order per vendor: DRAFT → dikirim ke vendor → diterima
--   (bisa bertahap) → selesai. Penerimaan = ledger IN (+ LAYAK).
-- - Status PRD (SENT/PARTIAL/RECEIVED) DIHITUNG dari ledger, bukan
--   disimpan: bila transaksi IN dikoreksi (REVERSAL), status ikut benar.
-- - v_sku_planning: AvgDemand, SafetyStock, ROP, PipelineDemand,
--   SuggestedOrder (dibulatkan ke atas ke kelipatan MOQ), status
--   KRITIS / ORDER / AMAN.
-- =====================================================================

insert into seragam.config (key, value, type, label, description, grup, sort_order) values
  ('default_lead_time_days', '30', 'int', 'Lead time default (hari)',
   'Dipakai bila SKU dan vendornya belum punya lead time.', 'Perencanaan stok', 60)
on conflict (key) do nothing;

-- ---------- Tabel ----------
create table seragam.purchase_order (
  id            bigint generated always as identity primary key,
  kode          text not null unique,
  vendor_id     bigint not null references seragam.vendor (id),
  tanggal       date not null default current_date,
  eta           date,
  -- Tahap yang diputuskan pengguna. Diterima sebagian/lengkap dihitung di v_po.
  fase          text not null default 'DRAFT' check (fase in ('DRAFT', 'DIKIRIM', 'DIBATALKAN', 'DITUTUP')),
  catatan       text,
  sent_at       date,
  sent_by       uuid,
  closed_at     timestamptz,
  closed_by     uuid,
  alasan_tutup  text,
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  alasan_batal  text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index on seragam.purchase_order (fase);

create table seragam.po_line (
  po_id     bigint not null references seragam.purchase_order (id) on delete cascade,
  sku_code  text not null references seragam.sku (sku_code),
  qty_order int not null check (qty_order > 0),
  harga     numeric(14, 2) check (harga >= 0),
  saran     int,  -- saran order saat PO dibuat (jejak keputusan)
  primary key (po_id, sku_code)
);

create table seragam.po_receipt (
  id             bigint generated always as identity primary key,
  po_id          bigint not null references seragam.purchase_order (id),
  tanggal        date not null,
  no_surat_jalan text,
  catatan        text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index on seragam.po_receipt (po_id);

alter table seragam.ledger add column receipt_id bigint references seragam.po_receipt (id);
alter table seragam.ledger add constraint ledger_po_fk foreign key (po_id) references seragam.purchase_order (id);
create index on seragam.ledger (po_id) where po_id is not null;
create index on seragam.ledger (reversal_of) where reversal_of is not null;

-- ---------- Ledger: tambah parameter PO & penerimaan ----------
drop function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type, bigint);
create function seragam._ledger_insert(
  p_tx seragam.tx_type, p_sku text, p_qty int, p_status seragam.stock_status,
  p_nik text default null, p_reason text default null, p_ref text default null,
  p_tanggal date default current_date, p_opname bigint default null,
  p_affects_stock boolean default true, p_reversal_of bigint default null, p_reversed_tx seragam.tx_type default null,
  p_batch bigint default null, p_po bigint default null, p_receipt bigint default null)
returns bigint language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint; v_onhand int;
begin
  if p_qty = 0 then return null; end if;
  if p_affects_stock and p_qty < 0 then
    select coalesce(sum(qty), 0) into v_onhand from seragam.ledger
     where sku_code = p_sku and stock_status = p_status and affects_stock;
    if v_onhand + p_qty < 0 then
      raise exception 'STOK_TIDAK_CUKUP: Stok % (%) hanya %, tidak bisa dikurangi %.', p_sku, p_status, v_onhand, -p_qty;
    end if;
  end if;
  insert into seragam.ledger (tanggal, tx_type, sku_code, qty, stock_status, nik, reason, ref_doc, opname_id, batch_id,
                              po_id, receipt_id, unit_price, affects_stock, reversal_of, reversed_tx_type, created_by)
  values (p_tanggal, p_tx, p_sku, p_qty, p_status, p_nik, p_reason, p_ref, p_opname, p_batch,
          p_po, p_receipt, (select price from seragam.v_sku_price_current where sku_code = p_sku),
          p_affects_stock, p_reversal_of, p_reversed_tx, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------- View PO ----------
-- Qty diterima per PO × SKU = IN dikurangi koreksinya (REVERSAL merujuk baris IN).
create view seragam.v_po_received with (security_invoker = true) as
select l.po_id, l.sku_code, sum(l.qty + coalesce(r.qty, 0))::int as qty
from seragam.ledger l
left join seragam.ledger r on r.reversal_of = l.id
where l.tx_type = 'IN' and l.po_id is not null
group by l.po_id, l.sku_code;

create view seragam.v_po_line with (security_invoker = true) as
select pl.po_id, po.kode as po_kode, po.fase, pl.sku_code, s.label as sku_label, s.item_code, s.item_nama, s.item_sort,
       s.gender, s.size_code, s.size_order, s.moq,
       pl.qty_order, coalesce(rc.qty, 0) as qty_received,
       greatest(pl.qty_order - coalesce(rc.qty, 0), 0) as sisa,
       pl.harga, (pl.qty_order * pl.harga)::numeric(16, 2) as nilai, pl.saran
from seragam.po_line pl
join seragam.purchase_order po on po.id = pl.po_id
join seragam.v_sku s on s.sku_code = pl.sku_code
left join seragam.v_po_received rc on rc.po_id = pl.po_id and rc.sku_code = pl.sku_code;

create view seragam.v_po with (security_invoker = true) as
select po.*, v.nama as vendor_nama, v.kontak as vendor_kontak,
       u.nama as created_by_nama, us.nama as sent_by_nama,
       coalesce(a.jumlah_sku, 0) as jumlah_sku, coalesce(a.qty_order, 0) as qty_order,
       coalesce(a.qty_received, 0) as qty_received, coalesce(a.sisa, 0) as sisa, coalesce(a.nilai, 0) as nilai,
       (select count(*) from seragam.po_receipt r where r.po_id = po.id)::int as jumlah_penerimaan,
       (select max(r.tanggal) from seragam.po_receipt r where r.po_id = po.id) as terakhir_diterima,
       case
         when po.fase = 'DRAFT' then 'DRAFT'
         when po.fase = 'DIBATALKAN' then 'CANCELLED'
         when po.fase = 'DITUTUP' or coalesce(a.sisa, 0) = 0 then 'RECEIVED'
         when coalesce(a.qty_received, 0) > 0 then 'PARTIAL'
         else 'SENT'
       end as status,
       (po.fase = 'DITUTUP' and coalesce(a.sisa, 0) > 0) as ditutup_kurang,
       (po.fase = 'DIKIRIM' and coalesce(a.sisa, 0) > 0 and po.eta < current_date) as terlambat
from seragam.purchase_order po
join seragam.vendor v on v.id = po.vendor_id
left join seragam.app_user u on u.user_id = po.created_by
left join seragam.app_user us on us.user_id = po.sent_by
left join (
  select po_id, count(*)::int as jumlah_sku, sum(qty_order)::int as qty_order, sum(qty_received)::int as qty_received,
         sum(sisa)::int as sisa, sum(nilai)::numeric(16, 2) as nilai
  from seragam.v_po_line group by po_id
) a on a.po_id = po.id;

create view seragam.v_po_receipt with (security_invoker = true) as
select r.*, u.nama as created_by_nama, po.kode as po_kode,
       coalesce(sum(l.qty), 0)::int as pcs,
       coalesce(jsonb_agg(jsonb_build_object('sku_code', l.sku_code, 'label', s.label, 'qty', l.qty, 'ledger_id', l.id,
                                             'dikoreksi', exists (select 1 from seragam.ledger x where x.reversal_of = l.id))
                          order by s.item_sort, s.gender, s.size_order) filter (where l.id is not null), '[]') as lines
from seragam.po_receipt r
join seragam.purchase_order po on po.id = r.po_id
left join seragam.app_user u on u.user_id = r.created_by
left join seragam.ledger l on l.receipt_id = r.id and l.tx_type = 'IN'
left join seragam.v_sku s on s.sku_code = l.sku_code
group by r.id, u.nama, po.kode;

-- OnOrder = sisa PO yang sudah dikirim ke vendor. Qty di PO draft ditampilkan terpisah
-- supaya tidak dipesan dua kali, tetapi tidak mengurangi saran order (PRD §6).
create view seragam.v_on_order with (security_invoker = true) as
select sku_code,
       coalesce(sum(sisa) filter (where fase = 'DIKIRIM'), 0)::int as on_order,
       coalesce(sum(qty_order) filter (where fase = 'DRAFT'), 0)::int as qty_po_draft
from seragam.v_po_line
where fase in ('DIKIRIM', 'DRAFT')
group by sku_code;

-- ---------- Perencanaan stok per SKU (PRD §6) ----------
-- AvgDemand: rata-rata bulanan (ISSUE + SALE + EXC_OUT, dikurangi koreksinya) dalam
--   demand_window_months. Bila histori sistem lebih pendek dari jendela, pembagi = jumlah
--   bulan sejak transaksi keluar pertama (min. 1) supaya bulan awal tidak diremehkan.
-- Fallback SKU tanpa histori: rencana hire/bulan × rata-rata qty item per karyawan
--   (per gender untuk item gender-specific) × proporsi size curve.
-- PipelineDemand: sisa antrian (outstanding − yang sudah di batch terbuka) dengan ukuran valid,
--   termasuk joiner dan karyawan cabang baru yang sudah ada di data PPM. Yang sudah di batch
--   terbuka tidak dihitung lagi karena sudah mengurangi Available (reserved).
-- Kebutuhan order dibulatkan ke pcs terdekat SEBELUM dibulatkan ke atas ke kelipatan MOQ, dan
--   SS/ROP di bawah 0,5 pcs tidak memicu status: SKU dengan perkiraan sangat kecil (mis. 5XL,
--   0,04 pcs/bulan) tidak otomatis disarankan order satu MOQ penuh.
create view seragam.v_sku_planning with (security_invoker = true) as
with
cfg as materialized (
  select seragam.cfg_num('ss_months', 0.5) as ss_m, seragam.cfg_num('cover_months', 2) as cover_m,
         seragam.cfg_int('planned_hires_per_month', 50) as hires, seragam.cfg_int('demand_window_months', 6) as w,
         seragam.cfg_int('default_lead_time_days', 30) as lt
),
first_out as materialized (
  select min(tanggal) as d from seragam.ledger where tx_type in ('ISSUE', 'SALE', 'EXC_OUT')
),
win as materialized (
  select greatest(1, least(cfg.w,
           coalesce((date_part('year', age(current_date, f.d)) * 12 + date_part('month', age(current_date, f.d)))::int + 1, 1)))::int as m
  from cfg, first_out f
),
hist as materialized (
  select l.sku_code, sum(-l.qty)::int as q
  from seragam.ledger l, win
  where (l.tx_type in ('ISSUE', 'SALE', 'EXC_OUT') or (l.tx_type = 'REVERSAL' and l.reversed_tx_type in ('ISSUE', 'SALE', 'EXC_OUT')))
    and l.tanggal > current_date - make_interval(months => win.m)
  group by l.sku_code
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
base as (
  select st.sku_code, st.item_code, st.item_nama, st.gender, st.size_code, st.size_order, st.label, st.item_sort,
         st.price, st.active, st.layak, st.karantina, st.cadangan, st.afkir, st.reserved, st.available,
         sk.vendor_id, sk.vendor_nama, coalesce(sk.lead_time_days, cfg.lt) as lead_time_days, sk.moq,
         coalesce(oo.on_order, 0) as on_order, coalesce(oo.qty_po_draft, 0) as qty_po_draft,
         coalesce(pipe.q, 0) as pipeline_demand,
         coalesce(h.q, 0) as demand_histori, win.m as demand_bulan,
         case when coalesce(h.q, 0) > 0 then h.q::numeric / win.m
              else cfg.hires * coalesce(qph.q, 0) * coalesce(sc.proporsi, 0) end as avg_raw,
         case when coalesce(h.q, 0) > 0 then 'HISTORI'
              when coalesce(qph.q, 0) * coalesce(sc.proporsi, 0) > 0 then 'SIZE_CURVE'
              else 'TIDAK_ADA' end as demand_sumber,
         cfg.ss_m, cfg.cover_m
  from st
  cross join cfg
  cross join win
  join sk on sk.sku_code = st.sku_code
  left join oo on oo.sku_code = st.sku_code
  left join pipe on pipe.sku_code = st.sku_code
  left join hist h on h.sku_code = st.sku_code
  left join qph on qph.item_code = st.item_code and qph.sku_gender = st.gender
  left join seragam.size_curve sc on sc.item_code = st.item_code and sc.gender = st.gender and sc.size_code = st.size_code
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
       end as status
from calc c;

-- ---------- Alert: SKU KRITIS / ORDER & PO terlambat menggantikan "stok kurang" ----------
create or replace view seragam.v_alert with (security_invoker = true) as
with
outs as materialized (
  select nik, item_code, sku_target, size_status, outstanding from seragam.v_outstanding
),
unmapped as materialized (select count(*)::int n, coalesce(sum(jumlah_karyawan), 0)::int k from seragam.v_unmapped_position),
size_kosong as materialized (select count(distinct nik)::int n from outs where size_status = 'KOSONG'),
size_invalid as materialized (select count(distinct nik)::int n from outs where size_status = 'TIDAK_TERSEDIA'),
plan as materialized (select status from seragam.v_sku_planning where active),
kritis as materialized (select count(*)::int n from plan where status = 'KRITIS'),
perlu_order as materialized (select count(*)::int n from plan where status = 'ORDER'),
po_telat as materialized (select count(*)::int n from seragam.v_po where terlambat),
imp as materialized (
  select exists (
    select 1 from seragam.import_log
    where status = 'COMMITTED' and periode = date_trunc('month', current_date)::date
  ) as sudah
),
opening as materialized (select exists (select 1 from seragam.ledger where tx_type = 'OPENING') as ada),
telat as materialized (
  select count(*)::int n from seragam.batch
  where status in ('DRAFT', 'PICKING', 'PACKED') and current_date > deadline_kirim
),
late_hire as materialized (
  select count(distinct o.nik)::int n
  from outs o
  join seragam.employee e on e.nik = o.nik and e.is_late_hire
  left join seragam.v_in_batch ib on ib.nik = o.nik and ib.item_code = o.item_code
  where o.outstanding - coalesce(ib.qty, 0) > 0
)
select * from (
  select 'IMPORT_TERLAMBAT' as kode, 'KRITIS' as level,
         'Import data PPM bulan ini belum dilakukan' as judul,
         'Lewat tanggal cutoff (' || seragam.cfg_int('cutoff_day', 5) || '). Antrian alokasi memakai data lama.' as detail,
         1 as jumlah, '/import' as link, 1 as urutan
  from imp where not imp.sudah and extract(day from current_date) > seragam.cfg_int('cutoff_day', 5)
  union all
  select 'BATCH_TERLAMBAT', 'KRITIS', 'Batch melewati deadline kirim',
         'Batch belum berstatus dikirim padahal deadline sudah lewat.', n, '/batch', 2
  from telat where n > 0
  union all
  select 'SKU_KRITIS', 'KRITIS', 'SKU berstatus kritis',
         'Available tidak cukup untuk antrian atau sudah di bawah safety stock. Buat PO dari saran order.', n, '/pengadaan?status=KRITIS', 3
  from kritis where n > 0
  union all
  select 'SKU_ORDER', 'PERINGATAN', 'SKU sudah mencapai titik pesan ulang',
         'Available + dalam pemesanan ≤ ROP. Pesan sekarang supaya barang datang sebelum habis.', n, '/pengadaan?status=ORDER', 4
  from perlu_order where n > 0
  union all
  select 'PO_TERLAMBAT', 'PERINGATAN', 'PO melewati perkiraan tiba',
         'Barang belum diterima lengkap padahal ETA sudah lewat. Hubungi vendor.', n, '/pengadaan?tab=po&status=terlambat', 5
  from po_telat where n > 0
  union all
  select 'JABATAN_BELUM_DIMAPPING', 'PERINGATAN', 'Jabatan belum dimapping ke paket',
         k || ' karyawan tidak masuk antrian sampai jabatannya dimapping.', n, '/master/jabatan', 6
  from unmapped where n > 0
  union all
  select 'UKURAN_TIDAK_TERSEDIA', 'PERINGATAN', 'Ukuran tidak tersedia untuk item',
         'Perlu keputusan manual: ganti ukuran, pesan khusus, atau ganti item.', n, '/antrian?tab=tidak_tersedia', 7
  from size_invalid where n > 0
  union all
  select 'UKURAN_KOSONG', 'PERINGATAN', 'Karyawan belum punya data ukuran',
         'Tagih ke PPM sebelum cutoff berikutnya.', n, '/antrian?tab=menunggu_ukuran', 8
  from size_kosong where n > 0
  union all
  select 'HIRE_MENDADAK', 'INFO', 'Hire mendadak menunggu batch ad-hoc',
         'Buat batch ad-hoc dengan cakupan "Hire mendadak".', n, '/antrian?hire=1', 9
  from late_hire where n > 0
  union all
  select 'STOK_AWAL_BELUM', 'INFO', 'Stok awal belum diinput',
         'Lakukan stock opname pertama untuk membentuk saldo awal (OPENING).', 1, '/opname', 10
  from opening where not opening.ada
) a;

-- ---------- RPC PO ----------
-- Validasi & normalisasi baris PO. Mengembalikan baris bersih; error = exception.
create or replace function seragam._po_lines(p_lines jsonb)
returns table (sku_code text, qty int, harga numeric, saran int)
language plpgsql stable security definer set search_path = seragam, public as $$
declare r jsonb; v_sku text; v_qty int; seen text[] := '{}';
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDASI: PO harus berisi minimal satu SKU.';
  end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    v_sku := upper(trim(r ->> 'sku_code'));
    if not exists (select 1 from seragam.v_sku s where s.sku_code = v_sku and s.active) then
      raise exception 'VALIDASI: SKU % tidak dikenal atau nonaktif.', coalesce(v_sku, '(kosong)');
    end if;
    if v_sku = any (seen) then raise exception 'VALIDASI: SKU % tercantum lebih dari sekali.', v_sku; end if;
    seen := seen || v_sku;
    begin
      v_qty := (r ->> 'qty')::int;
    exception when others then
      raise exception 'VALIDASI: Qty % harus bilangan bulat.', v_sku;
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'VALIDASI: Qty % harus lebih dari 0.', v_sku; end if;
    if (r ->> 'harga') is not null and (r ->> 'harga')::numeric < 0 then
      raise exception 'VALIDASI: Harga % tidak boleh negatif.', v_sku;
    end if;
    sku_code := v_sku; qty := v_qty;
    harga := coalesce((r ->> 'harga')::numeric, (select price from seragam.v_sku_price_current c where c.sku_code = v_sku));
    saran := (r ->> 'saran')::int;
    return next;
  end loop;
end $$;

create or replace function seragam._po_get(p_id bigint, p_lock boolean default true)
returns seragam.purchase_order language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order;
begin
  if p_lock then
    select * into po from seragam.purchase_order where id = p_id for update;
  else
    select * into po from seragam.purchase_order where id = p_id;
  end if;
  if not found then raise exception 'TIDAK_DITEMUKAN: PO tidak ditemukan.'; end if;
  return po;
end $$;

-- {pos: [{vendor_id, tanggal?, eta?, catatan?, lines: [{sku_code, qty, harga?, saran?}]}]}
-- Semua PO dibuat atau tidak sama sekali. Status awal DRAFT.
create or replace function seragam.fn_po_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare x jsonb; v_vendor seragam.vendor; v_tgl date; v_eta date; v_id bigint; v_kode text; v_n int;
        ids jsonb := '[]'; kodes jsonb := '[]';
begin
  perform seragam.require_role('admin');
  if p -> 'pos' is null or jsonb_array_length(p -> 'pos') = 0 then raise exception 'KOSONG: Tidak ada PO yang dibuat.'; end if;
  for x in select * from jsonb_array_elements(p -> 'pos') loop
    select * into v_vendor from seragam.vendor where id = (x ->> 'vendor_id')::bigint;
    if not found then raise exception 'VALIDASI: Pilih vendor untuk setiap PO.'; end if;
    if not v_vendor.active then raise exception 'VALIDASI: Vendor % nonaktif.', v_vendor.nama; end if;
    v_tgl := coalesce(seragam.try_date(x ->> 'tanggal'), current_date);
    v_eta := seragam.try_date(x ->> 'eta');
    if v_eta is not null and v_eta < v_tgl then raise exception 'VALIDASI: Perkiraan tiba (%) tidak boleh sebelum tanggal PO.', v_eta; end if;
    select coalesce(max(substring(kode from '\d+$')::int), 0) + 1 into v_n
    from seragam.purchase_order where kode like 'PO-' || to_char(v_tgl, 'YYYYMM') || '-%';
    v_kode := 'PO-' || to_char(v_tgl, 'YYYYMM') || '-' || lpad(v_n::text, 3, '0');
    insert into seragam.purchase_order (kode, vendor_id, tanggal, eta, catatan, created_by)
    values (v_kode, v_vendor.id, v_tgl, v_eta, nullif(trim(x ->> 'catatan'), ''), auth.uid())
    returning id into v_id;
    insert into seragam.po_line (po_id, sku_code, qty_order, harga, saran)
    select v_id, l.sku_code, l.qty, l.harga, l.saran from seragam._po_lines(x -> 'lines') l;
    perform seragam.write_audit('PO_BUAT', 'purchase_order', v_kode, null, x);
    ids := ids || to_jsonb(v_id); kodes := kodes || to_jsonb(v_kode);
  end loop;
  return jsonb_build_object('ok', true, 'ids', ids, 'kode', kodes);
end $$;

-- Ubah PO draft: {id, eta?, catatan?, lines}
create or replace function seragam.fn_po_update(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order; v_eta date;
begin
  perform seragam.require_role('admin');
  po := seragam._po_get((p ->> 'id')::bigint);
  if po.fase <> 'DRAFT' then raise exception 'STATUS: Hanya PO draft yang bisa diubah. Kembalikan ke draft dulu bila belum ada barang diterima.'; end if;
  v_eta := seragam.try_date(p ->> 'eta');
  if v_eta is not null and v_eta < po.tanggal then raise exception 'VALIDASI: Perkiraan tiba tidak boleh sebelum tanggal PO.'; end if;
  create temp table _pl on commit drop as select * from seragam._po_lines(p -> 'lines');
  delete from seragam.po_line where po_id = po.id;
  insert into seragam.po_line (po_id, sku_code, qty_order, harga, saran) select po.id, l.sku_code, l.qty, l.harga, l.saran from _pl l;
  update seragam.purchase_order set eta = v_eta, catatan = nullif(trim(p ->> 'catatan'), '') where id = po.id;
  perform seragam.write_audit('PO_UBAH', 'purchase_order', po.kode, null, p);
  drop table _pl;
  return jsonb_build_object('ok', true);
end $$;

-- Kirim ke vendor: {id, tanggal?} → OnOrder mulai dihitung.
create or replace function seragam.fn_po_send(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order; v_tgl date; v_lt int;
begin
  perform seragam.require_role('admin');
  po := seragam._po_get((p ->> 'id')::bigint);
  if po.fase <> 'DRAFT' then raise exception 'STATUS: PO % sudah tidak berstatus draft.', po.kode; end if;
  if not exists (select 1 from seragam.po_line where po_id = po.id) then raise exception 'VALIDASI: PO belum berisi SKU.'; end if;
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal kirim tidak boleh di masa depan.'; end if;
  if v_tgl < po.tanggal then raise exception 'VALIDASI: Tanggal kirim tidak boleh sebelum tanggal PO (%).', po.tanggal; end if;
  select max(coalesce(s.lead_time_days, seragam.cfg_int('default_lead_time_days', 30))) into v_lt
  from seragam.po_line pl join seragam.v_sku s on s.sku_code = pl.sku_code where pl.po_id = po.id;
  update seragam.purchase_order
     set fase = 'DIKIRIM', sent_at = v_tgl, sent_by = auth.uid(), eta = coalesce(eta, v_tgl + v_lt)
   where id = po.id;
  perform seragam.write_audit('PO_KIRIM', 'purchase_order', po.kode, null, jsonb_build_object('tanggal', v_tgl));
  return jsonb_build_object('ok', true, 'eta', coalesce(po.eta, v_tgl + v_lt));
end $$;

-- Kembali ke draft (belum ada barang diterima).
create or replace function seragam.fn_po_unsend(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order;
begin
  perform seragam.require_role('admin');
  po := seragam._po_get((p ->> 'id')::bigint);
  if po.fase <> 'DIKIRIM' then raise exception 'STATUS: PO % tidak sedang dikirim ke vendor.', po.kode; end if;
  if exists (select 1 from seragam.po_receipt where po_id = po.id) then
    raise exception 'STATUS: PO % sudah ada penerimaan barang; tidak bisa kembali ke draft. Gunakan "Tutup PO" bila sisa tidak akan dikirim.', po.kode;
  end if;
  update seragam.purchase_order set fase = 'DRAFT', sent_at = null, sent_by = null where id = po.id;
  perform seragam.write_audit('PO_DRAFT', 'purchase_order', po.kode, null, null);
  return jsonb_build_object('ok', true);
end $$;

-- Batalkan: {id, alasan} — hanya bila belum ada barang diterima.
create or replace function seragam.fn_po_cancel(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order;
begin
  perform seragam.require_role('admin');
  po := seragam._po_get((p ->> 'id')::bigint);
  if po.fase not in ('DRAFT', 'DIKIRIM') then raise exception 'STATUS: PO % sudah selesai atau dibatalkan.', po.kode; end if;
  if exists (select 1 from seragam.po_receipt where po_id = po.id) then
    raise exception 'STATUS: PO % sudah ada penerimaan barang. Gunakan "Tutup PO" untuk menghentikan sisa pesanan.', po.kode;
  end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 3 then raise exception 'VALIDASI: Alasan pembatalan wajib diisi.'; end if;
  update seragam.purchase_order
     set fase = 'DIBATALKAN', cancelled_at = now(), cancelled_by = auth.uid(), alasan_batal = trim(p ->> 'alasan')
   where id = po.id;
  perform seragam.write_audit('PO_BATAL', 'purchase_order', po.kode, null, jsonb_build_object('alasan', trim(p ->> 'alasan')));
  return jsonb_build_object('ok', true);
end $$;

-- Tutup PO yang sudah diterima sebagian: sisa tidak dikirim vendor. {id, alasan}
create or replace function seragam.fn_po_close(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order; v_sisa int;
begin
  perform seragam.require_role('admin');
  po := seragam._po_get((p ->> 'id')::bigint);
  if po.fase <> 'DIKIRIM' then raise exception 'STATUS: Hanya PO yang sedang berjalan yang bisa ditutup.'; end if;
  select coalesce(sum(sisa), 0) into v_sisa from seragam.v_po_line where po_id = po.id;
  if v_sisa = 0 then raise exception 'STATUS: PO % sudah diterima lengkap.', po.kode; end if;
  if not exists (select 1 from seragam.po_receipt where po_id = po.id) then
    raise exception 'STATUS: Belum ada barang diterima. Gunakan "Batalkan PO".';
  end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 3 then raise exception 'VALIDASI: Alasan penutupan wajib diisi.'; end if;
  update seragam.purchase_order
     set fase = 'DITUTUP', closed_at = now(), closed_by = auth.uid(), alasan_tutup = trim(p ->> 'alasan')
   where id = po.id;
  perform seragam.write_audit('PO_TUTUP', 'purchase_order', po.kode, null, jsonb_build_object('alasan', trim(p ->> 'alasan'), 'sisa', v_sisa));
  return jsonb_build_object('ok', true, 'sisa_dilepas', v_sisa);
end $$;

-- Terima barang (bisa sebagian): {id, tanggal, no_surat_jalan?, catatan?, lines: [{sku_code, qty}]}
-- Setiap SKU → ledger IN (+ LAYAK). Qty tidak boleh melebihi sisa pesanan.
create or replace function seragam.fn_po_receive(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare po seragam.purchase_order; v_tgl date; r jsonb; v_sku text; v_qty int; v_sisa int;
        v_rid bigint; v_pcs int := 0; v_ref text; v_status text;
begin
  perform seragam.require_role('admin', 'staf');
  po := seragam._po_get((p ->> 'id')::bigint);
  if po.fase <> 'DIKIRIM' then
    raise exception 'STATUS: PO % tidak sedang menunggu barang (%).', po.kode,
      case po.fase when 'DRAFT' then 'masih draft — kirim ke vendor dulu' when 'DIBATALKAN' then 'dibatalkan' else 'sudah ditutup' end;
  end if;
  v_tgl := seragam.try_date(p ->> 'tanggal');
  if v_tgl is null then raise exception 'VALIDASI: Tanggal terima wajib diisi.'; end if;
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal terima tidak boleh di masa depan.'; end if;
  if v_tgl < po.sent_at then raise exception 'VALIDASI: Tanggal terima tidak boleh sebelum PO dikirim ke vendor (%).', po.sent_at; end if;

  insert into seragam.po_receipt (po_id, tanggal, no_surat_jalan, catatan, created_by)
  values (po.id, v_tgl, nullif(trim(p ->> 'no_surat_jalan'), ''), nullif(trim(p ->> 'catatan'), ''), auth.uid())
  returning id into v_rid;
  v_ref := coalesce('SJ ' || nullif(trim(p ->> 'no_surat_jalan'), ''), po.kode);

  for r in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    v_sku := upper(trim(r ->> 'sku_code'));
    begin
      v_qty := coalesce((r ->> 'qty')::int, 0);
    exception when others then
      raise exception 'VALIDASI: Qty % harus bilangan bulat.', v_sku;
    end;
    if v_qty = 0 then continue; end if;
    if v_qty < 0 then raise exception 'VALIDASI: Qty % tidak boleh negatif. Koreksi penerimaan lewat Riwayat transaksi.', v_sku; end if;
    select l.sisa into v_sisa from seragam.v_po_line l where l.po_id = po.id and l.sku_code = v_sku;
    if not found then raise exception 'VALIDASI: SKU % tidak ada di PO %.', v_sku, po.kode; end if;
    if v_qty > v_sisa then
      raise exception 'VALIDASI: Qty % (%) melebihi sisa pesanan (%). Kelebihan dari vendor tidak dicatat sebagai penerimaan PO ini.', v_sku, v_qty, v_sisa;
    end if;
    perform seragam._ledger_insert('IN', v_sku, v_qty, 'LAYAK', null, 'Terima ' || po.kode, v_ref, v_tgl,
                                   null, true, null, null, null, po.id, v_rid);
    v_pcs := v_pcs + v_qty;
  end loop;
  if v_pcs = 0 then raise exception 'KOSONG: Isi qty diterima minimal untuk satu SKU.'; end if;

  select status into v_status from seragam.v_po where id = po.id;
  perform seragam.write_audit('PO_TERIMA', 'purchase_order', po.kode, null,
    jsonb_build_object('tanggal', v_tgl, 'pcs', v_pcs, 'no_surat_jalan', p ->> 'no_surat_jalan'));
  return jsonb_build_object('ok', true, 'receipt_id', v_rid, 'pcs', v_pcs, 'status', v_status);
end $$;

-- ---------- RLS & grant untuk objek baru ----------
do $$
declare t text;
begin
  foreach t in array array['purchase_order', 'po_line', 'po_receipt'] loop
    execute format('alter table seragam.%I enable row level security', t);
    execute format('create policy %I on seragam.%I for select to authenticated using (seragam.is_app_user())', t || '_read', t);
  end loop;
end $$;

grant select on all tables in schema seragam to authenticated;
grant execute on all functions in schema seragam to authenticated;
revoke execute on function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type, bigint, bigint, bigint) from authenticated;
revoke execute on function seragam._po_lines(jsonb) from authenticated;
revoke execute on function seragam._po_get(bigint, boolean) from authenticated;
