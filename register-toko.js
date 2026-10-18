(() => {
  const $ = id => document.getElementById(id), form = $('registerTokoForm');
  if (!form) return;

  const fields = {
    name: $('fullName'),
    storeName: $('storeName'),
    email: $('email'),
    password: $('password'),
    confirm: $('confirmPassword')
  };

  const errors = {
    name: $('nameError'),
    storeName: $('storeNameError'),
    email: $('emailError'),
    password: $('passwordError'),
    confirm: $('confirmError')
  };

  const status = $('registerStatus');
  const button = $('registerButton');
  const storeCodePreview = $('storeCodePreview');
  const previewCodeBadge = $('previewCodeBadge');

  // Generate 4-digit angka acak yang konsisten selama sesi input
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);

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

  if (fields.storeName) {
    fields.storeName.addEventListener('input', () => {
      const val = fields.storeName.value.trim();
      if (val && storeCodePreview && previewCodeBadge) {
        previewCodeBadge.textContent = getStoreCode(val);
        storeCodePreview.style.display = 'flex';
      } else if (storeCodePreview) {
        storeCodePreview.style.display = 'none';
      }
    });
  }

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
    return raw || 'Pendaftaran gagal. Periksa konfigurasi Supabase.';
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    Object.values(errors).forEach(x => { if (x) x.textContent = ''; });
    status.textContent = ''; status.classList.remove('success');

    let valid = true;
    const email = fields.email.value.trim().toLowerCase();
    const nameVal = fields.name.value.trim();

    if (!nameVal) {
      errors.name.textContent = 'Nama pemilik toko wajib diisi.';
      valid = false;
    }

    const storeName = fields.storeName.value.trim();
    if (!storeName) {
      errors.storeName.textContent = 'Nama toko wajib diisi.';
      valid = false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email.textContent = 'Masukkan email yang valid.';
      valid = false;
    }

    if (fields.password.value.length < 6) {
      errors.password.textContent = 'Password minimal 6 karakter.';
      valid = false;
    }

    if (fields.confirm.value !== fields.password.value) {
      errors.confirm.textContent = 'Konfirmasi password tidak sama.';
      valid = false;
    }

    if (!valid) return;

    const generatedStoreCode = getStoreCode(storeName);
    button.disabled = true;
    button.textContent = 'Menyimpan...';

    try {
      await KasirAuth.ready;
      const result = await KasirAuth.signUp(email, fields.password.value, nameVal, {
        role: 'admin',
        storeName: storeName,
        storeCode: generatedStoreCode
      });

      if (result.needsConfirmation) {
        status.textContent = `Toko berhasil didaftarkan! Kode Toko Anda: ${generatedStoreCode}. Cek email untuk konfirmasi sebelum login.`;
        status.classList.add('success');
        button.disabled = false;
        button.textContent = 'Daftarkan Toko';
        return;
      }

      status.textContent = `Toko berhasil didaftarkan! Kode Toko Anda: ${generatedStoreCode}. Membuka fitur...`;
      status.classList.add('success');
      const toUrl = window.resolvePageUrl || KasirAuth?.pageUrl || (p => p);
      setTimeout(() => { location.href = toUrl('fitur.html'); }, 500);

    } catch (err) {
      const message = friendlyError(err);
      if (message.toLowerCase().includes('email ini sudah terdaftar')) errors.email.textContent = message;
      else status.textContent = message;
      button.disabled = false;
      button.textContent = 'Daftarkan Toko';
    }
  });
})();
