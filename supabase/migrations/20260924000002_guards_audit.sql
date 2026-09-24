-- =====================================================================
-- Migration 2: helper role/config, guard immutable, audit trigger
-- =====================================================================

-- ---------- Helper identitas & role ----------
create or replace function seragam.app_role()
returns text language sql stable security definer set search_path = seragam, public as $$
  select role from seragam.app_user where user_id = auth.uid() and aktif
$$;

create or replace function seragam.is_app_user()
returns boolean language sql stable security definer set search_path = seragam, public as $$
  select exists (select 1 from seragam.app_user where user_id = auth.uid() and aktif)
$$;

-- Dipanggil di awal setiap RPC. Pesan error berawalan KODE: supaya frontend
-- bisa memetakan ke pesan yang ramah pengguna.
create or replace function seragam.require_role(variadic roles text[])
returns text language plpgsql stable security definer set search_path = seragam, public as $$
declare r text := seragam.app_role();
begin
  if r is null then
    raise exception 'AKSES_DITOLAK: Akun Anda belum terdaftar di aplikasi seragam. Hubungi admin Ops Support.';
  end if;
  if not (r = any (roles)) then
    raise exception 'AKSES_DITOLAK: Fitur ini hanya untuk %.', array_to_string(roles, ' / ');
  end if;
  return r;
end $$;

create or replace function seragam.cfg(k text)
returns jsonb language sql stable security definer set search_path = seragam, public as $$
  select value from seragam.config where key = k
$$;

create or replace function seragam.cfg_int(k text, fallback int)
returns int language sql stable security definer set search_path = seragam, public as $$
  select coalesce((select (value #>> '{}')::int from seragam.config where key = k), fallback)
$$;

create or replace function seragam.cfg_num(k text, fallback numeric)
returns numeric language sql stable security definer set search_path = seragam, public as $$
  select coalesce((select (value #>> '{}')::numeric from seragam.config where key = k), fallback)
$$;

-- ---------- Guard immutable ----------
create or replace function seragam.tg_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'IMMUTABLE: Data % tidak boleh diubah atau dihapus. Gunakan transaksi koreksi (REVERSAL).', tg_table_name;
end $$;

create trigger ledger_immutable before update or delete on seragam.ledger
  for each row execute function seragam.tg_immutable();
create trigger audit_log_immutable before update or delete on seragam.audit_log
  for each row execute function seragam.tg_immutable();
create trigger import_diff_immutable before update or delete on seragam.import_diff
  for each row execute function seragam.tg_immutable();
-- TRUNCATE juga ditolak
create trigger ledger_no_truncate before truncate on seragam.ledger
  for each statement execute function seragam.tg_immutable();
create trigger audit_log_no_truncate before truncate on seragam.audit_log
  for each statement execute function seragam.tg_immutable();

-- ---------- Audit trigger untuk master & config ----------
create or replace function seragam.tg_audit()
returns trigger language plpgsql security definer set search_path = seragam, public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  id_parts text[] := '{}';
  col text;
begin
  foreach col in array tg_argv loop
    id_parts := id_parts || (rec ->> col);
  end loop;
  insert into seragam.audit_log (user_id, user_email, aksi, entitas, entitas_id, before, after)
  values (
    auth.uid(),
    (select email from seragam.app_user where user_id = auth.uid()),
    tg_op,
    tg_table_name,
    array_to_string(id_parts, '/'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

create trigger audit_config after insert or update or delete on seragam.config
  for each row execute function seragam.tg_audit('key');
create trigger audit_item after insert or update or delete on seragam.item
  for each row execute function seragam.tg_audit('item_code');
create trigger audit_item_size after insert or delete on seragam.item_size
  for each row execute function seragam.tg_audit('item_code', 'size_code');
create trigger audit_sku after insert or update or delete on seragam.sku
  for each row execute function seragam.tg_audit('sku_code');
create trigger audit_sku_price after insert or update or delete on seragam.sku_price
  for each row execute function seragam.tg_audit('sku_code', 'valid_from');
create trigger audit_vendor after insert or update or delete on seragam.vendor
  for each row execute function seragam.tg_audit('id');
create trigger audit_package after insert or update or delete on seragam.package
  for each row execute function seragam.tg_audit('package_code');
create trigger audit_package_version after insert or update or delete on seragam.package_version
  for each row execute function seragam.tg_audit('package_code', 'version_no');
create trigger audit_package_item after insert or update or delete on seragam.package_item
  for each row execute function seragam.tg_audit('package_code', 'version_no', 'item_code');
create trigger audit_position_map after insert or update or delete on seragam.position_map
  for each row execute function seragam.tg_audit('jabatan');
create trigger audit_override after insert or update or delete on seragam.employee_package_override
  for each row execute function seragam.tg_audit('nik');
create trigger audit_branch after insert or update or delete on seragam.branch
  for each row execute function seragam.tg_audit('kode_cabang');
create trigger audit_size_curve after insert or update or delete on seragam.size_curve
  for each row execute function seragam.tg_audit('item_code', 'gender', 'size_code');
create trigger audit_size_chart after insert or update or delete on seragam.size_chart
  for each row execute function seragam.tg_audit('item_code', 'gender', 'size_code');
create trigger audit_app_user after insert or update or delete on seragam.app_user
  for each row execute function seragam.tg_audit('email');
create trigger audit_stock_opname after insert or update on seragam.stock_opname
  for each row execute function seragam.tg_audit('id');
