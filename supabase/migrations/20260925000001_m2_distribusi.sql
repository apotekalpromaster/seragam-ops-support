-- =====================================================================
-- Migration M2: Distribusi — antrian, batch cutoff/ad-hoc, reserve stok,
-- shortage, ISSUE otomatis saat SHIPPED, konfirmasi terima per cabang +
-- BAST, hire mendadak (PRD §4.2, §4.9, §7.3, §7.4)
-- =====================================================================

-- ---------- Tabel ----------
create table seragam.batch (
  id                  bigint generated always as identity primary key,
  kode                text not null unique,
  jenis               text not null check (jenis in ('REGULER', 'ADHOC', 'CABANG_BARU')),
  periode             date not null,               -- tanggal 1 bulan cutoff
  cakupan             jsonb not null default '{}',  -- filter saat dibuat (untuk jejak)
  status              text not null default 'DRAFT'
                      check (status in ('DRAFT', 'PICKING', 'PACKED', 'SHIPPED', 'SELESAI', 'DIBATALKAN')),
  deadline_kirim      date not null,
  catatan             text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  picking_at          timestamptz,
  packed_at           timestamptz,
  shipped_at          date,                         -- tanggal barang dikirim
  shipped_by          uuid,
  shipped_recorded_at timestamptz,
  selesai_at          timestamptz,
  dibatalkan_at       timestamptz,
  alasan_batal        text
);
-- Satu batch reguler per periode cutoff (yang tidak dibatalkan).
create unique index batch_reguler_periode_uq on seragam.batch (periode) where jenis = 'REGULER' and status <> 'DIBATALKAN';

create table seragam.batch_line (
  id          bigint generated always as identity primary key,
  batch_id    bigint not null references seragam.batch (id) on delete cascade,
  nik         text not null references seragam.employee (nik),
  kode_cabang text not null references seragam.branch (kode_cabang), -- cabang saat batch dibuat
  item_code   text not null references seragam.item (item_code),
  sku_code    text not null references seragam.sku (sku_code),
  qty         int not null check (qty > 0),
  unique (batch_id, nik, item_code)
);
create index batch_line_nik_idx on seragam.batch_line (nik);
create index batch_line_sku_idx on seragam.batch_line (sku_code);

-- Konfirmasi terima per cabang (RECEIVED + BAST).
create table seragam.batch_branch (
  batch_id    bigint not null references seragam.batch (id) on delete cascade,
  kode_cabang text not null references seragam.branch (kode_cabang),
  received_at date,
  received_by uuid,
  recorded_at timestamptz,
  bast_path   text,
  catatan     text,
  primary key (batch_id, kode_cabang)
);

-- Baris yang tidak masuk batch karena stok kurang (tetap di antrian).
create table seragam.batch_shortage (
  batch_id  bigint not null references seragam.batch (id) on delete cascade,
  nik       text not null references seragam.employee (nik),
  item_code text not null,
  sku_code  text not null references seragam.sku (sku_code),
  qty       int not null,
  available int not null,
  primary key (batch_id, nik, item_code)
);

-- Hire mendadak: joiner yang tidak ada di data forward PPM (PRD §4.2).
create table seragam.hire_event (
  id         bigint generated always as identity primary key,
  nik        text not null references seragam.employee (nik),
  data       jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table seragam.ledger add constraint ledger_batch_fk foreign key (batch_id) references seragam.batch (id);

create trigger audit_batch after insert or update on seragam.batch
  for each row execute function seragam.tg_audit('kode');

-- ---------- View ----------
-- Reserved = qty di batch yang belum dikirim.
create or replace view seragam.v_reserved with (security_invoker = true) as
select bl.sku_code, sum(bl.qty)::int as qty
from seragam.batch_line bl
join seragam.batch b on b.id = bl.batch_id
where b.status in ('DRAFT', 'PICKING', 'PACKED')
group by bl.sku_code;

-- Qty karyawan × item yang sedang ada di batch terbuka.
create view seragam.v_in_batch with (security_invoker = true) as
select bl.nik, bl.item_code, sum(bl.qty)::int as qty, max(b.id) as batch_id, max(b.kode) as batch_kode
from seragam.batch_line bl
join seragam.batch b on b.id = bl.batch_id
where b.status in ('DRAFT', 'PICKING', 'PACKED')
group by bl.nik, bl.item_code;

-- Antrian alokasi: outstanding dikurangi yang sudah masuk batch terbuka.
create view seragam.v_queue with (security_invoker = true) as
select o.nik, o.item_code, o.item_nama, o.item_sort, o.entitlement, o.issued_net, o.outstanding,
       o.sku_target, o.size_code, o.sku_gender, o.size_status,
       o.nama, o.jabatan, o.kode_cabang, o.cabang_nama, o.area, o.status, o.planned_join_date, o.join_date, o.aging_hari,
       e.is_late_hire, e.gender,
       coalesce(ib.qty, 0) as qty_dalam_batch, ib.batch_id, ib.batch_kode,
       greatest(0, o.outstanding - coalesce(ib.qty, 0)) as sisa
-- OFFSET 0 = pagar optimizer: filter pada sisa/size_status tidak boleh didorong ke dalam
-- perhitungan hak (bisa menjadi O(n²), terukur 60 dtk untuk 1.500 karyawan).
from (select * from seragam.v_outstanding offset 0) o
join seragam.employee e on e.nik = o.nik
left join seragam.v_in_batch ib on ib.nik = o.nik and ib.item_code = o.item_code;

create view seragam.v_batch with (security_invoker = true) as
select b.*, u.nama as created_by_nama, us.nama as shipped_by_nama,
       coalesce(l.jumlah_baris, 0) as jumlah_baris, coalesce(l.jumlah_pcs, 0) as jumlah_pcs,
       coalesce(l.jumlah_karyawan, 0) as jumlah_karyawan, coalesce(l.jumlah_cabang, 0) as jumlah_cabang,
       (select count(*) from seragam.batch_branch bb where bb.batch_id = b.id and bb.received_at is not null)::int as cabang_diterima,
       (select count(*) from seragam.batch_shortage s where s.batch_id = b.id)::int as jumlah_shortage,
       (   (b.status in ('DRAFT', 'PICKING', 'PACKED') and current_date > b.deadline_kirim)
        or (b.shipped_at is not null and b.shipped_at > b.deadline_kirim)) as terlambat
from seragam.batch b
left join seragam.app_user u on u.user_id = b.created_by
left join seragam.app_user us on us.user_id = b.shipped_by
left join (
  select batch_id, count(*)::int as jumlah_baris, sum(qty)::int as jumlah_pcs,
         count(distinct nik)::int as jumlah_karyawan, count(distinct kode_cabang)::int as jumlah_cabang
  from seragam.batch_line group by batch_id
) l on l.batch_id = b.id;

create view seragam.v_batch_branch with (security_invoker = true) as
select bb.*, br.nama as cabang_nama, br.area, br.alamat, u.nama as received_by_nama,
       (select count(distinct bl.nik) from seragam.batch_line bl where bl.batch_id = bb.batch_id and bl.kode_cabang = bb.kode_cabang)::int as jumlah_karyawan,
       (select coalesce(sum(bl.qty), 0) from seragam.batch_line bl where bl.batch_id = bb.batch_id and bl.kode_cabang = bb.kode_cabang)::int as jumlah_pcs
from seragam.batch_branch bb
join seragam.branch br on br.kode_cabang = bb.kode_cabang
left join seragam.app_user u on u.user_id = bb.received_by;

-- Baris batch + status penyerahan (PRD §4.9: paket joiner ditahan APA sampai hari join).
create view seragam.v_batch_line with (security_invoker = true) as
select bl.*, b.kode as batch_kode, b.status as batch_status, b.jenis as batch_jenis, b.shipped_at,
       e.nama, e.jabatan, e.gender, e.status as employee_status, e.planned_join_date, e.join_date, e.is_late_hire,
       s.label as sku_label, s.size_code, i.nama as item_nama, i.sort_order as item_sort,
       br.nama as cabang_nama, br.area, bb.received_at,
       case
         when b.status = 'DIBATALKAN' then 'DIBATALKAN'
         when b.status in ('DRAFT', 'PICKING', 'PACKED') then 'DISIAPKAN'
         when bb.received_at is null then 'DIKIRIM'
         when e.status = 'OFFERING' then 'DITAHAN_APA'
         else 'DITERIMA'
       end as penyerahan
from seragam.batch_line bl
join seragam.batch b on b.id = bl.batch_id
join seragam.employee e on e.nik = bl.nik
join seragam.v_sku s on s.sku_code = bl.sku_code
join seragam.item i on i.item_code = bl.item_code
join seragam.branch br on br.kode_cabang = bl.kode_cabang
left join seragam.batch_branch bb on bb.batch_id = bl.batch_id and bb.kode_cabang = bl.kode_cabang;

create view seragam.v_batch_shortage with (security_invoker = true) as
select s.*, e.nama, e.jabatan, e.kode_cabang, br.nama as cabang_nama, k.label as sku_label
from seragam.batch_shortage s
join seragam.employee e on e.nik = s.nik
join seragam.branch br on br.kode_cabang = e.kode_cabang
join seragam.v_sku k on k.sku_code = s.sku_code;

-- KPI "Ketepatan batch" per bulan (batch yang dikirim).
create view seragam.v_kpi_batch_monthly with (security_invoker = true) as
select m.periode::date as periode,
       count(b.id)::int as batch_dikirim,
       count(b.id) filter (where b.shipped_at <= b.deadline_kirim)::int as tepat_waktu
from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') as m(periode)
left join seragam.batch b on date_trunc('month', b.shipped_at) = m.periode and b.status in ('SHIPPED', 'SELESAI')
group by m.periode;

-- KPI "Seragam tiba sebelum join" & "Joiner di luar data forward" per bulan join.
create view seragam.v_kpi_joiner_monthly with (security_invoker = true) as
with j as (
  select e.nik, date_trunc('month', e.join_date)::date as bulan, e.join_date, e.is_late_hire,
         (select min(bb.received_at) from seragam.batch_line bl
            join seragam.batch_branch bb on bb.batch_id = bl.batch_id and bb.kode_cabang = bl.kode_cabang
           where bl.nik = e.nik and bb.received_at is not null) as tiba
  from seragam.employee e
  where e.join_date >= date_trunc('month', current_date) - interval '5 months'
    and e.status in ('AKTIF', 'RESIGN')
    and exists (select 1 from seragam.import_diff d where d.nik = e.nik and d.change_type in ('NEW_OFFERING', 'JOINED')
                union all select 1 from seragam.hire_event h where h.nik = e.nik)
)
select m.periode::date as periode,
       count(j.nik)::int as joiner,
       count(j.nik) filter (where j.tiba is not null and j.tiba <= j.join_date)::int as tiba_sebelum_join,
       count(j.nik) filter (where j.is_late_hire)::int as late_hire
from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') as m(periode)
left join j on j.bulan = m.periode
group by m.periode;

-- Alert: tambah batch terlambat & hire mendadak menunggu batch ad-hoc.
create or replace view seragam.v_alert with (security_invoker = true) as
with
outs as materialized (
  select nik, item_code, sku_target, size_status, outstanding from seragam.v_outstanding
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
  select 'STOK_KURANG', 'KRITIS', 'SKU dengan stok tidak cukup untuk antrian',
         'Available lebih kecil dari kebutuhan outstanding karyawan.', n, '/stok?filter=kurang', 3
  from kurang where n > 0
  union all
  select 'JABATAN_BELUM_DIMAPPING', 'PERINGATAN', 'Jabatan belum dimapping ke paket',
         k || ' karyawan tidak masuk antrian sampai jabatannya dimapping.', n, '/master/jabatan', 4
  from unmapped where n > 0
  union all
  select 'UKURAN_TIDAK_TERSEDIA', 'PERINGATAN', 'Ukuran tidak tersedia untuk item',
         'Perlu keputusan manual: ganti ukuran, pesan khusus, atau ganti item.', n, '/antrian?tab=tidak_tersedia', 5
  from size_invalid where n > 0
  union all
  select 'UKURAN_KOSONG', 'PERINGATAN', 'Karyawan belum punya data ukuran',
         'Tagih ke PPM sebelum cutoff berikutnya.', n, '/antrian?tab=menunggu_ukuran', 6
  from size_kosong where n > 0
  union all
  select 'HIRE_MENDADAK', 'INFO', 'Hire mendadak menunggu batch ad-hoc',
         'Buat batch ad-hoc dengan cakupan "Hire mendadak".', n, '/antrian?hire=1', 7
  from late_hire where n > 0
  union all
  select 'STOK_AWAL_BELUM', 'INFO', 'Stok awal belum diinput',
         'Lakukan stock opname pertama untuk membentuk saldo awal (OPENING).', 1, '/opname', 8
  from opening where not opening.ada
) a;

-- ---------- Ledger: tambah parameter batch ----------
drop function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type);
create function seragam._ledger_insert(
  p_tx seragam.tx_type, p_sku text, p_qty int, p_status seragam.stock_status,
  p_nik text default null, p_reason text default null, p_ref text default null,
  p_tanggal date default current_date, p_opname bigint default null,
  p_affects_stock boolean default true, p_reversal_of bigint default null, p_reversed_tx seragam.tx_type default null,
  p_batch bigint default null)
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
                              unit_price, affects_stock, reversal_of, reversed_tx_type, created_by)
  values (p_tanggal, p_tx, p_sku, p_qty, p_status, p_nik, p_reason, p_ref, p_opname, p_batch,
          (select price from seragam.v_sku_price_current where sku_code = p_sku),
          p_affects_stock, p_reversal_of, p_reversed_tx, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- v_size_issue difilter per size_status: pagar yang sama dengan v_queue.
create or replace view seragam.v_size_issue with (security_invoker = true) as
select o.nik, o.nama, o.jabatan, o.kode_cabang, o.cabang_nama, o.area, o.status,
       o.planned_join_date, o.join_date,
       o.item_code, o.item_nama, o.size_code, o.sku_gender, o.size_status, o.outstanding
from (select * from seragam.v_outstanding offset 0) o
where o.size_status <> 'OK';

-- ---------- RPC ----------
-- Kandidat baris batch sesuai cakupan: sisa antrian dengan ukuran valid.
-- cakupan: SEMUA | HIRE_MENDADAK | CABANG (kode_cabang[]) | KARYAWAN (nik[]) | CABANG_BARU
create or replace function seragam._batch_allocate(p jsonb)
returns table (nik text, item_code text, sku_code text, qty int, kode_cabang text, ok boolean, available int)
language plpgsql stable security definer set search_path = seragam, public as $$
declare
  v_avail jsonb;
  a int;
  r record;
  v_cak text := coalesce(p ->> 'cakupan', 'SEMUA');
begin
  select coalesce(jsonb_object_agg(s.sku_code, s.available), '{}') into v_avail from seragam.v_stock_sku s;
  -- Prioritas: tanggal join paling awal dulu (yang paling mendesak), lalu NIK.
  for r in
    with q as materialized (
      select v.nik, v.item_code, v.sku_target, v.sisa from seragam.v_queue v
      where v.sisa > 0 and v.size_status = 'OK' and v.sku_target is not null
    )
    select q.nik, q.item_code, q.sku_target, q.sisa, e.kode_cabang
    from q
    join seragam.employee e on e.nik = q.nik
    join seragam.branch b on b.kode_cabang = e.kode_cabang
    where case v_cak
            when 'HIRE_MENDADAK' then e.is_late_hire
            when 'CABANG' then e.kode_cabang = any (array(select jsonb_array_elements_text(p -> 'kode_cabang')))
            when 'KARYAWAN' then e.nik = any (array(select jsonb_array_elements_text(p -> 'nik')))
            when 'CABANG_BARU' then b.is_new_opening
            else true end
    order by coalesce(e.join_date, e.planned_join_date) nulls last, q.nik, q.item_code
  loop
    a := coalesce((v_avail ->> r.sku_target)::int, 0);
    nik := r.nik; item_code := r.item_code; sku_code := r.sku_target; qty := r.sisa; kode_cabang := r.kode_cabang; available := a;
    if a >= r.sisa then
      v_avail := jsonb_set(v_avail, array[r.sku_target], to_jsonb(a - r.sisa));
      ok := true;
    else
      ok := false;
    end if;
    return next;
  end loop;
end $$;

create or replace function seragam._batch_defaults(p jsonb, out v_jenis text, out v_periode date, out v_deadline date)
language plpgsql stable security definer set search_path = seragam, public as $$
begin
  v_jenis := coalesce(p ->> 'jenis', 'REGULER');
  if v_jenis not in ('REGULER', 'ADHOC', 'CABANG_BARU') then raise exception 'VALIDASI: Jenis batch tidak dikenal.'; end if;
  v_periode := date_trunc('month', coalesce(seragam.try_date(p ->> 'periode'), current_date))::date;
  v_deadline := coalesce(
    seragam.try_date(p ->> 'deadline_kirim'),
    case when v_jenis = 'REGULER' then
      (v_periode + (case when coalesce((seragam.cfg('ship_deadline_next_month') #>> '{}')::boolean, false) then interval '1 month' else interval '0' end)
       + make_interval(days => least(seragam.cfg_int('ship_deadline_day', 20), 28) - 1))::date
    else current_date + 7 end);
end $$;

create or replace function seragam.fn_batch_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare d record; res jsonb;
begin
  perform seragam.require_role('admin', 'staf');
  select * into d from seragam._batch_defaults(p);
  with al as (select * from seragam._batch_allocate(p))
  select jsonb_build_object(
    'jenis', d.v_jenis, 'periode', d.v_periode, 'deadline_kirim', d.v_deadline,
    'baris', (select count(*) from al where ok),
    'pcs', (select coalesce(sum(qty), 0) from al where ok),
    'karyawan', (select count(distinct nik) from al where ok),
    'cabang', (select count(distinct kode_cabang) from al where ok),
    'baris_shortage', (select count(*) from al where not ok),
    'shortage', coalesce((select jsonb_agg(x order by x ->> 'label') from (
        select jsonb_build_object('sku_code', al.sku_code, 'label', s.label, 'dibutuhkan', sum(al.qty), 'available', max(s.available)) as x
        from al join seragam.v_stock_sku s on s.sku_code = al.sku_code
        where not al.ok group by al.sku_code, s.label) z), '[]'::jsonb),
    'reguler_sudah_ada', (select kode from seragam.batch where jenis = 'REGULER' and periode = d.v_periode and status <> 'DIBATALKAN'
                          and d.v_jenis = 'REGULER')
  ) into res;
  return res;
end $$;

create or replace function seragam.fn_batch_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare
  d record; v_id bigint; v_kode text; v_prefix text; v_n int; v_ok int; v_short int;
begin
  perform seragam.require_role('admin', 'staf');
  select * into d from seragam._batch_defaults(p);
  if d.v_jenis = 'REGULER' and exists (
    select 1 from seragam.batch where jenis = 'REGULER' and periode = d.v_periode and status <> 'DIBATALKAN') then
    raise exception 'DUPLIKAT: Batch reguler periode % sudah ada (%). Gunakan batch ad-hoc untuk susulan.',
      to_char(d.v_periode, 'MM-YYYY'), (select kode from seragam.batch where jenis = 'REGULER' and periode = d.v_periode and status <> 'DIBATALKAN');
  end if;

  create temp table _al on commit drop as select * from seragam._batch_allocate(p);
  select count(*) filter (where ok), count(*) filter (where not ok) into v_ok, v_short from _al;
  if v_ok = 0 then
    raise exception 'KOSONG: Tidak ada baris yang bisa dimasukkan ke batch (% baris kekurangan stok). Periksa stok atau cakupan.', v_short;
  end if;

  v_prefix := 'BT-' || to_char(d.v_periode, 'YYYYMM') || '-' ||
              case d.v_jenis when 'REGULER' then 'REG' when 'ADHOC' then 'ADH' else 'CBR' end;
  if d.v_jenis = 'REGULER' then
    select count(*) into v_n from seragam.batch where kode like v_prefix || '%';
    v_kode := v_prefix || case when v_n > 0 then '-' || (v_n + 1) else '' end;
  else
    select count(*) + 1 into v_n from seragam.batch where kode like v_prefix || '%';
    v_kode := v_prefix || '-' || lpad(v_n::text, 2, '0');
  end if;

  insert into seragam.batch (kode, jenis, periode, cakupan, deadline_kirim, catatan, created_by)
  values (v_kode, d.v_jenis, d.v_periode, p - 'catatan' - 'deadline_kirim' - 'jenis' - 'periode', d.v_deadline,
          nullif(trim(p ->> 'catatan'), ''), auth.uid())
  returning id into v_id;

  insert into seragam.batch_line (batch_id, nik, kode_cabang, item_code, sku_code, qty)
  select v_id, nik, kode_cabang, item_code, sku_code, qty from _al where ok;
  insert into seragam.batch_shortage (batch_id, nik, item_code, sku_code, qty, available)
  select v_id, nik, item_code, sku_code, qty, available from _al where not ok;
  insert into seragam.batch_branch (batch_id, kode_cabang)
  select distinct v_id, kode_cabang from _al where ok;

  return jsonb_build_object('ok', true, 'id', v_id, 'kode', v_kode, 'baris', v_ok, 'baris_shortage', v_short);
end $$;

-- Transisi status. Maju: DRAFT→PICKING→PACKED→SHIPPED. Mundur (sebelum SHIPPED): PACKED→PICKING→DRAFT.
-- SHIPPED membuat ledger ISSUE per baris. {batch_id, status, tanggal (kirim, opsional)}
create or replace function seragam.fn_batch_set_status(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare
  b seragam.batch; v_to text := p ->> 'status'; v_tgl date; l record; v_bad text; n int := 0;
begin
  perform seragam.require_role('admin', 'staf');
  select * into b from seragam.batch where id = (p ->> 'batch_id')::bigint for update;
  if not found then raise exception 'TIDAK_DITEMUKAN: Batch tidak ditemukan.'; end if;
  if not ((b.status, v_to) in (('DRAFT', 'PICKING'), ('PICKING', 'PACKED'), ('PACKED', 'SHIPPED'), ('PICKING', 'DRAFT'), ('PACKED', 'PICKING'))) then
    raise exception 'STATUS: Batch % berstatus %, tidak bisa diubah ke %.', b.kode, b.status, v_to;
  end if;

  if v_to = 'SHIPPED' then
    v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
    if v_tgl > current_date then raise exception 'VALIDASI: Tanggal kirim tidak boleh di masa depan.'; end if;
    if v_tgl < b.created_at::date then raise exception 'VALIDASI: Tanggal kirim tidak boleh sebelum batch dibuat (%).', to_char(b.created_at, 'DD-MM-YYYY'); end if;
    -- Karyawan yang sudah resign / batal join sejak batch dibuat
    select string_agg(distinct e.nama || ' (' || e.status || ')', ', ') into v_bad
    from seragam.batch_line bl join seragam.employee e on e.nik = bl.nik
    where bl.batch_id = b.id and e.status not in ('AKTIF', 'OFFERING');
    if v_bad is not null then
      raise exception 'STATUS: Karyawan berikut sudah tidak aktif: %. Keluarkan barisnya dari batch dulu.', v_bad;
    end if;
    -- Hak yang berkurang sejak batch dibuat (mis. paket diubah)
    with o as materialized (
      select nik, item_code, outstanding from seragam.v_outstanding
      where nik in (select nik from seragam.batch_line where batch_id = b.id)
    )
    select string_agg(distinct bl.nik || '/' || bl.item_code, ', ') into v_bad
    from seragam.batch_line bl
    left join o on o.nik = bl.nik and o.item_code = bl.item_code
    where bl.batch_id = b.id and bl.qty > coalesce(o.outstanding, 0);
    if v_bad is not null then
      raise exception 'STATUS: Hak seragam berubah untuk baris %. Keluarkan baris tersebut lalu buat batch susulan.', v_bad;
    end if;
    for l in select * from seragam.batch_line where batch_id = b.id order by id loop
      perform seragam._ledger_insert('ISSUE', l.sku_code, -l.qty, 'LAYAK', l.nik, 'Batch ' || b.kode, b.kode, v_tgl,
                                     p_batch => b.id);
      n := n + 1;
    end loop;
    update seragam.batch set status = 'SHIPPED', shipped_at = v_tgl, shipped_by = auth.uid(), shipped_recorded_at = now() where id = b.id;
    return jsonb_build_object('ok', true, 'issue', n);
  end if;

  update seragam.batch set status = v_to,
    picking_at = case when v_to = 'PICKING' and b.status = 'DRAFT' then now() when v_to = 'DRAFT' then null else picking_at end,
    packed_at = case when v_to = 'PACKED' then now() when v_to = 'PICKING' then null else packed_at end
  where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function seragam.fn_batch_remove_lines(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare b seragam.batch; n int;
begin
  perform seragam.require_role('admin', 'staf');
  select * into b from seragam.batch where id = (p ->> 'batch_id')::bigint for update;
  if b.status not in ('DRAFT', 'PICKING', 'PACKED') then
    raise exception 'STATUS: Baris hanya bisa dikeluarkan sebelum batch dikirim.';
  end if;
  if (select count(*) from seragam.batch_line where batch_id = b.id)
     <= (select count(*) from seragam.batch_line where batch_id = b.id and id = any (array(select (jsonb_array_elements_text(p -> 'line_ids'))::bigint))) then
    raise exception 'VALIDASI: Batch harus menyisakan minimal satu baris. Batalkan batch bila semua baris dikeluarkan.';
  end if;
  delete from seragam.batch_line where batch_id = b.id and id = any (array(select (jsonb_array_elements_text(p -> 'line_ids'))::bigint));
  get diagnostics n = row_count;
  delete from seragam.batch_branch bb where bb.batch_id = b.id
    and not exists (select 1 from seragam.batch_line bl where bl.batch_id = b.id and bl.kode_cabang = bb.kode_cabang);
  return jsonb_build_object('ok', true, 'dikeluarkan', n);
end $$;

create or replace function seragam.fn_batch_cancel(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare b seragam.batch;
begin
  perform seragam.require_role('admin', 'staf');
  select * into b from seragam.batch where id = (p ->> 'batch_id')::bigint for update;
  if b.status not in ('DRAFT', 'PICKING', 'PACKED') then
    raise exception 'STATUS: Batch yang sudah dikirim tidak bisa dibatalkan.';
  end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 5 then raise exception 'VALIDASI: Tulis alasan pembatalan (minimal 5 karakter).'; end if;
  update seragam.batch set status = 'DIBATALKAN', dibatalkan_at = now(), alasan_batal = trim(p ->> 'alasan') where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- Konfirmasi terima per cabang. {batch_id, kode_cabang, tanggal, bast_path, catatan}
create or replace function seragam.fn_batch_receive(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare b seragam.batch; v_tgl date := coalesce(seragam.try_date(p ->> 'tanggal'), current_date); v_sisa int;
begin
  perform seragam.require_role('admin', 'staf');
  select * into b from seragam.batch where id = (p ->> 'batch_id')::bigint for update;
  if b.status not in ('SHIPPED', 'SELESAI') then raise exception 'STATUS: Konfirmasi terima hanya untuk batch yang sudah dikirim.'; end if;
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal terima tidak boleh di masa depan.'; end if;
  if v_tgl < b.shipped_at then raise exception 'VALIDASI: Tanggal terima tidak boleh sebelum tanggal kirim (%).', to_char(b.shipped_at, 'DD-MM-YYYY'); end if;
  update seragam.batch_branch set received_at = v_tgl, received_by = auth.uid(), recorded_at = now(),
    bast_path = coalesce(nullif(p ->> 'bast_path', ''), bast_path), catatan = nullif(trim(p ->> 'catatan'), '')
  where batch_id = b.id and kode_cabang = p ->> 'kode_cabang';
  if not found then raise exception 'TIDAK_DITEMUKAN: Cabang ini tidak ada di batch %.', b.kode; end if;
  select count(*) into v_sisa from seragam.batch_branch where batch_id = b.id and received_at is null;
  if v_sisa = 0 then
    update seragam.batch set status = 'SELESAI', selesai_at = now() where id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'cabang_belum', v_sisa, 'selesai', v_sisa = 0);
end $$;

create or replace function seragam.fn_batch_unreceive(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare b seragam.batch;
begin
  perform seragam.require_role('admin');
  select * into b from seragam.batch where id = (p ->> 'batch_id')::bigint for update;
  update seragam.batch_branch set received_at = null, received_by = null, recorded_at = null
  where batch_id = b.id and kode_cabang = p ->> 'kode_cabang';
  if b.status = 'SELESAI' then update seragam.batch set status = 'SHIPPED', selesai_at = null where id = b.id; end if;
  perform seragam.write_audit('BATAL_TERIMA', 'batch_branch', b.kode || '/' || (p ->> 'kode_cabang'), null, p);
  return jsonb_build_object('ok', true);
end $$;

-- Hire mendadak (PRD §4.2): joiner di luar data forward → OFFERING + is_late_hire.
create or replace function seragam.fn_hire_event(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_nik text := upper(trim(p ->> 'nik')); v_g text := upper(p ->> 'gender'); k text;
begin
  perform seragam.require_role('admin', 'staf');
  if coalesce(v_nik, '') = '' or coalesce(trim(p ->> 'nama'), '') = '' then raise exception 'VALIDASI: NIK dan nama wajib diisi.'; end if;
  if exists (select 1 from seragam.employee where nik = v_nik) then
    raise exception 'DUPLIKAT: NIK % sudah ada di data karyawan (%). Hire mendadak hanya untuk joiner yang belum ada di data PPM.',
      v_nik, (select nama from seragam.employee where nik = v_nik);
  end if;
  if v_g not in ('P', 'W') then raise exception 'VALIDASI: Pilih gender.'; end if;
  if coalesce(trim(p ->> 'jabatan'), '') = '' then raise exception 'VALIDASI: Jabatan wajib diisi.'; end if;
  if not exists (select 1 from seragam.branch where kode_cabang = upper(trim(p ->> 'kode_cabang'))) then
    raise exception 'VALIDASI: Cabang tidak dikenal.';
  end if;
  if seragam.try_date(p ->> 'planned_join_date') is null then raise exception 'VALIDASI: Tanggal rencana join wajib diisi.'; end if;
  foreach k in array array['size_kemeja', 'size_polo', 'size_blazer'] loop
    if nullif(trim(p ->> k), '') is not null and not exists (select 1 from seragam.size where size_code = upper(trim(p ->> k))) then
      raise exception 'VALIDASI: Ukuran % tidak dikenal.', p ->> k;
    end if;
  end loop;
  insert into seragam.employee (nik, nama, gender, jabatan, kode_cabang, status_karyawan, planned_join_date, status,
                                is_late_hire, size_kemeja, size_polo, size_blazer)
  values (v_nik, trim(p ->> 'nama'), v_g, regexp_replace(trim(p ->> 'jabatan'), '\s+', ' ', 'g'), upper(trim(p ->> 'kode_cabang')),
          nullif(upper(trim(p ->> 'status_karyawan')), ''), seragam.try_date(p ->> 'planned_join_date'), 'OFFERING', true,
          nullif(upper(trim(p ->> 'size_kemeja')), ''), nullif(upper(trim(p ->> 'size_polo')), ''), nullif(upper(trim(p ->> 'size_blazer')), ''));
  insert into seragam.hire_event (nik, data, created_by) values (v_nik, p, auth.uid());
  perform seragam.write_audit('HIRE_MENDADAK', 'employee', v_nik, null, p);
  return jsonb_build_object('ok', true, 'nik', v_nik);
end $$;

-- ---------- Storage BAST (hanya di Supabase; dilewati di PGlite) ----------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('seragam-bast', 'seragam-bast', false) on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'seragam_bast_read') then
      execute $p$create policy seragam_bast_read on storage.objects for select to authenticated
               using (bucket_id = 'seragam-bast' and seragam.is_app_user())$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'seragam_bast_insert') then
      execute $p$create policy seragam_bast_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'seragam-bast' and seragam.app_role() in ('admin', 'staf'))$p$;
    end if;
  end if;
end $$;

-- ---------- RLS & grant untuk objek baru ----------
do $$
declare t text;
begin
  foreach t in array array['batch', 'batch_line', 'batch_branch', 'batch_shortage', 'hire_event'] loop
    execute format('alter table seragam.%I enable row level security', t);
    execute format('create policy %I on seragam.%I for select to authenticated using (seragam.is_app_user())', t || '_read', t);
  end loop;
end $$;

grant select on all tables in schema seragam to authenticated;
grant execute on all functions in schema seragam to authenticated;
revoke execute on function seragam._batch_allocate(jsonb) from authenticated;
revoke execute on function seragam._batch_defaults(jsonb) from authenticated;
revoke execute on function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type, bigint) from authenticated;
