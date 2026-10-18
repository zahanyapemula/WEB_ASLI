(() => {
  const $ = id => document.getElementById(id);
  const form = $('resetForm');
  if (!form) return;
  const password = $('newPassword');
  const confirm = $('confirmPassword');
  const button = $('resetButton');
  const status = $('resetStatus');
  const passwordError = $('newPasswordError');
  const confirmError = $('confirmPasswordError');

  const showStatus = (msg, ok = false) => {
    status.textContent = msg;
    status.classList.toggle('success', ok);
  };

  const friendlyError = err => {
    const raw = String(err?.message || err || '').trim();
    const low = raw.toLowerCase();
    if (low.includes('same password') || low.includes('should be different')) return 'Password baru harus berbeda dari password lama.';
    if (low.includes('weak password') || low.includes('password should contain')) return 'Password terlalu lemah. Gunakan password yang lebih kuat.';
    if (low.includes('expired') || low.includes('invalid') || low.includes('otp')) return 'Link reset password sudah tidak berlaku. Silakan minta link reset baru.';
    if (low.includes('network') || low.includes('fetch')) return 'Tidak dapat terhubung ke Supabase. Periksa koneksi internet.';
    return raw || 'Gagal mengubah password.';
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    passwordError.textContent = '';
    confirmError.textContent = '';
    showStatus('');

    if (password.value.length < 6) {
      passwordError.textContent = 'Password minimal 6 karakter.';
      return;
    }
    if (password.value !== confirm.value) {
      confirmError.textContent = 'Konfirmasi password tidak sama.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Menyimpan...';
    try {
      await KasirAuth.ready;
      const { data: { session } } = await KasirAuth.client.auth.getSession();
      if (!session) throw new Error('Sesi reset tidak ditemukan. Silakan minta link reset password baru.');
      const { error } = await KasirAuth.client.auth.updateUser({ password: password.value });
      if (error) throw error;
      const toUrl = window.resolvePageUrl || KasirAuth?.pageUrl || (p => p);
      setTimeout(() => { location.href = toUrl('login.html'); }, 1200);
    } catch (err) {
      showStatus(friendlyError(err));
      button.disabled = false;
      button.textContent = 'Simpan Password';
    }
  });
})();
