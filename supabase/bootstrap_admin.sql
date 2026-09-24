-- Jalankan SEKALI setelah migration & seed, untuk menjadikan akun pertama sebagai admin.
-- 1) Buat user di Supabase → Authentication → Add user (email + password).
-- 2) Ganti email di bawah, lalu jalankan di SQL Editor.
insert into seragam.app_user (user_id, email, nama, role)
select id, email, 'Admin Ops Support', 'admin'
from auth.users
where lower(email) = lower('apotekalpro.master@gmail.com')
on conflict (user_id) do update set role = 'admin', aktif = true;
