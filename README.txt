WEB PKM - SUPABASE EMAIL/PASSWORD (PERBAIKAN)

1. Jalankan supabase_schema.sql di Supabase Dashboard -> SQL Editor. Jalankan ulang setiap ada perubahan skema.
2. Supabase -> Authentication -> Providers -> Email: pastikan Email aktif.
3. Jika ingin langsung masuk setelah daftar, matikan Confirm email. Jika tetap aktif, pengguna harus mengklik email konfirmasi.
4. Website memakai Supabase JS Client resmi dari CDN dan Publishable key di auth.js.
5. Login dan daftar menggunakan EMAIL + PASSWORD. Tidak menggunakan Google.
6. Data aplikasi disimpan per user_id pada public.user_data; Row Level Security membatasi akun UMKM dan memberi Admin/Kasir akses lintas akun sesuai role database.
7. Jalankan website lewat Live Server atau hosting HTTPS, bukan file://.
8. Jika pendaftaran gagal, halaman sekarang menampilkan pesan error Supabase yang lebih spesifik.

MENGAKTIFKAN LOGIN DAN ROLE
- Jalankan ulang supabase_schema.sql setelah update ini agar tabel user_profiles, role default UMKM, dan policy Admin/Kasir dibuat.
- Login, daftar, pemulihan sesi, logout, dan guard halaman fitur memakai Supabase Auth aktif.
- Semua akun lama yang belum punya profil dibuat sebagai role umkm. Akun baru juga selalu mendapat role umkm; role tidak dapat dipilih dari form pendaftaran.
- Setelah akun Admin/Kasir dibuat dan email-nya dikonfirmasi, promosikan secara manual di Supabase SQL Editor:
  update public.user_profiles p
  set role = 'admin'
  from auth.users u
  where p.user_id = u.id and lower(u.email) = lower('EMAIL_ADMIN');
  Gunakan role 'cashier' untuk Kasir Utama. Pastikan email sudah benar sebelum menjalankan perintah.
- Kebijakan RLS membolehkan akun UMKM membaca/mengubah hanya baris user_data miliknya. Role admin/cashier dapat membaca/mengelola seluruh baris. Storage menggabungkan daftar produk untuk Admin/Kasir dan menyimpan perubahan kembali ke akun asal tiap produk.
- Jalankan website melalui HTTPS/localhost. Tanpa menjalankan migrasi SQL terbaru, halaman terlindungi menolak akses dan login akan menampilkan error profil.

PENTING:
- Publishable key boleh berada di frontend.
- Jangan pernah memasukkan service_role key / secret key ke file website.

JIKA MASIH GAGAL:
- Buka browser dengan http://127.0.0.1:5500/ (atau port Live Server kamu).
- Pastikan Email provider aktif.
- Pastikan supabase_schema.sql sudah dijalankan.
- Lihat pesan merah yang muncul di halaman daftar; pesan tersebut adalah error sebenarnya dari Supabase.

RESET / GANTI PASSWORD:
- login.html -> Lupa password -> Supabase mengirim email reset.
- reset-password.html menerima link reset dan menyimpan password baru dengan Supabase Auth.
- Untuk GitHub Pages, isi WEBPKM_PUBLIC_URL di site-config.js dengan URL publik website.
- Tambahkan URL reset-password.html tersebut ke Supabase Authentication -> URL Configuration -> Redirect URLs.
- Jangan memakai localhost jika link email akan dibuka dari HP.

UPDATE PERBAIKAN FITUR + NAVBAR (30 September 2026)
- Semua 7 kartu fitur sekarang memiliki tujuan halaman yang benar dan tetap meminta login hanya saat fitur dibuka.
- Alur fitur: Produk/Barcode -> Storage -> Kasir -> Dashboard/Buku Kas/Perbandingan -> Informasi Produk/Ingredient.
- Storage diperbaiki karena file sebelumnya terpotong/tidak terhubung. Sekarang dapat memilih produk, mengatur stok, pemilik, batas minimum, dan ingredient.
- Tombol Storage dari halaman Produk otomatis membuka produk yang dipilih.
- Kasir otomatis mengurangi stok dan mencatat penjualan ke Dashboard, Buku Kas, dan Perbandingan.
- Navbar publik dan halaman fitur sekarang menggunakan satu desain bersama yang konsisten di desktop dan mobile.
- Ikon akun ditambahkan. Saat login, ikon menampilkan inisial akun dan tombol berubah menjadi Logout.
- Menu mobile menggunakan hamburger yang sama di seluruh halaman.

STORAGE / INVENTORI PRODUK
- storage.html menyimpan kode owner empat digit, menyediakan filter owner, mengelompokkan produk menurut kode owner, dan menampilkan rekap penjualan per tanggal.
- Form Produk menerima nama owner UMKM dari daftar akun yang sudah terdaftar; Storage memakai dropdown akun owner yang sama agar tidak perlu mengetik ulang.
- Kode Produk tetap mengikuti generator yang ada di produk.html; login/RBAC tidak mengubah format atau mengganti kode produk.
- kasir.js menyimpan snapshot owner dan Kode UMKM pada item transaksi baru agar transaksi berikutnya tetap dapat direkap menurut owner.
- Role dan kode owner tersimpan di public.user_profiles. Produk masih disimpan sebagai JSON per user_id pada public.user_data, dengan RLS server-side: UMKM hanya dapat mengakses baris akun sendiri; Admin/Kasir dapat mengakses semua baris produk. Kode `_tenantUserId` hanya metadata UI untuk menyimpan perubahan admin kembali ke akun asal dan tidak dikirim sebagai klaim keamanan.
- Role awal semua akun adalah umkm. Promosi ke admin hanya dapat dilakukan secara manual di Supabase SQL Editor; akun dengan role cashier dapat melihat/mengelola seluruh produk tetapi tidak dapat mengubah role akun lain.
- Ringkasan “Stok titipan awal” saat ini estimasi dari sisa stok sekarang + unit terjual pada tanggal terpilih. Untuk angka historis akurat, catat setiap penambahan/pengurangan stok sebagai mutasi stok dan hitung saldo dari ledger.
