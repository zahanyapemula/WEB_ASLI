(() => {
  const $ = id => document.getElementById(id), form = $('registerForm');
  if (!form) return;

  let activeRole = 'admin'; // 'admin' (Owner) | 'umkm' (UMKM Penitip)
  let randomSuffix = Math.floor(1000 + Math.random() * 9000);

  const fields = {
    name: $('fullName'),
    storeName: $('storeName'),
    storeCode: $('storeCode'),
    ownerCode: $('ownerCode'),
    email: $('email'),
    password: $('password'),
    confirm: $('confirmPassword')
  };

  const errors = {
    name: $('nameError'),
    storeName: $('storeNameError'),
    storeCode: $('storeCodeError'),
    ownerCode: $('ownerCodeError'),
    email: $('emailError'),
    password: $('passwordError'),
    confirm: $('confirmError')
  };

  const status = $('registerStatus');
  const button = $('registerButton');
  const tabOwner = $('tabOwner');
  const tabUmkm = $('tabUmkm');
  const eyebrow = $('eyebrowRole');
  const headingTitle = $('headingTitle');
  const headingDesc = $('headingDesc');
  const labelFullName = $('labelFullName');
  const storeNameGroup = $('storeNameGroup');
  const storeCodeGroup = $('storeCodeGroup');
  const ownerCodeGroup = $('ownerCodeGroup');
  const storeCodePreview = $('storeCodePreview');
  const previewCodeBadge = $('previewCodeBadge');

  // Generator singkatan nama toko + 4 digit angka acak
  const getAbbrev = name => {
    const clean = String(name || '').trim();
    if (!clean) return '';
    const words = clean.split(/[\s\-_]+/).filter(Boolean);
    let abbrev = '';
    if (words.length >= 2) {
      abbrev = words.slice(0, 4).map(w => w[0].toUpperCase()).join('');
    } else if (words.length === 1) {
      const letters = words[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      abbrev = letters.length > 4 ? letters.slice(0, 3) : letters;
    }
    return abbrev || 'TK';
  };

  const getStoreCode = name => {
    const abbrev = getAbbrev(name);
    return abbrev ? `${abbrev}-${randomSuffix}` : '';
  };

  const updatePreview = () => {
    if (activeRole !== 'admin') {
      if (storeCodePreview) storeCodePreview.style.display = 'none';
      return;
    }
    const val = fields.storeName?.value.trim();
    if (val && storeCodePreview && previewCodeBadge) {
      const code = getStoreCode(val);
      previewCodeBadge.textContent = code;
      storeCodePreview.style.display = 'flex';
    } else if (storeCodePreview) {
      storeCodePreview.style.display = 'none';
    }
  };

  if (fields.storeName) {
    fields.storeName.addEventListener('input', updatePreview);
  }

  const setRole = role => {
    activeRole = role;
    Object.values(errors).forEach(x => { if (x) x.textContent = ''; });
    status.textContent = '';
    status.classList.remove('success');

    if (role === 'admin') {
      tabOwner?.classList.add('active');
      tabUmkm?.classList.remove('active');
      if (eyebrow) eyebrow.textContent = 'AKUN OWNER TOKO';
      if (headingTitle) headingTitle.textContent = 'Daftar Toko Baru';
      if (headingDesc) headingDesc.textContent = 'Daftarkan toko Anda. Kode toko unik otomatis dibuat dari singkatan nama toko + 4 digit angka.';
      if (labelFullName && labelFullName.childNodes[0]) {
        labelFullName.childNodes[0].textContent = 'Nama pemilik toko';
      }
      if (fields.name) fields.name.placeholder = 'Masukkan nama pemilik toko';
      if (storeNameGroup) storeNameGroup.style.display = 'grid';
      if (storeCodeGroup) storeCodeGroup.style.display = 'none';
      if (ownerCodeGroup) ownerCodeGroup.style.display = 'none';
      if (button) button.textContent = 'Daftarkan Toko';
      updatePreview();
    } else {
      tabUmkm?.classList.add('active');
      tabOwner?.classList.remove('active');
      if (eyebrow) eyebrow.textContent = 'AKUN UMKM PENITIP';
      if (headingTitle) headingTitle.textContent = 'Daftar Mitra Penitip';
      if (headingDesc) headingDesc.textContent = 'Masukkan Kode Toko tempat Anda menitipkan produk agar data produk dan stok terhubung.';
      if (labelFullName && labelFullName.childNodes[0]) {
        labelFullName.childNodes[0].textContent = 'Nama lengkap / UMKM';
      }
      if (fields.name) fields.name.placeholder = 'Contoh: Roti Manis Lestari';
      if (storeNameGroup) storeNameGroup.style.display = 'none';
      if (storeCodeGroup) storeCodeGroup.style.display = 'grid';
      if (ownerCodeGroup) ownerCodeGroup.style.display = 'grid';
      if (button) button.textContent = 'Buat Akun UMKM';
      if (storeCodePreview) storeCodePreview.style.display = 'none';
    }
  };

  tabOwner?.addEventListener('click', () => setRole('admin'));
  tabUmkm?.addEventListener('click', () => setRole('umkm'));

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
    if (low.includes('kode toko')) return raw;
    return raw || 'Pendaftaran gagal. Periksa konfigurasi Supabase.';
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    Object.values(errors).forEach(x => { if (x) x.textContent = ''; });
    status.textContent = '';
    status.classList.remove('success');

    let valid = true;
    const nameVal = fields.name.value.trim();
    const email = fields.email.value.trim().toLowerCase();

    if (!nameVal) {
      errors.name.textContent = activeRole === 'admin' ? 'Nama pemilik toko wajib diisi.' : 'Nama UMKM wajib diisi.';
      valid = false;
    }

    let generatedStoreCode = '';
    if (activeRole === 'admin') {
      const storeNameVal = fields.storeName.value.trim();
      if (!storeNameVal) {
        errors.storeName.textContent = 'Nama toko wajib diisi.';
        valid = false;
      } else {
        generatedStoreCode = getStoreCode(storeNameVal);
      }
    } else {
      const storeCodeVal = fields.storeCode.value.trim();
      if (!storeCodeVal) {
        errors.storeCode.textContent = 'Kode Toko wajib diisi agar terhubung ke toko tempat Anda menitip.';
        valid = false;
      }
      const ownerCodeVal = fields.ownerCode.value.trim();
      if (ownerCodeVal && !/^\d{4}$/.test(ownerCodeVal)) {
        errors.ownerCode.textContent = 'Jika diisi, kode UMKM harus terdiri dari 4 angka.';
        valid = false;
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.email.textContent = 'Masukkan email yang valid.'; valid = false; }
    if (fields.password.value.length < 6) { errors.password.textContent = 'Password minimal 6 karakter.'; valid = false; }
    if (fields.confirm.value !== fields.password.value) { errors.confirm.textContent = 'Konfirmasi password tidak sama.'; valid = false; }
    if (!valid) return;

    button.disabled = true;
    button.textContent = 'Menyimpan...';

    try {
      await KasirAuth.ready;
      let result;
      if (activeRole === 'admin') {
        result = await KasirAuth.signUp(email, fields.password.value, nameVal, {
          role: 'admin',
          storeName: fields.storeName.value.trim(),
          storeCode: generatedStoreCode
        });
      } else {
        result = await KasirAuth.signUp(email, fields.password.value, nameVal, {
          role: 'umkm',
          storeCode: fields.storeCode.value.trim().toUpperCase(),
          ownerCode: fields.ownerCode.value.trim()
        });
      }

      if (result.needsConfirmation) {
        status.textContent = activeRole === 'admin'
          ? `Toko berhasil didaftarkan (Kode Toko: ${generatedStoreCode}). Cek email untuk konfirmasi sebelum login.`
          : 'Akun UMKM berhasil dibuat. Cek email untuk konfirmasi sebelum login.';
        status.classList.add('success');
        button.disabled = false;
        button.textContent = activeRole === 'admin' ? 'Daftarkan Toko' : 'Buat Akun UMKM';
        return;
      }

      status.textContent = activeRole === 'admin'
        ? `Akun Toko berhasil dibuat! Kode Toko Anda: ${generatedStoreCode}. Membuka fitur...`
        : 'Akun UMKM berhasil dibuat! Membuka storage produk...';
      status.classList.add('success');

      setTimeout(() => {
        location.href = activeRole === 'admin' ? 'fitur.html' : 'storage.html';
      }, 700);

    } catch (err) {
      const raw = String(err?.message || err || '');
      const message = friendlyError(err);
      if (message.toLowerCase().includes('email ini sudah terdaftar')) errors.email.textContent = message;
      else if (message.toLowerCase().includes('kode umkm')) errors.ownerCode.textContent = message;
      else if (message.toLowerCase().includes('kode toko')) errors.storeCode.textContent = message;
      else status.textContent = message;

      button.disabled = false;
      button.textContent = activeRole === 'admin' ? 'Daftarkan Toko' : 'Buat Akun UMKM';
    }
  });
})();
