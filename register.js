(() => {
  const $ = id => document.getElementById(id), form = $('registerForm');
  if (!form) return;
  const fields = { name: $('fullName'), ownerCode: $('ownerCode'), email: $('email'), password: $('password'), confirm: $('confirmPassword') };
  const errors = { name: $('nameError'), ownerCode: $('ownerCodeError'), email: $('emailError'), password: $('passwordError'), confirm: $('confirmError') };
  const status = $('registerStatus');
  const button = $('registerButton');
  const friendlyError = err => {
    const raw = String(err?.message || err || '').trim();
    const low = raw.toLowerCase();
    if (low.includes('already registered') || low.includes('already been registered') || low.includes('user already exists')) return 'Email ini sudah terdaftar. Silakan login.';
    if (low.includes('password') && (low.includes('at least') || low.includes('characters'))) return 'Password terlalu pendek. Gunakan minimal 6 karakter.';
    if (low.includes('rate limit') || low.includes('email rate limit')) return 'Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.';
    if (low.includes('invalid api key') || low.includes('apikey')) return 'Kunci Supabase tidak valid. Periksa konfigurasi auth.js.';
    if (low.includes('failed to fetch') || low.includes('network')) return 'Tidak dapat terhubung ke Supabase. Periksa internet dan jalankan lewat Live Server.';
    if (low.includes('email provider') || low.includes('email signups are disabled')) return 'Pendaftaran email belum diaktifkan di Supabase Authentication → Providers → Email.';
    if (low.includes('confirm email')) return 'Akun dibuat, tetapi email konfirmasi masih diperlukan.';
    if (low.includes('kode umkm')) return raw;
    return raw || 'Pendaftaran gagal. Periksa konfigurasi Supabase.';
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    Object.values(errors).forEach(x => x.textContent = '');
    status.textContent = ''; status.classList.remove('success');
    let valid = true; const email = fields.email.value.trim().toLowerCase();
    if (!fields.name.value.trim()) { errors.name.textContent = 'Nama lengkap wajib diisi.'; valid = false; }
    const ownerCode = fields.ownerCode.value.trim();
    if (ownerCode && !/^\d{4}$/.test(ownerCode)) { errors.ownerCode.textContent = 'Jika diisi, kode UMKM harus terdiri dari 4 angka.'; valid = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.email.textContent = 'Masukkan email yang valid.'; valid = false; }
    if (fields.password.value.length < 6) { errors.password.textContent = 'Password minimal 6 karakter.'; valid = false; }
    if (fields.confirm.value !== fields.password.value) { errors.confirm.textContent = 'Konfirmasi password tidak sama.'; valid = false; }
    if (!valid) return;
    button.disabled = true; button.textContent = 'Menyimpan...';
    try {
      await KasirAuth.ready;
      const result = await KasirAuth.signUp(email, fields.password.value, fields.name.value, ownerCode);
      if (result.needsConfirmation) {
        status.textContent = 'Akun berhasil dibuat. Cek email untuk konfirmasi sebelum login.';
        status.classList.add('success');
        button.disabled = false; button.textContent = 'Buat Akun';
        return;
      }
      status.textContent = 'Akun berhasil dibuat. Membuka fitur...';
      status.classList.add('success');
      setTimeout(() => { location.href = 'fitur.html'; }, 500);
    } catch (err) {
      const raw = String(err?.message || err || '');
      const message = ownerCode && /database error saving new user/i.test(raw)
        ? 'Kode UMKM tidak ditemukan atau sudah terhubung ke akun lain. Pastikan Owner/Kasir sudah menyimpan produk dengan kode tersebut.'
        : friendlyError(err);
      if (message.toLowerCase().includes('email ini sudah terdaftar')) errors.email.textContent = message;
      else if (message.toLowerCase().includes('kode umkm')) errors.ownerCode.textContent = message;
      else status.textContent = message;
      button.disabled = false; button.textContent = 'Buat Akun';
    }
  });
})();
