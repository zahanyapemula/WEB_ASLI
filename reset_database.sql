-- ==============================================================
-- SCRIPT RESET TOTAL DATABASE (HAPUS SEMUA DATA & AKUN)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- 
-- PERINGATAN:
-- Perintah di bawah ini akan MENGHAPUS BERSIH / TOTAL:
-- 1. Semua akun login (auth.users)
-- 2. Semua profil toko & UMKM (user_profiles)
-- 3. Semua produk, kasir, transaksi, buku kas (user_data)
-- 4. Semua riwayat mutasi stok (stock_movements)
-- 5. Semua status pembayaran titipan (owner_settlements)
-- 6. Semua foto profil yang diunggah (storage.objects avatars)
-- ==============================================================

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
