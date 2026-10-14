WEB PKM - SUPABASE EMAIL/PASSWORD (PERBAIKAN)

1. Jalankan supabase_schema.sql di Supabase Dashboard -> SQL Editor. Jalankan ulang setiap ada perubahan skema.
2. Supabase -> Authentication -> Providers -> Email: pastikan Email aktif.
3. Jika ingin langsung masuk setelah daftar, matikan Confirm email. Jika tetap aktif, pengguna harus mengklik email konfirmasi.
4. Website memakai Supabase JS Client resmi dari CDN dan Publishable key di auth.js.
5. Login dan daftar menggunakan EMAIL + PASSWORD. Tidak menggunakan Google.
6. Data aplikasi disimpan per user_id pada public.user_data. Role aplikasi yang digunakan: Owner (role database `cashier`) dan UMKM.
7. Jalankan website lewat Live Server atau hosting HTTPS, bukan file://.
8. Jika pendaftaran gagal, halaman sekarang menampilkan pesan error Supabase yang lebih spesifik.

MENGAKTIFKAN LOGIN DAN ROLE
- Database yang sudah ada dibiarkan apa adanya; jangan jalankan perubahan skema untuk alur kode UMKM ini.
- Login, daftar, pemulihan sesi, logout, dan guard halaman fitur memakai Supabase Auth aktif.
- Pendaftaran akun menghasilkan role UMKM sesuai skema yang sekarang. Owner memakai akun yang sudah memiliki role `cashier`; role tidak dipilih dari form pendaftaran.
- Database saat ini menghasilkan kode UMKM sendiri saat akun dibuat. Karena itu, kode yang dibuat Kasir pada Produk belum dapat dipakai untuk menghubungkan akun UMKM tanpa perubahan database; fitur klaim kode ditunda.
- Owner dengan role `cashier` mengelola produk dan kasir. Akun UMKM memantau produk sesuai pembatasan akses di database yang ada.
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
- Form Produk pada akun Owner/Kasir menerima owner dari daftar akun atau nama UMKM baru yang diketik manual. Klik Generate kode untuk membuat kode UMKM empat digit yang belum digunakan.
- Kode dari Kasir saat ini hanya menjadi identitas owner pada produk; kode itu belum menghubungkan produk ke akun UMKM saat pendaftaran karena database tidak diubah.
- Kode Produk tetap mengikuti generator yang ada di produk.html; login/RBAC tidak mengubah format atau mengganti kode produk.
- kasir.js menyimpan snapshot owner dan Kode UMKM pada item transaksi baru agar transaksi berikutnya tetap dapat direkap menurut owner.
- Role dan kode owner tersimpan di public.user_profiles. Produk masih disimpan sebagai JSON per user_id pada public.user_data. Owner memakai role database `cashier`; UMKM memakai role `umkm`. Skema dan kebijakan database yang ada tidak diubah.
- Ringkasan “Stok titipan awal” saat ini estimasi dari sisa stok sekarang + unit terjual pada tanggal terpilih. Untuk angka historis akurat, catat setiap penambahan/pengurangan stok sebagai mutasi stok dan hitung saldo dari ledger.
