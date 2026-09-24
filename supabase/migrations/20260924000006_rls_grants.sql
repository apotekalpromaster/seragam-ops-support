-- =====================================================================
-- Migration 6: Row Level Security & grant
--
-- - Semua tabel: RLS aktif, hanya policy SELECT untuk user terdaftar.
-- - Tidak ada policy INSERT/UPDATE/DELETE → penulisan hanya lewat RPC
--   security definer yang mengecek role di awal fungsi.
-- - anon tidak punya akses apa pun ke schema seragam.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'app_user', 'config', 'size', 'item', 'item_size', 'vendor', 'sku', 'sku_price', 'size_curve', 'size_chart',
    'package', 'package_version', 'package_item', 'position_map', 'branch', 'employee', 'employee_package_override',
    'import_log', 'import_staging', 'import_diff', 'import_column_map', 'ledger', 'stock_opname', 'stock_opname_line',
    'audit_log'
  ] loop
    execute format('alter table seragam.%I enable row level security', t);
    execute format('create policy %I on seragam.%I for select to authenticated using (seragam.is_app_user())', t || '_read', t);
  end loop;
end $$;

-- APA (fase lanjut) tidak boleh membaca audit log & data import mentah.
drop policy audit_log_read on seragam.audit_log;
create policy audit_log_read on seragam.audit_log for select to authenticated
  using (seragam.app_role() in ('admin', 'staf', 'viewer'));
drop policy import_staging_read on seragam.import_staging;
create policy import_staging_read on seragam.import_staging for select to authenticated
  using (seragam.app_role() in ('admin', 'staf', 'viewer'));

revoke all on schema seragam from anon;
revoke all on all tables in schema seragam from anon, authenticated;
revoke all on all functions in schema seragam from anon, public;

grant usage on schema seragam to authenticated;
grant select on all tables in schema seragam to authenticated;   -- termasuk view
grant execute on all functions in schema seragam to authenticated;

-- Fungsi internal (awalan _) tidak boleh dipanggil langsung dari client.
revoke execute on function seragam._import_evaluate(bigint) from authenticated;
revoke execute on function seragam._ledger_insert(seragam.tx_type, text, int, seragam.stock_status, text, text, text, date, bigint, boolean, bigint, seragam.tx_type) from authenticated;
revoke execute on function seragam._package_version_changes(text, jsonb, text, date) from authenticated;
revoke execute on function seragam._mapping_changes(text[], text) from authenticated;
revoke execute on function seragam.write_audit(text, text, text, jsonb, jsonb) from authenticated;
revoke execute on function seragam.impact(jsonb) from authenticated;

alter default privileges in schema seragam revoke execute on functions from public;
