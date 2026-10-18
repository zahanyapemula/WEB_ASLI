(() => {
  const $ = id => document.getElementById(id);
  const form = $('loginForm'), email = $('email'), password = $('password');
  const toggle = $('passwordToggle'), button = $('loginButton'), forgot = $('forgotPassword');
  const emailError = $('emailError'), passError = $('passwordError'), status = $('authStatus');
  if (!form || !email || !password) return;
  const showStatus = (msg, ok = false) => { if (status) { status.textContent = msg; status.classList.toggle('success', ok); } };
  const validate = () => {
    let valid = true;
    if (!email.value.trim()) { emailError.textContent = 'Email wajib diisi.'; valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { emailError.textContent = 'Format email tidak valid.'; valid = false; }
    else emailError.textContent = '';
    if (!password.value) { passError.textContent = 'Password wajib diisi.'; valid = false; }
    else if (password.value.length < 6) { passError.textContent = 'Password minimal 6 karakter.'; valid = false; }
    else passError.textContent = '';
    return valid;
  };
  const friendlyError = err => {
    const raw = String(err?.message || err || '').trim();
    const low = raw.toLowerCase();
    if (low.includes('invalid login credentials')) return 'Email atau password salah.';
    if (low.includes('role akun')) return raw;
    if (low.includes('email not confirmed')) return 'Email belum dikonfirmasi. Cek inbox email kamu.';
    if (low.includes('failed to fetch') || low.includes('network')) return 'Tidak dapat terhubung ke Supabase. Periksa internet dan jalankan lewat Live Server.';
    if (low.includes('invalid api key') || low.includes('apikey')) return 'Kunci Supabase tidak valid. Periksa konfigurasi auth.js.';
    return raw || 'Login gagal.';
  };
  toggle?.addEventListener('click', () => { const visible = password.type === 'text'; password.type = visible ? 'password' : 'text'; });
  form.addEventListener('submit', async e => {
    e.preventDefault(); showStatus(''); emailError.textContent = ''; passError.textContent = ''; if (!validate()) return;
    button.disabled = true; button.textContent = 'Memproses...';
    try {
      await KasirAuth.ready;
      await KasirAuth.signIn(email.value, password.value);
      const requestedTarget = sessionStorage.getItem('kasirTokoAfterLogin') || 'fitur.html';
      const target = KasirAuth.isUmkm
        ? 'storage.html'
        : (/^[a-z0-9-]+\.html(?:\?[a-z0-9=&_%.-]*)?$/i.test(requestedTarget) ? requestedTarget : 'fitur.html');
      sessionStorage.removeItem('kasirTokoAfterLogin');
      showStatus('Login berhasil.', true);
      setTimeout(() => { location.href = target; }, 400);
    }
    catch (err) { showStatus(friendlyError(err)); button.disabled = false; button.textContent = 'Login'; }
  });
  forgot?.addEventListener('click', async e => {
    e.preventDefault(); emailError.textContent = '';
    const value = email.value.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { emailError.textContent = 'Masukkan email terlebih dahulu untuk reset password.'; email.focus(); return; }
    try { await KasirAuth.ready; await KasirAuth.resetPassword(value); showStatus('Link reset password sudah dikirim ke email kamu.', true); }
    catch (err) { showStatus(friendlyError(err)); }
  });
  const remembered = localStorage.getItem('kasirTokoRememberEmail'); if (remembered) { email.value = remembered; $('remember').checked = true; }
  email.addEventListener('input', () => emailError.textContent = ''); password.addEventListener('input', () => passError.textContent = '');
  $('remember')?.addEventListener('change', e => { if (!e.target.checked) localStorage.removeItem('kasirTokoRememberEmail'); });
  form.addEventListener('submit', () => { if ($('remember')?.checked) localStorage.setItem('kasirTokoRememberEmail', email.value.trim()); });
})();
