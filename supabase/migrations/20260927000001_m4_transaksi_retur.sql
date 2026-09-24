-- =====================================================================
-- Migration M4: Transaksi & Retur (PRD §4.3–4.9, §7.6–7.7, §7.10, AC #5, 7, 8, 10, 12)
--
-- - Tukar karena cacat (≤ exchange_window_days sejak ISSUE, alasan CACAT_PRODUKSI /
--   DEVIASI_SPEK_VENDOR, nama atasan): EXC_IN (+KARANTINA) & EXC_OUT (−LAYAK).
-- - Pembelian (potong gaji): SALE (−LAYAK). Tidak dihitung pemenuhan hak & tidak wajib kembali.
-- - Kewajiban retur DIHITUNG (view), bukan disimpan: resign / PKL selesai / batal join /
--   no-show (lewat noshow_grace_days) → seluruh item alokasi netto; karyawan aktif yang
--   menerima di atas hak (mutasi/promosi) → kelebihannya. RET masuk KARANTINA.
-- - QC per asal barang (lot = baris RET/EXC_IN/ADJ/OPENING di KARANTINA): grade A/B/C →
--   QC_MOVE dua baris (−KARANTINA, +tujuan). Grade A barang bekas pakai → CADANGAN bila
--   allow_reissue_grade_a = false; barang batal join/no-show (belum dipakai) → LAYAK.
-- - Afkir → DISPOSE dengan catatan pemusnahan logo.
-- =====================================================================

-- ---------- Tabel ----------
create table seragam.exchange (
  id          bigint generated always as identity primary key,
  kode        text not null unique,
  tanggal     date not null,
  nik         text not null references seragam.employee (nik),
  item_code   text not null references seragam.item (item_code),
  sku_in      text not null references seragam.sku (sku_code),   -- barang cacat yang dikembalikan
  sku_out     text not null references seragam.sku (sku_code),   -- barang pengganti
  qty         int not null check (qty > 0),
  alasan      text not null check (alasan in ('CACAT_PRODUKSI', 'DEVIASI_SPEK_VENDOR')),
  approver    text not null,
  catatan     text,
  issue_date  date not null,  -- tanggal ISSUE acuan batas tukar
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index on seragam.exchange (nik);

create table seragam.sale (
  id             bigint generated always as identity primary key,
  kode           text not null unique,
  tanggal        date not null,
  nik            text not null references seragam.employee (nik),
  periode_potong date not null check (extract(day from periode_potong) = 1),
  catatan        text,
  dibatalkan_at  timestamptz,
  dibatalkan_by  uuid,
  alasan_batal   text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index on seragam.sale (nik);
create index on seragam.sale (periode_potong);

create table seragam.return_receipt (
  id         bigint generated always as identity primary key,
  kode       text not null unique,
  tanggal    date not null,
  nik        text not null references seragam.employee (nik),
  sumber     text not null check (sumber in ('RESIGN', 'PKL_SELESAI', 'BATAL_JOIN', 'NOSHOW', 'MUTASI')),
  catatan    text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on seragam.return_receipt (nik);

-- Penghapusan kewajiban retur (status DIHAPUSKAN, khusus admin). Tidak mengubah stok.
create table seragam.return_writeoff (
  id         bigint generated always as identity primary key,
  nik        text not null references seragam.employee (nik),
  item_code  text not null references seragam.item (item_code),
  qty        int not null check (qty > 0),
  alasan     text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on seragam.return_writeoff (nik, item_code);

alter table seragam.ledger
  add column sale_id     bigint references seragam.sale (id),
  add column exchange_id bigint references seragam.exchange (id),
  add column return_id   bigint references seragam.return_receipt (id),
  add column lot_id      bigint references seragam.ledger (id),  -- QC_MOVE: baris KARANTINA asal
  add column pair_id     bigint references seragam.ledger (id);  -- baris kedua transaksi dua-baris → baris pertama
create index on seragam.ledger (sale_id) where sale_id is not null;
create index on seragam.ledger (lot_id) where lot_id is not null;
create index on seragam.ledger (pair_id) where pair_id is not null;

-- ---------- Ledger: parameter baru ----------
drop function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type, bigint, bigint, bigint);
create function seragam._ledger_insert(
  p_tx seragam.tx_type, p_sku text, p_qty int, p_status seragam.stock_status,
  p_nik text default null, p_reason text default null, p_ref text default null,
  p_tanggal date default current_date, p_opname bigint default null,
  p_affects_stock boolean default true, p_reversal_of bigint default null, p_reversed_tx seragam.tx_type default null,
  p_batch bigint default null, p_po bigint default null, p_receipt bigint default null,
  p_sale bigint default null, p_exchange bigint default null, p_return bigint default null,
  p_lot bigint default null, p_pair bigint default null)
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
                              po_id, receipt_id, sale_id, exchange_id, return_id, lot_id, pair_id,
                              unit_price, affects_stock, reversal_of, reversed_tx_type, created_by)
  values (p_tanggal, p_tx, p_sku, p_qty, p_status, p_nik, p_reason, p_ref, p_opname, p_batch,
          p_po, p_receipt, p_sale, p_exchange, p_return, p_lot, p_pair,
          (select price from seragam.v_sku_price_current where sku_code = p_sku),
          p_affects_stock, p_reversal_of, p_reversed_tx, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Kode dokumen per bulan: PREFIX-YYYYMM-NNN
create or replace function seragam._next_kode(p_prefix text, p_tgl date, p_table text)
returns text language plpgsql security definer set search_path = seragam, public as $$
declare v_n int; v_pre text := p_prefix || '-' || to_char(p_tgl, 'YYYYMM') || '-';
begin
  execute format('select coalesce(max(substring(kode from ''\d+$'')::int), 0) + 1 from seragam.%I where kode like $1', p_table)
    into v_n using v_pre || '%';
  return v_pre || lpad(v_n::text, 3, '0');
end $$;

-- ---------- View pendukung ----------
-- ISSUE terakhir (yang tidak dikoreksi) per karyawan × item: acuan batas tukar & SKU default retur.
create view seragam.v_issue_last with (security_invoker = true) as
select distinct on (l.nik, s.item_code) l.nik, s.item_code, l.sku_code, l.tanggal, l.id as ledger_id
from seragam.ledger l
join seragam.sku s on s.sku_code = l.sku_code
where l.tx_type = 'ISSUE' and l.nik is not null
  and not exists (select 1 from seragam.ledger r where r.reversal_of = l.id)
order by l.nik, s.item_code, l.tanggal desc, l.id desc;

-- Kewajiban retur karyawan yang keluar (murah dihitung; dipakai juga oleh alert).
create view seragam.v_return_leaver with (security_invoker = true) as
with
cfg as materialized (select seragam.cfg_int('noshow_grace_days', 7) as grace),
wo as materialized (select nik, item_code, sum(qty)::int as q from seragam.return_writeoff group by nik, item_code),
leaver as materialized (
  select e.nik,
         case when e.status = 'RESIGN' and e.is_loan then 'PKL_SELESAI'
              when e.status = 'RESIGN' then 'RESIGN'
              when e.status = 'BATAL_JOIN' then 'BATAL_JOIN'
              else 'NOSHOW' end as sumber,
         case when e.status = 'RESIGN' then coalesce(e.resign_date, e.planned_resign_date, e.updated_at::date)
              -- tanggal batal join diketahui (import PPM), bukan rencana join yang bisa di masa depan
              when e.status = 'BATAL_JOIN' then coalesce(
                (select max(il.committed_at)::date from seragam.import_diff d join seragam.import_log il on il.id = d.import_id
                  where d.nik = e.nik and d.change_type = 'BATAL_JOIN' and il.status = 'COMMITTED'), e.updated_at::date)
              else e.planned_join_date + cfg.grace end as tanggal_acuan
  from seragam.employee e, cfg
  where e.status in ('RESIGN', 'BATAL_JOIN')
     or (e.status = 'OFFERING' and e.join_date is null and e.planned_join_date + cfg.grace < current_date)
)
select l.nik, l.sumber, l.tanggal_acuan, i.item_code,
       (i.issued - i.returned) as wajib_sekarang, i.returned as dikembalikan, coalesce(wo.q, 0) as dihapuskan
from leaver l
join seragam.v_issued i on i.nik = l.nik
left join wo on wo.nik = l.nik and wo.item_code = i.item_code
where i.issued - i.returned > 0 or i.returned > 0 or wo.q > 0;

-- Semua kewajiban retur: karyawan keluar + kelebihan hak karyawan aktif (mutasi/promosi).
create view seragam.v_return_obligation with (security_invoker = true) as
with
wo as materialized (select nik, item_code, sum(qty)::int as q from seragam.return_writeoff group by nik, item_code),
lv as materialized (select * from seragam.v_return_leaver),
mut as materialized (
  select ei.nik, 'MUTASI'::text as sumber,
         (select max(il.committed_at)::date from seragam.import_diff d join seragam.import_log il on il.id = d.import_id
           where d.nik = ei.nik and d.change_type = 'MUTASI_JABATAN' and il.status = 'COMMITTED') as tanggal_acuan,
         ei.item_code, ei.over_issued as wajib_sekarang,
         coalesce((select i.returned from seragam.v_issued i where i.nik = ei.nik and i.item_code = ei.item_code), 0) as dikembalikan,
         coalesce(wo.q, 0) as dihapuskan
  -- OFFSET 0: jangan dorong filter over_issued ke perhitungan hak (lihat v_queue).
  from (select * from seragam.v_employee_item offset 0) ei
  join seragam.employee e on e.nik = ei.nik and e.status in ('AKTIF', 'OFFERING')
  left join wo on wo.nik = ei.nik and wo.item_code = ei.item_code
  where ei.over_issued > 0 and not exists (select 1 from lv where lv.nik = ei.nik)
),
alls as (select * from lv union all select * from mut)
select o.nik, e.nama, e.jabatan, e.kode_cabang, b.nama as cabang_nama, b.area, e.status as employee_status, e.is_loan,
       o.sumber, o.tanggal_acuan, (current_date - o.tanggal_acuan) as aging_hari,
       o.item_code, it.nama as item_nama, it.sort_order as item_sort,
       il.sku_code, s.label as sku_label, p.price,
       o.wajib_sekarang + o.dikembalikan as wajib,
       o.dikembalikan, o.dihapuskan,
       greatest(0, o.wajib_sekarang - o.dihapuskan) as sisa,
       (greatest(0, o.wajib_sekarang - o.dihapuskan) * coalesce(p.price, 0))::numeric(16, 2) as nilai,
       case when greatest(0, o.wajib_sekarang - o.dihapuskan) = 0 and o.dihapuskan > 0 then 'DIHAPUSKAN'
            when greatest(0, o.wajib_sekarang - o.dihapuskan) = 0 then 'LENGKAP'
            when o.dikembalikan > 0 or o.dihapuskan > 0 then 'SEBAGIAN'
            else 'BELUM' end as status
from alls o
join seragam.employee e on e.nik = o.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
join seragam.item it on it.item_code = o.item_code
left join seragam.v_issue_last il on il.nik = o.nik and il.item_code = o.item_code
left join seragam.v_sku s on s.sku_code = il.sku_code
left join seragam.v_sku_price_current p on p.sku_code = il.sku_code;

-- Ringkasan per karyawan untuk layar Resign & Pengembalian.
create view seragam.v_return_employee with (security_invoker = true) as
select nik, nama, jabatan, kode_cabang, cabang_nama, area, employee_status, is_loan, sumber, tanggal_acuan, aging_hari,
       sum(wajib)::int as wajib, sum(dikembalikan)::int as dikembalikan, sum(dihapuskan)::int as dihapuskan,
       sum(sisa)::int as sisa, sum(nilai)::numeric(16, 2) as nilai,
       jsonb_agg(jsonb_build_object('item_code', item_code, 'item_nama', item_nama, 'sku_code', sku_code, 'sku_label', sku_label,
                                    'wajib', wajib, 'dikembalikan', dikembalikan, 'dihapuskan', dihapuskan, 'sisa', sisa,
                                    'price', price, 'status', status) order by item_sort) as items,
       case when sum(sisa) = 0 and sum(dihapuskan) > 0 then 'DIHAPUSKAN'
            when sum(sisa) = 0 then 'LENGKAP'
            when sum(dikembalikan) > 0 or sum(dihapuskan) > 0 then 'SEBAGIAN'
            else 'BELUM' end as status
from seragam.v_return_obligation
group by nik, nama, jabatan, kode_cabang, cabang_nama, area, employee_status, is_loan, sumber, tanggal_acuan, aging_hari;

-- Akan resign (notice di data forward): siapkan pengambilan seragam di hari terakhir.
create view seragam.v_akan_resign with (security_invoker = true) as
select e.nik, e.nama, e.jabatan, e.kode_cabang, b.nama as cabang_nama, b.area, e.is_loan, e.planned_resign_date,
       (e.planned_resign_date - current_date) as hari_lagi,
       sum(i.issued - i.returned)::int as pcs,
       jsonb_agg(jsonb_build_object('item_nama', it.nama, 'qty', i.issued - i.returned) order by it.sort_order) as items
from seragam.employee e
join seragam.branch b on b.kode_cabang = e.kode_cabang
join seragam.v_issued i on i.nik = e.nik and i.issued - i.returned > 0
join seragam.item it on it.item_code = i.item_code
where e.status = 'AKTIF' and e.planned_resign_date is not null
group by e.nik, e.nama, e.jabatan, e.kode_cabang, b.nama, b.area, e.is_loan, e.planned_resign_date;

-- Lot KARANTINA menunggu QC: setiap baris masuk KARANTINA dikurangi yang sudah di-QC.
create view seragam.v_karantina_lot with (security_invoker = true) as
with
src as materialized (
  select l.id as lot_id, l.tanggal, l.tx_type, l.sku_code, l.nik, l.return_id, l.exchange_id,
         l.qty + coalesce((select sum(r.qty) from seragam.ledger r where r.reversal_of = l.id), 0) as qty_masuk
  from seragam.ledger l
  where l.stock_status = 'KARANTINA' and l.qty > 0 and l.tx_type in ('RET', 'EXC_IN', 'ADJ', 'OPENING')
),
used as materialized (
  select lot_id, -sum(qty)::int as q from seragam.ledger
  where lot_id is not null and stock_status = 'KARANTINA' group by lot_id
)
select s.lot_id, s.tanggal, s.tx_type, s.sku_code, sk.label as sku_label, sk.item_code, sk.item_sort, sk.gender, sk.size_order,
       s.nik, e.nama,
       case s.tx_type when 'RET' then rr.sumber when 'EXC_IN' then 'TUKAR' else 'OPNAME' end as sumber,
       coalesce(rr.kode, ex.kode) as dokumen,
       not (s.tx_type = 'RET' and rr.sumber in ('BATAL_JOIN', 'NOSHOW')) as bekas_pakai,
       case when (s.tx_type = 'RET' and rr.sumber in ('BATAL_JOIN', 'NOSHOW'))
              or coalesce((seragam.cfg('allow_reissue_grade_a') #>> '{}')::boolean, false) then 'LAYAK'
            else 'CADANGAN' end as tujuan_grade_a,
       s.qty_masuk::int as qty_masuk, coalesce(u.q, 0) as qty_qc,
       greatest(s.qty_masuk - coalesce(u.q, 0), 0)::int as sisa,
       (current_date - s.tanggal) as aging_hari
from src s
join seragam.v_sku sk on sk.sku_code = s.sku_code
left join used u on u.lot_id = s.lot_id
left join seragam.employee e on e.nik = s.nik
left join seragam.return_receipt rr on rr.id = s.return_id
left join seragam.exchange ex on ex.id = s.exchange_id
where s.qty_masuk - coalesce(u.q, 0) > 0;

-- Pembelian: per transaksi & per baris (net koreksi). Baris yang dikoreksi tidak ikut potong gaji.
create view seragam.v_sale_line with (security_invoker = true) as
select sa.id as sale_id, sa.kode, sa.tanggal, sa.periode_potong, sa.nik, e.nama, e.jabatan, e.kode_cabang, b.nama as cabang_nama,
       l.id as ledger_id, l.sku_code, s.label as sku_label, s.item_code, -l.qty as qty, l.unit_price as harga,
       (-l.qty * coalesce(l.unit_price, 0))::numeric(16, 2) as nilai,
       exists (select 1 from seragam.ledger r where r.reversal_of = l.id) as dibatalkan
from seragam.sale sa
join seragam.ledger l on l.sale_id = sa.id and l.tx_type = 'SALE'
join seragam.employee e on e.nik = sa.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
join seragam.v_sku s on s.sku_code = l.sku_code;

create view seragam.v_sale with (security_invoker = true) as
select sa.*, e.nama, e.jabatan, b.nama as cabang_nama, u.nama as created_by_nama,
       coalesce(x.pcs, 0) as pcs, coalesce(x.nilai, 0) as nilai, coalesce(x.items, '[]') as items,
       (sa.dibatalkan_at is not null) as dibatalkan
from seragam.sale sa
join seragam.employee e on e.nik = sa.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
left join seragam.app_user u on u.user_id = sa.created_by
left join (
  select sale_id, sum(qty) filter (where not dibatalkan)::int as pcs, sum(nilai) filter (where not dibatalkan)::numeric(16, 2) as nilai,
         jsonb_agg(jsonb_build_object('sku_code', sku_code, 'label', sku_label, 'qty', qty, 'harga', harga, 'dibatalkan', dibatalkan)) as items
  from seragam.v_sale_line group by sale_id
) x on x.sale_id = sa.id;

-- Export potong gaji (AC #10): filter periode_potong.
create view seragam.v_payroll_deduction with (security_invoker = true) as
select periode_potong, nik, nama, jabatan, cabang_nama, kode as no_transaksi, tanggal, sku_code, sku_label, qty, harga, nilai
from seragam.v_sale_line where not dibatalkan;

create view seragam.v_exchange with (security_invoker = true) as
select x.*, e.nama, e.jabatan, b.nama as cabang_nama, it.nama as item_nama,
       si.label as sku_in_label, so.label as sku_out_label, si.vendor_nama, u.nama as created_by_nama,
       (x.tanggal - x.issue_date) as hari_sejak_issue,
       exists (select 1 from seragam.ledger l join seragam.ledger r on r.reversal_of = l.id where l.exchange_id = x.id) as dibatalkan
from seragam.exchange x
join seragam.employee e on e.nik = x.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
join seragam.item it on it.item_code = x.item_code
join seragam.v_sku si on si.sku_code = x.sku_in
join seragam.v_sku so on so.sku_code = x.sku_out
left join seragam.app_user u on u.user_id = x.created_by;

-- Rekap tukar per SKU/vendor 12 bulan terakhir (bahan evaluasi vendor).
create view seragam.v_exchange_rekap with (security_invoker = true) as
with
ex as (
  select sku_in as sku_code, sum(qty)::int as qty_tukar,
         sum(qty) filter (where alasan = 'CACAT_PRODUKSI')::int as cacat,
         sum(qty) filter (where alasan = 'DEVIASI_SPEK_VENDOR')::int as deviasi
  from seragam.v_exchange where not dibatalkan and tanggal > current_date - interval '12 months'
  group by sku_in
),
iss as (
  select sku_code, sum(-qty)::int as qty_issue from seragam.ledger
  where (tx_type = 'ISSUE' or (tx_type = 'REVERSAL' and reversed_tx_type = 'ISSUE')) and tanggal > current_date - interval '12 months'
  group by sku_code
)
select s.sku_code, s.label, s.item_code, s.item_nama, s.vendor_nama, ex.qty_tukar, coalesce(ex.cacat, 0) as cacat,
       coalesce(ex.deviasi, 0) as deviasi, coalesce(iss.qty_issue, 0) as qty_issue,
       case when coalesce(iss.qty_issue, 0) > 0 then round(ex.qty_tukar::numeric / iss.qty_issue * 100, 1) end as rate_pct
from ex join seragam.v_sku s on s.sku_code = ex.sku_code
left join iss on iss.sku_code = ex.sku_code;

-- KPI: tingkat tukar per bulan (EXC ÷ ISSUE) & return rate resign.
create view seragam.v_kpi_exchange_monthly with (security_invoker = true) as
select m.periode::date as periode,
       coalesce((select sum(-l.qty) from seragam.ledger l
                  where (l.tx_type = 'EXC_OUT' or (l.tx_type = 'REVERSAL' and l.reversed_tx_type = 'EXC_OUT'))
                    and date_trunc('month', l.tanggal) = m.periode), 0)::int as tukar,
       coalesce((select sum(-l.qty) from seragam.ledger l
                  where (l.tx_type = 'ISSUE' or (l.tx_type = 'REVERSAL' and l.reversed_tx_type = 'ISSUE')) and l.affects_stock
                    and date_trunc('month', l.tanggal) = m.periode), 0)::int as issue
from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') as m(periode);

create view seragam.v_kpi_return with (security_invoker = true) as
select coalesce(sum(dikembalikan), 0)::int as dikembalikan,
       coalesce(sum(greatest(0, wajib_sekarang - dihapuskan)), 0)::int as sisa,
       coalesce(sum(dihapuskan), 0)::int as dihapuskan,
       count(distinct nik) filter (where wajib_sekarang - dihapuskan > 0)::int as karyawan_belum
from seragam.v_return_leaver where sumber in ('RESIGN', 'PKL_SELESAI');

-- ---------- Alert: tambah retur & QC ----------
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
lv as materialized (select * from seragam.v_return_leaver),
retur_telat as materialized (
  select count(distinct nik)::int n from lv
  where sumber in ('RESIGN', 'PKL_SELESAI') and wajib_sekarang - dihapuskan > 0
    and current_date - tanggal_acuan > seragam.cfg_int('return_alert_days', 14)
),
retur_cabang as materialized (
  select count(distinct nik)::int n from lv where sumber in ('BATAL_JOIN', 'NOSHOW') and wajib_sekarang - dihapuskan > 0
),
stok_status as materialized (
  select coalesce(sum(qty) filter (where stock_status = 'KARANTINA'), 0)::int as karantina,
         coalesce(sum(qty) filter (where stock_status = 'AFKIR'), 0)::int as afkir
  from seragam.v_stock
),
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
  select 'RETUR_TERLAMBAT', 'PERINGATAN', 'Resign belum mengembalikan seragam',
         'Lebih dari ' || seragam.cfg_int('return_alert_days', 14) || ' hari sejak tanggal resign.', n, '/retur?terlambat=1', 4
  from retur_telat where n > 0
  union all
  select 'PERMINTAAN_RETUR', 'PERINGATAN', 'Paket joiner batal join / no-show masih di cabang',
         'Minta cabang mengembalikan paket ke gudang, lalu catat pengembalian.', n, '/retur?sumber=cabang', 5
  from retur_cabang where n > 0
  union all
  select 'SKU_ORDER', 'PERINGATAN', 'SKU sudah mencapai titik pesan ulang',
         'Available + dalam pemesanan ≤ ROP. Pesan sekarang supaya barang datang sebelum habis.', n, '/pengadaan?status=ORDER', 6
  from perlu_order where n > 0
  union all
  select 'PO_TERLAMBAT', 'PERINGATAN', 'PO melewati perkiraan tiba',
         'Barang belum diterima lengkap padahal ETA sudah lewat. Hubungi vendor.', n, '/pengadaan?tab=po&status=terlambat', 7
  from po_telat where n > 0
  union all
  select 'JABATAN_BELUM_DIMAPPING', 'PERINGATAN', 'Jabatan belum dimapping ke paket',
         k || ' karyawan tidak masuk antrian sampai jabatannya dimapping.', n, '/master/jabatan', 8
  from unmapped where n > 0
  union all
  select 'UKURAN_TIDAK_TERSEDIA', 'PERINGATAN', 'Ukuran tidak tersedia untuk item',
         'Perlu keputusan manual: ganti ukuran, pesan khusus, atau ganti item.', n, '/antrian?tab=tidak_tersedia', 9
  from size_invalid where n > 0
  union all
  select 'UKURAN_KOSONG', 'PERINGATAN', 'Karyawan belum punya data ukuran',
         'Tagih ke PPM sebelum cutoff berikutnya.', n, '/antrian?tab=menunggu_ukuran', 10
  from size_kosong where n > 0
  union all
  select 'QC_MENUNGGU', 'INFO', 'Barang karantina menunggu QC',
         'Barang kembali belum bisa dipakai sampai di-QC (pcs).', karantina, '/qc', 11
  from stok_status where karantina > 0
  union all
  select 'AFKIR_BELUM_MUSNAH', 'INFO', 'Barang afkir menunggu pemusnahan',
         'Musnahkan logo lalu catat pemusnahan (pcs).', afkir, '/qc?tab=afkir', 12
  from stok_status where afkir > 0
  union all
  select 'HIRE_MENDADAK', 'INFO', 'Hire mendadak menunggu batch ad-hoc',
         'Buat batch ad-hoc dengan cakupan "Hire mendadak".', n, '/antrian?hire=1', 13
  from late_hire where n > 0
  union all
  select 'STOK_AWAL_BELUM', 'INFO', 'Stok awal belum diinput',
         'Lakukan stock opname pertama untuk membentuk saldo awal (OPENING).', 1, '/opname', 14
  from opening where not opening.ada
) a;

-- ---------- RPC: tukar ----------
-- Cek kelayakan tukar tanpa menyimpan: {nik, item_code, tanggal?} → {ok, issue_date, hari, batas, alasan_tolak, sku_in, issued_net}
create or replace function seragam.fn_exchange_check(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare e seragam.employee; v_item text := upper(trim(p ->> 'item_code')); il record; v_net int; v_tgl date; v_batas int;
begin
  perform seragam.require_role('admin', 'staf', 'viewer');
  select * into e from seragam.employee where nik = upper(trim(p ->> 'nik'));
  if not found then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ditemukan.'; end if;
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  v_batas := seragam.cfg_int('exchange_window_days', 14);
  select * into il from seragam.v_issue_last where nik = e.nik and item_code = v_item;
  select coalesce(issued - returned, 0) into v_net from seragam.v_issued where nik = e.nik and item_code = v_item;
  v_net := coalesce(v_net, 0);
  return jsonb_build_object(
    'issue_date', il.tanggal, 'sku_in', il.sku_code, 'issued_net', v_net, 'batas', v_batas,
    'hari', case when il.tanggal is not null then v_tgl - il.tanggal end,
    'ok', e.status in ('AKTIF', 'OFFERING') and il.tanggal is not null and v_net > 0 and v_tgl - il.tanggal <= v_batas,
    'alasan_tolak', case
      when e.status not in ('AKTIF', 'OFFERING') then 'Karyawan berstatus ' || lower(e.status::text) || '; tukar hanya untuk karyawan aktif.'
      when il.tanggal is null or v_net <= 0 then 'Karyawan belum pernah menerima item ini dari alokasi.'
      when v_tgl - il.tanggal > v_batas then 'Sudah ' || (v_tgl - il.tanggal) || ' hari sejak barang dikirim (' || to_char(il.tanggal, 'DD-MM-YYYY')
                                          || '); batas tukar ' || v_batas || ' hari.'
    end);
end $$;

-- {nik, item_code, sku_in?, sku_out, qty, alasan, approver, catatan?, tanggal?}
create or replace function seragam.fn_exchange_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare chk jsonb; v_nik text := upper(trim(p ->> 'nik')); v_item text := upper(trim(p ->> 'item_code'));
        v_in text; v_out text := upper(trim(p ->> 'sku_out')); v_qty int; v_tgl date; v_id bigint; v_kode text;
        v_avail int; r1 bigint;
begin
  perform seragam.require_role('admin', 'staf');
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal tukar tidak boleh di masa depan.'; end if;
  if coalesce(p ->> 'alasan', '') not in ('CACAT_PRODUKSI', 'DEVIASI_SPEK_VENDOR') then
    raise exception 'TUKAR_DITOLAK: Tukar hanya untuk cacat produksi atau deviasi spek vendor. Salah pilih ukuran diproses sebagai pembelian.';
  end if;
  chk := seragam.fn_exchange_check(jsonb_build_object('nik', v_nik, 'item_code', v_item, 'tanggal', v_tgl));
  if not (chk ->> 'ok')::boolean then
    raise exception 'TUKAR_DITOLAK: % Proses sebagai pembelian.', chk ->> 'alasan_tolak';
  end if;
  if length(coalesce(trim(p ->> 'approver'), '')) < 3 then raise exception 'VALIDASI: Nama atasan yang menyetujui wajib diisi.'; end if;
  begin v_qty := (p ->> 'qty')::int; exception when others then v_qty := null; end;
  if v_qty is null or v_qty <= 0 then raise exception 'VALIDASI: Qty harus lebih dari 0.'; end if;
  if v_qty > (chk ->> 'issued_net')::int then
    raise exception 'VALIDASI: Qty tukar (%) melebihi jumlah yang diterima karyawan (%).', v_qty, chk ->> 'issued_net';
  end if;
  v_in := coalesce(nullif(upper(trim(p ->> 'sku_in')), ''), chk ->> 'sku_in');
  if not exists (select 1 from seragam.sku where sku_code = v_in and item_code = v_item) then
    raise exception 'VALIDASI: SKU barang yang dikembalikan harus item yang sama.';
  end if;
  if not exists (select 1 from seragam.v_sku where sku_code = v_out and item_code = v_item and active) then
    raise exception 'VALIDASI: Barang pengganti harus item yang sama (boleh beda ukuran untuk deviasi spek).';
  end if;
  select available into v_avail from seragam.v_stock_sku where sku_code = v_out;
  if coalesce(v_avail, 0) < v_qty then
    raise exception 'STOK_TIDAK_CUKUP: Stok tersedia % hanya % pcs. Tunggu barang datang atau pilih ukuran lain.', v_out, coalesce(v_avail, 0);
  end if;
  v_kode := seragam._next_kode('TK', v_tgl, 'exchange');
  insert into seragam.exchange (kode, tanggal, nik, item_code, sku_in, sku_out, qty, alasan, approver, catatan, issue_date, created_by)
  values (v_kode, v_tgl, v_nik, v_item, v_in, v_out, v_qty, p ->> 'alasan', trim(p ->> 'approver'), nullif(trim(p ->> 'catatan'), ''),
          (chk ->> 'issue_date')::date, auth.uid())
  returning id into v_id;
  r1 := seragam._ledger_insert('EXC_IN', v_in, v_qty, 'KARANTINA', v_nik, 'Tukar: ' || lower(replace(p ->> 'alasan', '_', ' ')), v_kode, v_tgl,
                               p_exchange => v_id);
  perform seragam._ledger_insert('EXC_OUT', v_out, -v_qty, 'LAYAK', v_nik, 'Tukar: barang pengganti', v_kode, v_tgl,
                                 p_exchange => v_id, p_pair => r1);
  return jsonb_build_object('ok', true, 'id', v_id, 'kode', v_kode);
end $$;

-- ---------- RPC: pembelian ----------
-- {nik, tanggal?, periode_potong ('YYYY-MM' atau tanggal), catatan?, lines: [{sku_code, qty}]}
create or replace function seragam.fn_sale_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare e seragam.employee; v_tgl date; v_per date; r jsonb; v_skucode text; v_qty int; v_avail int; v_id bigint; v_kode text;
        seen text[] := '{}'; v_pcs int := 0; v_nilai numeric := 0; v_price numeric;
begin
  perform seragam.require_role('admin', 'staf');
  select * into e from seragam.employee where nik = upper(trim(p ->> 'nik'));
  if not found then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ditemukan.'; end if;
  if e.status not in ('AKTIF', 'OFFERING') then
    raise exception 'VALIDASI: Karyawan berstatus % tidak bisa membeli dengan potong gaji.', lower(e.status::text);
  end if;
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal pembelian tidak boleh di masa depan.'; end if;
  v_per := date_trunc('month', coalesce(seragam.try_date(p ->> 'periode_potong'), seragam.try_date((p ->> 'periode_potong') || '-01')))::date;
  if v_per is null then raise exception 'VALIDASI: Periode potong gaji wajib diisi.'; end if;
  if v_per < date_trunc('month', v_tgl)::date then raise exception 'VALIDASI: Periode potong gaji tidak boleh sebelum bulan pembelian.'; end if;
  if p -> 'lines' is null or jsonb_array_length(p -> 'lines') = 0 then raise exception 'VALIDASI: Pilih minimal satu barang.'; end if;
  -- validasi semua baris dulu
  for r in select * from jsonb_array_elements(p -> 'lines') loop
    v_skucode := upper(trim(r ->> 'sku_code'));
    begin v_qty := (r ->> 'qty')::int; exception when others then v_qty := null; end;
    if not exists (select 1 from seragam.v_sku where sku_code = v_skucode and active) then raise exception 'VALIDASI: SKU % tidak dikenal.', coalesce(v_skucode, '(kosong)'); end if;
    if v_skucode = any (seen) then raise exception 'VALIDASI: SKU % tercantum lebih dari sekali.', v_skucode; end if;
    seen := seen || v_skucode;
    if v_qty is null or v_qty <= 0 then raise exception 'VALIDASI: Qty % harus lebih dari 0.', v_skucode; end if;
    select price into v_price from seragam.v_sku_price_current where sku_code = v_skucode;
    if v_price is null then raise exception 'VALIDASI: Harga % belum ada di price list. Minta admin mengisi di Harga & Vendor.', v_skucode; end if;
    select available into v_avail from seragam.v_stock_sku where sku_code = v_skucode;
    if coalesce(v_avail, 0) < v_qty then raise exception 'STOK_TIDAK_CUKUP: Stok tersedia % hanya % pcs.', v_skucode, coalesce(v_avail, 0); end if;
  end loop;
  v_kode := seragam._next_kode('JL', v_tgl, 'sale');
  insert into seragam.sale (kode, tanggal, nik, periode_potong, catatan, created_by)
  values (v_kode, v_tgl, e.nik, v_per, nullif(trim(p ->> 'catatan'), ''), auth.uid())
  returning id into v_id;
  for r in select * from jsonb_array_elements(p -> 'lines') loop
    v_skucode := upper(trim(r ->> 'sku_code')); v_qty := (r ->> 'qty')::int;
    perform seragam._ledger_insert('SALE', v_skucode, -v_qty, 'LAYAK', e.nik, 'Pembelian (potong gaji ' || to_char(v_per, 'MM-YYYY') || ')',
                                   v_kode, v_tgl, p_sale => v_id);
    v_pcs := v_pcs + v_qty;
    v_nilai := v_nilai + v_qty * (select price from seragam.v_sku_price_current where sku_code = v_skucode);
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id, 'kode', v_kode, 'pcs', v_pcs, 'nilai', v_nilai);
end $$;

-- Batalkan pembelian (admin): semua baris dikoreksi (REVERSAL), barang kembali ke LAYAK.
create or replace function seragam.fn_sale_cancel(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare sa seragam.sale; l seragam.ledger;
begin
  perform seragam.require_role('admin');
  select * into sa from seragam.sale where id = (p ->> 'id')::bigint for update;
  if not found then raise exception 'TIDAK_DITEMUKAN: Transaksi pembelian tidak ditemukan.'; end if;
  if sa.dibatalkan_at is not null then raise exception 'STATUS: Pembelian % sudah dibatalkan.', sa.kode; end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 3 then raise exception 'VALIDASI: Alasan pembatalan wajib diisi.'; end if;
  for l in select * from seragam.ledger x where x.sale_id = sa.id and x.tx_type = 'SALE'
             and not exists (select 1 from seragam.ledger r where r.reversal_of = x.id) loop
    perform seragam._ledger_insert('REVERSAL', l.sku_code, -l.qty, l.stock_status, l.nik, 'Batal beli: ' || trim(p ->> 'alasan'),
                                   'REV#' || l.id, current_date, null, l.affects_stock, l.id, l.tx_type, p_sale => sa.id);
  end loop;
  update seragam.sale set dibatalkan_at = now(), dibatalkan_by = auth.uid(), alasan_batal = trim(p ->> 'alasan') where id = sa.id;
  perform seragam.write_audit('BATAL_BELI', 'sale', sa.kode, null, jsonb_build_object('alasan', trim(p ->> 'alasan')));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- RPC: pengembalian ----------
-- {nik, tanggal, catatan?, lines: [{item_code, sku_code?, qty}]} → RET (+KARANTINA). Qty ≤ sisa kewajiban.
create or replace function seragam.fn_return_receive(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_nik text := upper(trim(p ->> 'nik')); v_tgl date; r jsonb; v_item text; v_skucode text; v_qty int; ob record;
        v_sumber text; v_id bigint; v_kode text; v_pcs int := 0;
begin
  perform seragam.require_role('admin', 'staf');
  if not exists (select 1 from seragam.employee where nik = v_nik) then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ditemukan.'; end if;
  v_tgl := seragam.try_date(p ->> 'tanggal');
  if v_tgl is null then raise exception 'VALIDASI: Tanggal pengembalian wajib diisi.'; end if;
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal pengembalian tidak boleh di masa depan.'; end if;
  create temp table _ob on commit drop as
    select item_code, sku_code, sumber, sisa from seragam.v_return_obligation where nik = v_nik;
  -- validasi
  for r in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    v_item := upper(trim(r ->> 'item_code'));
    begin v_qty := coalesce((r ->> 'qty')::int, 0); exception when others then raise exception 'VALIDASI: Qty harus bilangan bulat.'; end;
    if v_qty = 0 then continue; end if;
    if v_qty < 0 then raise exception 'VALIDASI: Qty tidak boleh negatif.'; end if;
    select * into ob from _ob where item_code = v_item;
    if not found or ob.sisa = 0 then
      raise exception 'VALIDASI: Karyawan ini tidak punya kewajiban mengembalikan %. Barang hasil beli tidak perlu dikembalikan.', v_item;
    end if;
    if v_qty > ob.sisa then raise exception 'VALIDASI: Qty % (%) melebihi sisa wajib kembali (%).', v_item, v_qty, ob.sisa; end if;
    v_skucode := coalesce(nullif(upper(trim(r ->> 'sku_code')), ''), ob.sku_code);
    if not exists (select 1 from seragam.sku where sku_code = v_skucode and item_code = v_item) then
      raise exception 'VALIDASI: SKU % bukan item %.', v_skucode, v_item;
    end if;
    v_sumber := ob.sumber; v_pcs := v_pcs + v_qty;
  end loop;
  if v_pcs = 0 then drop table _ob; raise exception 'KOSONG: Isi qty yang dikembalikan minimal untuk satu item.'; end if;
  v_kode := seragam._next_kode('RT', v_tgl, 'return_receipt');
  insert into seragam.return_receipt (kode, tanggal, nik, sumber, catatan, created_by)
  values (v_kode, v_tgl, v_nik, v_sumber, nullif(trim(p ->> 'catatan'), ''), auth.uid())
  returning id into v_id;
  for r in select * from jsonb_array_elements(p -> 'lines') loop
    v_item := upper(trim(r ->> 'item_code')); v_qty := coalesce((r ->> 'qty')::int, 0);
    if v_qty = 0 then continue; end if;
    select * into ob from _ob where item_code = v_item;
    v_skucode := coalesce(nullif(upper(trim(r ->> 'sku_code')), ''), ob.sku_code);
    perform seragam._ledger_insert('RET', v_skucode, v_qty, 'KARANTINA', v_nik,
      'Pengembalian ' || lower(replace(ob.sumber, '_', ' ')), v_kode, v_tgl, p_return => v_id);
  end loop;
  drop table _ob;
  return jsonb_build_object('ok', true, 'id', v_id, 'kode', v_kode, 'pcs', v_pcs);
end $$;

-- Hapuskan kewajiban retur (admin): {nik, item_code, qty, alasan}
create or replace function seragam.fn_return_writeoff(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_nik text := upper(trim(p ->> 'nik')); v_item text := upper(trim(p ->> 'item_code')); v_qty int; v_sisa int;
begin
  perform seragam.require_role('admin');
  begin v_qty := (p ->> 'qty')::int; exception when others then v_qty := null; end;
  if v_qty is null or v_qty <= 0 then raise exception 'VALIDASI: Qty harus lebih dari 0.'; end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 5 then raise exception 'VALIDASI: Alasan penghapusan wajib diisi (minimal 5 karakter).'; end if;
  select sisa into v_sisa from seragam.v_return_obligation where nik = v_nik and item_code = v_item;
  if coalesce(v_sisa, 0) = 0 then raise exception 'VALIDASI: Tidak ada sisa kewajiban retur untuk item ini.'; end if;
  if v_qty > v_sisa then raise exception 'VALIDASI: Qty (%) melebihi sisa wajib kembali (%).', v_qty, v_sisa; end if;
  insert into seragam.return_writeoff (nik, item_code, qty, alasan, created_by) values (v_nik, v_item, v_qty, trim(p ->> 'alasan'), auth.uid());
  perform seragam.write_audit('HAPUS_KEWAJIBAN_RETUR', 'employee', v_nik, null,
    jsonb_build_object('item_code', v_item, 'qty', v_qty, 'alasan', trim(p ->> 'alasan')));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- RPC: QC & afkir ----------
-- {tanggal?, lines: [{lot_id, a, b, c}]} → QC_MOVE dua baris per grade.
create or replace function seragam.fn_qc(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; lot record; v_tgl date; g text; v_q int; v_to seragam.stock_status; r1 bigint;
        tot jsonb := '{"LAYAK": 0, "CADANGAN": 0, "AFKIR": 0}'; v_n int := 0;
begin
  perform seragam.require_role('admin', 'staf');
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal QC tidak boleh di masa depan.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    select * into lot from seragam.v_karantina_lot where lot_id = (r ->> 'lot_id')::bigint;
    if not found then raise exception 'STATUS: Barang karantina ini sudah di-QC semua atau tidak ditemukan. Muat ulang daftar.'; end if;
    if coalesce((r ->> 'a')::int, 0) < 0 or coalesce((r ->> 'b')::int, 0) < 0 or coalesce((r ->> 'c')::int, 0) < 0 then
      raise exception 'VALIDASI: Jumlah grade tidak boleh negatif.';
    end if;
    if coalesce((r ->> 'a')::int, 0) + coalesce((r ->> 'b')::int, 0) + coalesce((r ->> 'c')::int, 0) > lot.sisa then
      raise exception 'VALIDASI: % — jumlah grade melebihi sisa karantina (% pcs).', lot.sku_label, lot.sisa;
    end if;
    foreach g in array array['a', 'b', 'c'] loop
      v_q := coalesce((r ->> g)::int, 0);
      if v_q = 0 then continue; end if;
      v_to := case g when 'a' then lot.tujuan_grade_a::seragam.stock_status when 'b' then 'CADANGAN' else 'AFKIR' end;
      r1 := seragam._ledger_insert('QC_MOVE', lot.sku_code, -v_q, 'KARANTINA', lot.nik, 'QC grade ' || upper(g), lot.dokumen, v_tgl, p_lot => lot.lot_id);
      perform seragam._ledger_insert('QC_MOVE', lot.sku_code, v_q, v_to, lot.nik, 'QC grade ' || upper(g), lot.dokumen, v_tgl,
                                     p_lot => lot.lot_id, p_pair => r1);
      tot := jsonb_set(tot, array[v_to::text], to_jsonb((tot ->> v_to::text)::int + v_q));
      v_n := v_n + v_q;
    end loop;
  end loop;
  if v_n = 0 then raise exception 'KOSONG: Isi jumlah grade minimal untuk satu barang.'; end if;
  return jsonb_build_object('ok', true, 'pcs', v_n, 'hasil', tot);
end $$;

-- Pemusnahan afkir: {tanggal, catatan (cara & saksi pemusnahan logo), no_dokumen?, lines: [{sku_code, qty}]}
create or replace function seragam.fn_dispose(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; v_tgl date; v_qty int; v_n int := 0; v_ref text;
begin
  perform seragam.require_role('admin', 'staf');
  v_tgl := seragam.try_date(p ->> 'tanggal');
  if v_tgl is null then raise exception 'VALIDASI: Tanggal pemusnahan wajib diisi.'; end if;
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal pemusnahan tidak boleh di masa depan.'; end if;
  if length(coalesce(trim(p ->> 'catatan'), '')) < 5 then
    raise exception 'VALIDASI: Catat cara pemusnahan logo dan saksinya (minimal 5 karakter).';
  end if;
  v_ref := coalesce(nullif(trim(p ->> 'no_dokumen'), ''), 'MUSNAH-' || to_char(v_tgl, 'YYYYMMDD'));
  for r in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    begin v_qty := coalesce((r ->> 'qty')::int, 0); exception when others then raise exception 'VALIDASI: Qty harus bilangan bulat.'; end;
    if v_qty = 0 then continue; end if;
    if v_qty < 0 then raise exception 'VALIDASI: Qty tidak boleh negatif.'; end if;
    perform seragam._ledger_insert('DISPOSE', upper(trim(r ->> 'sku_code')), -v_qty, 'AFKIR', null, trim(p ->> 'catatan'), v_ref, v_tgl);
    v_n := v_n + v_qty;
  end loop;
  if v_n = 0 then raise exception 'KOSONG: Isi qty yang dimusnahkan.'; end if;
  return jsonb_build_object('ok', true, 'pcs', v_n);
end $$;

-- ---------- Koreksi transaksi: dua-baris dibalik bersama; lot yang sudah di-QC dikunci ----------
create or replace function seragam.fn_ledger_reverse(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare l seragam.ledger; partner seragam.ledger; v_id bigint; v_alasan text := trim(coalesce(p ->> 'alasan', ''));
begin
  perform seragam.require_role('admin');
  select * into l from seragam.ledger where id = (p ->> 'id')::bigint;
  if not found then raise exception 'TIDAK_DITEMUKAN: Transaksi tidak ditemukan.'; end if;
  if l.tx_type = 'REVERSAL' then raise exception 'VALIDASI: Transaksi koreksi tidak bisa dikoreksi lagi. Buat transaksi yang benar.'; end if;
  if exists (select 1 from seragam.ledger where reversal_of = l.id) then
    raise exception 'VALIDASI: Transaksi #% sudah pernah dikoreksi.', l.id;
  end if;
  if length(v_alasan) < 5 then raise exception 'VALIDASI: Alasan koreksi wajib diisi (minimal 5 karakter).'; end if;
  select * into partner from seragam.ledger x
   where (l.pair_id is not null and x.id = l.pair_id) or (x.pair_id = l.id) limit 1;
  -- Barang karantina yang sudah di-QC tidak bisa dibatalkan masuknya.
  if exists (select 1 from seragam.ledger q
              where q.lot_id in (l.id, partner.id) and q.stock_status = 'KARANTINA'
              group by q.lot_id having sum(q.qty) <> 0) then
    raise exception 'STATUS: Sebagian barang dari transaksi ini sudah di-QC. Koreksi hasil QC-nya dulu.';
  end if;
  v_id := seragam._ledger_insert('REVERSAL', l.sku_code, -l.qty, l.stock_status, l.nik, v_alasan, 'REV#' || l.id, current_date,
                                 null, l.affects_stock, l.id, l.tx_type, p_lot => l.lot_id);
  if partner.id is not null and not exists (select 1 from seragam.ledger where reversal_of = partner.id) then
    perform seragam._ledger_insert('REVERSAL', partner.sku_code, -partner.qty, partner.stock_status, partner.nik, v_alasan,
                                   'REV#' || partner.id, current_date, null, partner.affects_stock, partner.id, partner.tx_type,
                                   p_lot => partner.lot_id);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'pasangan', partner.id);
end $$;

-- ---------- RLS & grant ----------
do $$
declare t text;
begin
  foreach t in array array['exchange', 'sale', 'return_receipt', 'return_writeoff'] loop
    execute format('alter table seragam.%I enable row level security', t);
    execute format('create policy %I on seragam.%I for select to authenticated using (seragam.is_app_user())', t || '_read', t);
  end loop;
end $$;

grant select on all tables in schema seragam to authenticated;
grant execute on all functions in schema seragam to authenticated;
revoke execute on function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) from authenticated;
revoke execute on function seragam._next_kode(text, date, text) from authenticated;
