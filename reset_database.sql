  -- 1. Matikan sementara pengecekan foreign key agar tidak ada hambatan urutan
set session_replication_role = 'replica';

-- 2. Hapus bersih seluruh tabel data aplikasi
truncate table public.stock_movements cascade;
truncate table public.owner_settlements cascade;
truncate table public.user_data cascade;
truncate table public.user_profiles cascade;

-- 3. Hapus seluruh foto profil yang tersimpan di bucket avatars
delete from storage.objects where bucket_id = 'avatars';

-- 4. Hapus seluruh akun login Supabase
delete from auth.users;

-- 5. Kembalikan mode normal
set session_replication_role = 'origin';

-- 6. Tampilkan status untuk memastikan semuanya sudah kosong (0)
select 
  (select count(*) from auth.users) as sisa_akun_user,
  (select count(*) from public.user_profiles) as sisa_profil,
  (select count(*) from public.user_data) as sisa_data_toko,
  (select count(*) from public.stock_movements) as sisa_riwayat_stok;
