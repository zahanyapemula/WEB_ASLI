/* Web PKM - Supabase Auth + cloud data per account */
(() => {
  const SUPABASE_URL = 'https://pktvmwqyddxrhevvpuoo.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_n1tyrcD0OwXVHFQ3lPZaow_P2nx7J7E';
  const DATA_NAMES = ['products', 'sales', 'cash', 'expenses'];
  const SESSION_KEY = 'kasirTokoSupabaseSession';
  const CURRENT_KEY = 'kasirTokoCurrentUser';
  const LOGIN_KEY = 'kasirTokoLoggedIn';
  const publicPages = ['index.html', 'login.html', 'register.html', 'register-toko.html', 'panduan.html', 'tentang.html', 'kontak.html', 'reset-password.html', ''];
  const protectedPages = ['dashboard.html', 'kasir.html', 'produk.html', 'storage.html', 'buku-kas.html', 'perbandingan.html', 'scan-ingredient.html'];
  const file = (location.pathname.split('/').pop() || '').toLowerCase();
  let hydrating = false;
  let session = null;
  let currentUser = null;
  let currentProfile = null;
  let client = null;
  const loadedProductTenantIds = new Set();

  const jsonError = async response => {
    let body = null;
    try { body = await response.json(); } catch { }
    const message = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = body?.code || body?.error_code || '';
    return error;
  };

  const loadSupabase = () => new Promise((resolve, reject) => {
    if (window.supabase?.createClient) return resolve(window.supabase);
    const existing = document.querySelector('script[data-supabase-client]');
    if (existing) {
      existing.addEventListener('load', () => window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('Supabase JS gagal dimuat.')));
      existing.addEventListener('error', () => reject(new Error('Supabase JS gagal dimuat. Periksa koneksi internet.')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    script.async = true;
    script.dataset.supabaseClient = 'true';
    script.onload = () => window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('Supabase JS gagal dimuat.'));
    script.onerror = () => reject(new Error('Tidak dapat memuat Supabase JS. Pastikan internet aktif.'));
    document.head.appendChild(script);
  });

  const slug = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
  const localKey = name => currentUser ? `kt_user_${slug(currentUser.id)}_${name}_v6` : `kt_guest_${name}_v6`;
  const readLocal = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
  const writeLocal = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const reportCloudError = error => {
    const message = error?.message || 'Periksa koneksi dan kebijakan akses Supabase.';
    console.error('Sinkronisasi Supabase gagal:', message);
    window.dispatchEvent(new CustomEvent('kasir:cloud-error', { detail: { message } }));
  };

  async function saveCloud(name, value) {
    if (!client || !session?.access_token || !currentUser || hydrating) return;
    if (name === 'products' && ['admin', 'cashier'].includes(currentProfile?.role)) {
      const grouped = new Map();
      for (const product of Array.isArray(value) ? value : []) {
        const tenantId = product._tenantUserId || currentUser.id;
        if (!grouped.has(tenantId)) grouped.set(tenantId, []);
        const { _tenantUserId, ...storedProduct } = product;
        grouped.get(tenantId).push(storedProduct);
      }
      for (const tenantId of loadedProductTenantIds) {
        if (!grouped.has(tenantId)) grouped.set(tenantId, []);
      }
      if (!grouped.has(currentUser.id)) grouped.set(currentUser.id, []);
      const results = await Promise.all([...grouped].map(([userId, products]) =>
        client.from('user_data').upsert({
          user_id: userId,
          key: 'products',
          value: products,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,key' })
      ));
      const failedSave = results.find(({ error }) => error)?.error;
      if (failedSave) {
        reportCloudError(failedSave);
        throw failedSave;
      }
      return;
    }
    const { error } = await client.from('user_data').upsert({
      user_id: currentUser.id,
      key: name,
      value,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,key' });
    if (error) reportCloudError(error);
  }

  const pendingProductSaves = new Set();
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (!hydrating && currentUser && DATA_NAMES.some(n => key === localKey(n))) {
      let parsed = value;
      try { parsed = JSON.parse(value); } catch { }
      const name = DATA_NAMES.find(n => key === localKey(n));
      if (name) {
        const pending = saveCloud(name, parsed);
        if (name === 'products') {
          pendingProductSaves.add(pending);
          void pending.catch(reportCloudError).finally(() => pendingProductSaves.delete(pending));
        } else {
          void pending.catch(reportCloudError);
        }
      }
    }
  };

  async function getStoreTenantUserIds() {
    if (!currentUser) return [];
    const ids = [currentUser.id];
    const storeCode = String(currentProfile?.store_code || currentUser?.user_metadata?.store_code || '').trim();
    if (storeCode && ['admin', 'cashier'].includes(currentProfile?.role)) {
      try {
        const { data } = await client
          .from('user_profiles')
          .select('user_id')
          .eq('role', 'umkm')
          .ilike('store_code', storeCode);
        for (const row of data || []) {
          if (row.user_id && !ids.includes(row.user_id)) ids.push(row.user_id);
        }
      } catch (e) {
        console.warn('Gagal memuat tenant toko:', e);
      }
    }
    return ids;
  }

  async function hydrateCloud() {
    if (!client || !currentUser || !session?.access_token) return;
    if (currentProfile?.role === 'umkm') return;
    hydrating = true;
    try {
      let query = client.from('user_data').select('user_id,key,value');
      if (['admin', 'cashier'].includes(currentProfile?.role)) {
        const tenantIds = await getStoreTenantUserIds();
        query = query.in('user_id', tenantIds);
      } else {
        query = query.eq('user_id', currentUser.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      const allProducts = [];
      loadedProductTenantIds.clear();
      for (const row of (data || [])) {
        if (row.key === 'products') {
          loadedProductTenantIds.add(row.user_id);
          const products = Array.isArray(row.value) ? row.value : [];
          if (['admin', 'cashier'].includes(currentProfile?.role)) {
            allProducts.push(...products.map(product => ({ ...product, _tenantUserId: row.user_id })));
          } else if (row.user_id === currentUser.id) {
            originalSetItem(localKey('products'), JSON.stringify(products.map(product => ({ ...product, _tenantUserId: currentUser.id }))));
          }
        } else if (DATA_NAMES.includes(row.key) && row.user_id === currentUser.id) {
          originalSetItem(localKey(row.key), JSON.stringify(row.value ?? []));
        }
      }
      if (['admin', 'cashier'].includes(currentProfile?.role)) {
        originalSetItem(localKey('products'), JSON.stringify(allProducts));
      }
    } finally { hydrating = false; }
  }

  async function refreshInventoryProducts() {
    await ready;
    if (!client || !currentUser || !['admin', 'cashier'].includes(currentProfile?.role)) {
      throw new Error('Hanya Admin/Kasir yang dapat memuat ulang seluruh produk.');
    }
    await Promise.all([...pendingProductSaves]);
    const tenantIds = await getStoreTenantUserIds();
    const { data, error } = await client
      .from('user_data')
      .select('user_id, value')
      .eq('key', 'products')
      .in('user_id', tenantIds);
    if (error) throw error;
    const products = [];
    loadedProductTenantIds.clear();
    for (const row of data || []) {
      loadedProductTenantIds.add(row.user_id);
      if (Array.isArray(row.value)) {
        products.push(...row.value.map(product => ({ ...product, _tenantUserId: row.user_id })));
      }
    }
    if (!loadedProductTenantIds.has(currentUser.id)) loadedProductTenantIds.add(currentUser.id);
    originalSetItem(localKey('products'), JSON.stringify(products));
    return products;
  }

  async function saveProductsAndWait(products) {
    await ready;
    if (!client || !session?.access_token || !currentUser || !['admin', 'cashier'].includes(currentProfile?.role)) {
      throw new Error('Hanya Owner/Kasir yang dapat menyimpan produk.');
    }
    if (!Array.isArray(products)) throw new Error('Daftar produk tidak valid.');
    await saveCloud('products', products);
    originalSetItem(localKey('products'), JSON.stringify(products));
  }

  async function loadProfile(userId = currentUser?.id) {
    if (!client || !userId) return null;
    let { data, error } = await client
      .from('user_profiles')
      .select('user_id, role, owner_name, owner_code, store_name, store_code, avatar_url')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && (String(error.message || '').includes('avatar_url') || String(error.message || '').includes('store_') || error.code === 'PGRST204')) {
      const fallback = await client
        .from('user_profiles')
        .select('user_id, role, owner_name, owner_code')
        .eq('user_id', userId)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;
    if (!data) {
      currentProfile = null;
      return null;
    }

    if (!data.store_code && currentUser?.user_metadata?.store_code) {
      data.store_code = currentUser.user_metadata.store_code;
    }
    if (!data.store_name && currentUser?.user_metadata?.store_name) {
      data.store_name = currentUser.user_metadata.store_name;
    }
    if (!data.avatar_url && currentUser?.user_metadata?.avatar_url) {
      data.avatar_url = currentUser.user_metadata.avatar_url;
    }
    if (data.role === 'umkm' && currentUser?.user_metadata?.role === 'admin') {
      data.role = 'admin';
    }

    currentProfile = data;
    return data;
  }

  function clearUmkmLocalData() {
    for (const name of [...DATA_NAMES, 'owners']) localStorage.removeItem(localKey(name));
  }

  async function listOwnerAccounts() {
    await ready;
    if (!currentProfile || !client) throw new Error('Profil akun belum siap.');
    let query = client
      .from('user_profiles')
      .select('user_id, role, owner_name, owner_code, store_name, store_code, avatar_url')
      .eq('role', 'umkm');
    if (currentProfile.role === 'umkm') {
      query = query.eq('user_id', currentUser.id);
    } else if (['admin', 'cashier'].includes(currentProfile.role)) {
      const storeCode = String(currentProfile.store_code || currentUser?.user_metadata?.store_code || '').trim();
      if (storeCode) {
        query = query.ilike('store_code', storeCode);
      } else {
        return [];
      }
    }
    const { data, error } = await query.order('owner_name');
    if (error) throw error;
    return data || [];
  }

  async function listStockMovements() {
    await ready;
    if (!client || !currentUser) throw new Error('Silakan login untuk memuat riwayat stok.');
    const tenantIds = await getStoreTenantUserIds();
    const pageSize = 1000;
    const movements = [];
    for (let offset = 0; ; offset += pageSize) {
      let query = client
        .from('stock_movements')
        .select('id, product_id, product_code, product_name, owner_code, owner_name, movement_type, quantity, gross_amount, occurred_at, sale_id, note, actor_user_id')
        .order('occurred_at')
        .order('id')
        .range(offset, offset + pageSize - 1);

      if (['admin', 'cashier'].includes(currentProfile?.role)) {
        query = query.in('actor_user_id', tenantIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      movements.push(...(data || []));
      if (!data || data.length < pageSize) return movements;
    }
  }

  async function recordStockMovements(movements) {
    await ready;
    if (!client || !currentUser) throw new Error('Silakan login untuk menyimpan riwayat stok.');
    if (!Array.isArray(movements) || movements.length === 0) return [];
    const rows = movements.map(movement => ({
      product_id: String(movement.product_id),
      product_code: String(movement.product_code || ''),
      product_name: String(movement.product_name || ''),
      owner_code: String(movement.owner_code || ''),
      owner_name: String(movement.owner_name || ''),
      movement_type: movement.movement_type,
      quantity: Number(movement.quantity),
      gross_amount: Math.max(0, Number(movement.gross_amount) || 0),
      occurred_at: movement.occurred_at || new Date().toISOString(),
      sale_id: movement.sale_id || null,
      note: movement.note || null,
      actor_user_id: currentUser.id
    }));
    for (const row of rows) {
      if (!/^\d{4}$/.test(row.owner_code)) throw new Error('Kode owner harus 4 digit agar riwayat stok dapat dibagikan.');
      if (!['opening', 'stock_in', 'stock_out', 'sale'].includes(row.movement_type)) {
        throw new Error('Jenis mutasi stok tidak dikenali.');
      }
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) throw new Error('Jumlah mutasi stok harus lebih dari 0.');
    }
    const { data, error } = await client.from('stock_movements').insert(rows).select();
    if (error) throw error;
    return data || [];
  }

  async function listOwnerSettlements() {
    await ready;
    if (!client || !currentUser) throw new Error('Silakan login untuk memuat status pembayaran.');
    const tenantIds = await getStoreTenantUserIds();
    const pageSize = 1000;
    const settlements = [];
    for (let offset = 0; ; offset += pageSize) {
      let query = client
        .from('owner_settlements')
        .select('owner_code, owner_name, settlement_date, units_sold, gross_amount, paid_at, paid_by')
        .order('settlement_date', { ascending: false })
        .order('owner_code')
        .range(offset, offset + pageSize - 1);

      if (['admin', 'cashier'].includes(currentProfile?.role)) {
        query = query.in('paid_by', tenantIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      settlements.push(...(data || []));
      if (!data || data.length < pageSize) return settlements;
    }
  }

  async function listBookkeepingData() {
    await ready;
    if (!client || !currentUser || !currentProfile) throw new Error('Silakan login untuk memuat Buku Kas.');
    const { data, error } = await client.rpc('get_bookkeeping_data');
    if (error) throw error;
    if (!data || !Array.isArray(data.cash) || !Array.isArray(data.sales)) {
      throw new Error('Respons data Buku Kas dari Supabase tidak valid.');
    }
    return data;
  }

  async function listOwnerStorageProducts() {
    await ready;
    if (!client || !currentUser || currentProfile?.role !== 'umkm') {
      throw new Error('Fitur daftar produk titipan hanya tersedia untuk akun UMKM.');
    }
    const { data, error } = await client.rpc('get_owner_storage_products');
    if (error) throw error;
    if (!data || !Array.isArray(data.products)) {
      throw new Error('Respons produk titipan dari Supabase tidak valid.');
    }
    return data.products;
  }

  async function claimOwnerCode(ownerCode) {
    await ready;
    if (!client || !currentUser || currentProfile?.role !== 'umkm') {
      throw new Error('Pengaitan kode hanya tersedia untuk akun UMKM yang sedang login.');
    }
    const code = String(ownerCode || '').trim();
    if (!/^\d{4}$/.test(code)) throw new Error('Kode UMKM harus terdiri dari 4 angka.');
    const { data, error } = await client.rpc('claim_owner_code', { p_owner_code: code });
    if (error) throw error;
    if (data?.owner_code !== code) throw new Error('Supabase tidak mengonfirmasi perubahan kode UMKM.');
    await loadProfile(currentUser.id);
    return currentProfile;
  }

  async function updateOwnerProductIngredients(productId, ingredients) {
    await ready;
    if (!client || !currentUser || currentProfile?.role !== 'umkm') {
      throw new Error('Fitur ubah ingredient hanya tersedia untuk akun UMKM.');
    }
    if (!Array.isArray(ingredients)) throw new Error('Format ingredient tidak valid.');
    const { data, error } = await client.rpc('update_owner_product_ingredients', {
      p_product_id: String(productId),
      p_ingredients: ingredients
    });
    if (error) throw error;
    if (!data?.product) throw new Error('Produk titipan tidak ditemukan atau bukan milik akun ini.');
    return data.product;
  }

  async function markOwnerSettlement({ ownerCode, ownerName, date, unitsSold, grossAmount }) {
    await ready;
    if (!client || !currentUser) throw new Error('Silakan login untuk mencatat pembayaran.');
    if (!['admin', 'cashier'].includes(currentProfile?.role)) {
      throw new Error('Hanya Admin/Kasir Utama yang dapat menandai pembayaran owner.');
    }
    if (!/^\d{4}$/.test(String(ownerCode || ''))) throw new Error('Kode owner harus 4 digit.');
    const { data, error } = await client.from('owner_settlements').upsert({
      owner_code: String(ownerCode),
      owner_name: String(ownerName || ''),
      settlement_date: date,
      units_sold: Math.max(0, Number(unitsSold) || 0),
      gross_amount: Math.max(0, Number(grossAmount) || 0),
      paid_at: new Date().toISOString(),
      paid_by: currentUser.id
    }, { onConflict: 'owner_code,settlement_date' }).select().single();
    if (error) throw error;
    return data;
  }

  async function restoreSession() {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      session = data?.session;
      currentUser = session?.user || null;
      if (!currentUser) {
        currentProfile = null;
        localStorage.removeItem(CURRENT_KEY);
        localStorage.removeItem(LOGIN_KEY);
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      writeLocal(SESSION_KEY, session);
      writeLocal(CURRENT_KEY, currentUser);
      originalSetItem(LOGIN_KEY, 'true');
      await loadProfile(currentUser.id);
      if (!currentProfile) {
        console.warn('Profil akun tidak ditemukan di database (mungkin database baru saja direset). Sesi lama dibersihkan.');
        currentUser = null;
        session = null;
        localStorage.removeItem(CURRENT_KEY);
        localStorage.removeItem(LOGIN_KEY);
        localStorage.removeItem(SESSION_KEY);
        await client.auth.signOut().catch(() => {});
        return null;
      }
      if (currentProfile?.role === 'umkm') {
        clearUmkmLocalData();
      }
      await hydrateCloud();
      return currentUser;
    } catch (err) {
      console.warn('Gagal memulihkan sesi akun lama:', err?.message);
      currentUser = null;
      session = null;
      currentProfile = null;
      localStorage.removeItem(CURRENT_KEY);
      localStorage.removeItem(LOGIN_KEY);
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  async function signUp(email, password, name, extra = {}) {
    const cleanEmail = email.trim().toLowerCase();
    let meta = {};
    if (typeof extra === 'string') {
      meta = { name: name.trim(), owner_code: extra.trim(), role: 'umkm' };
    } else {
      meta = {
        name: name.trim(),
        role: extra.role || 'umkm',
        store_name: String(extra.storeName || '').trim(),
        store_code: String(extra.storeCode || '').trim(),
        owner_code: String(extra.ownerCode || '').trim()
      };
    }
    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: meta }
    });
    if (error) throw error;
    session = data.session;
    if (!session) {
      currentUser = null;
      currentProfile = null;
      return { needsConfirmation: true, user: data.user };
    }
    currentUser = data.user;
    await loadProfile(currentUser.id);
    if (!currentProfile) {
      throw new Error('Profil akun belum tersedia. Jalankan migrasi supabase_schema.sql di Supabase agar trigger aktif.');
    }
    writeLocal(SESSION_KEY, session);
    writeLocal(CURRENT_KEY, currentUser);
    originalSetItem(LOGIN_KEY, 'true');
    if (currentProfile?.role === 'umkm') clearUmkmLocalData();
    await hydrateCloud();
    return { needsConfirmation: false, user: currentUser };
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password
    });
    if (error) throw error;
    session = data.session;
    currentUser = data.user;
    try {
      await loadProfile(currentUser.id);
      if (!['admin', 'cashier', 'umkm'].includes(currentProfile?.role)) {
        throw new Error('Role akun belum diatur dengan benar. Hubungi administrator.');
      }
    } catch (error) {
      if (currentUser) {
        const { error: signOutError } = await client.auth.signOut();
        session = null;
        currentUser = null;
        currentProfile = null;
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(CURRENT_KEY);
        localStorage.removeItem(LOGIN_KEY);
        if (signOutError) {
          throw new Error(`${error.message} Sesi belum dapat ditutup: ${signOutError.message}`);
        }
      }
      throw error;
    }
    writeLocal(SESSION_KEY, session);
    writeLocal(CURRENT_KEY, currentUser);
    originalSetItem(LOGIN_KEY, 'true');
    await hydrateCloud();
    return currentUser;
  }

  async function resetPassword(email) {
    const configuredBase = String(window.WEBPKM_PUBLIC_URL || '').trim();
    const base = configuredBase || `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
    const redirectTo = `${base.replace(/\/$/, '')}/reset-password.html`;
    const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    if (error) throw error;
  }



  async function uploadAvatar(file) {
    await ready;
    if (!currentUser || !client) throw new Error('Silakan login terlebih dahulu.');
    if (!file) return;
    if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Ukuran foto maksimal 3 MB.');

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${currentUser.id}/avatar.${ext}`;
    const bucket = client.storage.from('avatars');
    const { error: uploadError } = await bucket.upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: '3600'
    });
    if (uploadError) throw uploadError;
    const { data } = bucket.getPublicUrl(path);
    const newAvatarUrl = `${data.publicUrl}${data.publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    const { error: updateError } = await client.auth.updateUser({
      data: { ...(currentUser.user_metadata || {}), avatar_url: newAvatarUrl }
    });
    if (updateError) throw updateError;

    try {
      await client.from('user_profiles').update({ avatar_url: newAvatarUrl }).eq('user_id', currentUser.id);
    } catch (_) {}

    currentUser = { ...currentUser, user_metadata: { ...(currentUser.user_metadata || {}), avatar_url: newAvatarUrl } };
    if (currentProfile) currentProfile.avatar_url = newAvatarUrl;
    writeLocal(CURRENT_KEY, currentUser);
    renderAccountAvatars(currentUser);
    renderProfileMenu(currentUser);
    updateNavbarAccountDisplay(currentUser);
    return newAvatarUrl;
  }

  function avatarUrl(user) {
    return String(user?.user_metadata?.avatar_url || currentProfile?.avatar_url || '').trim();
  }

  function renderAccountAvatars(user) {
    const displayName = currentProfile?.owner_name || user?.user_metadata?.name || user?.email || 'Akun';
    if (user) ensureProfileMenu(user);
    const initial = String(displayName).trim().charAt(0).toUpperCase() || 'U';
    document.querySelectorAll('[data-account-avatar]').forEach(el => {
      const url = avatarUrl(user);
      el.classList.toggle('has-photo', !!url);
      if (url) {
        el.innerHTML = `<img src="${url}" alt="Foto profil ${escapeHtml(displayName)}">`;
      } else {
        el.textContent = user ? initial : 'U';
      }
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function closeProfileMenu() {
    document.querySelector('.profile-menu')?.classList.remove('show');
    document.querySelector('.profile-menu-backdrop')?.classList.remove('show');
  }

  function renderProfileMenu(user) {
    const menu = document.querySelector('.profile-menu');
    if (!menu) return;
    const role = currentProfile?.role || user?.user_metadata?.role || 'umkm';
    const name = currentProfile?.owner_name || user?.user_metadata?.name || user?.email || 'Akun';
    const email = user?.email || '';
    const url = avatarUrl(user);
    const avatar = menu.querySelector('[data-profile-avatar]');
    if (avatar) {
      avatar.innerHTML = url ? `<img src="${url}" alt="Foto profil ${escapeHtml(name)}">` : '<span aria-hidden="true">👤</span>';
      avatar.style.cursor = 'pointer';
      avatar.title = 'Klik untuk ganti foto profil';
      avatar.onclick = () => menu.querySelector('[data-avatar-input]')?.click();
    }
    const nameEl = menu.querySelector('[data-profile-name]');
    const emailEl = menu.querySelector('[data-profile-email]');
    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = email;

    let badgeEl = menu.querySelector('[data-profile-badge]');
    if (!badgeEl && emailEl?.parentNode) {
      badgeEl = document.createElement('div');
      badgeEl.setAttribute('data-profile-badge', 'true');
      badgeEl.style.cssText = 'margin-top:6px;font-size:11px;font-weight:700;color:#245c32;background:#edf7ea;padding:4px 10px;border-radius:8px;display:inline-block;line-height:1.4;';
      emailEl.parentNode.insertBefore(badgeEl, emailEl.nextSibling);
    }
    if (badgeEl) {
      const storeCode = currentProfile?.store_code || user?.user_metadata?.store_code || '';
      const storeName = currentProfile?.store_name || user?.user_metadata?.store_name || '';
      if (role === 'admin') {
        badgeEl.innerHTML = `🏪 <b>Owner Toko</b>${storeName ? ' · ' + escapeHtml(storeName) : ''}${storeCode ? ' <span style="background:#d9f0d3;padding:2px 7px;border-radius:6px;margin-left:4px;color:#184a24;">Kode: ' + escapeHtml(storeCode) + '</span>' : ''}`;
      } else if (role === 'cashier') {
        badgeEl.innerHTML = `💼 <b>Kasir Toko</b>${storeName ? ' · ' + escapeHtml(storeName) : ''}${storeCode ? ' <span style="background:#d9f0d3;padding:2px 7px;border-radius:6px;margin-left:4px;color:#184a24;">Kode Toko: ' + escapeHtml(storeCode) + '</span>' : ''}`;
      } else {
        const umkmCode = currentProfile?.owner_code || user?.user_metadata?.owner_code || '';
        badgeEl.innerHTML = `📦 <b>Mitra UMKM</b>${storeCode ? ' · Toko: ' + escapeHtml(storeCode) : ''}${umkmCode ? ' <span style="background:#d9f0d3;padding:2px 7px;border-radius:6px;margin-left:4px;color:#184a24;">ID: ' + escapeHtml(umkmCode) + '</span>' : ''}`;
      }
    }
  }

  function ensureProfileMenu(user) {
    if (document.querySelector('.profile-menu')) { renderProfileMenu(user); return; }
    const backdrop = document.createElement('div');
    backdrop.className = 'profile-menu-backdrop';
    backdrop.addEventListener('click', closeProfileMenu);
    const menu = document.createElement('aside');
    menu.className = 'profile-menu';
    menu.setAttribute('aria-label', 'Menu Profil');
    menu.innerHTML = `
      <div class="profile-menu-head">
        <div class="profile-menu-avatar" data-profile-avatar><span aria-hidden="true">👤</span></div>
        <div class="profile-menu-info">
          <div class="profile-menu-name" data-profile-name>Akun</div>
          <div class="profile-menu-email" data-profile-email></div>
        </div>
        <button type="button" class="profile-menu-close" aria-label="Tutup">×</button>
      </div>
      <div class="profile-menu-actions">
        <button type="button" class="profile-menu-btn primary" data-change-avatar>📷 Ganti Foto Profil</button>
        <input class="profile-menu-file" data-avatar-input type="file" accept="image/png,image/jpeg,image/webp,image/gif">
        <button type="button" class="profile-menu-btn logout" data-profile-logout>↪ Logout</button>
      </div>
      <div class="profile-menu-status" data-profile-status></div>
      <div class="profile-menu-note">PNG, JPG, WEBP, atau GIF · maksimal 3 MB</div>
    `;
    document.body.append(backdrop, menu);
    menu.querySelector('.profile-menu-close').addEventListener('click', closeProfileMenu);
    menu.querySelector('[data-change-avatar]').addEventListener('click', () => menu.querySelector('[data-avatar-input]').click());
    menu.querySelector('[data-avatar-input]').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const status = menu.querySelector('[data-profile-status]');
      status.textContent = 'Mengunggah foto...';
      try {
        await uploadAvatar(file);
        status.textContent = 'Foto profil berhasil diperbarui.';
        setTimeout(() => { if (status) status.textContent = ''; }, 2500);
      } catch (error) {
        console.error('Upload avatar:', error);
        status.textContent = error?.message || 'Foto gagal diunggah.';
      } finally { e.target.value = ''; }
    });
    menu.querySelector('[data-profile-logout]').addEventListener('click', async () => {
      closeProfileMenu();
      try { await logout(); }
      catch (error) {
        console.error('Logout gagal:', error);
        const status = menu.querySelector('[data-profile-status]');
        if (status) status.textContent = error?.message || 'Logout gagal. Coba lagi.';
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfileMenu(); });
    renderProfileMenu(user);
  }

  function openProfileMenu(user) {
    ensureProfileMenu(user);
    renderProfileMenu(user);
    document.querySelector('.profile-menu')?.classList.add('show');
    document.querySelector('.profile-menu-backdrop')?.classList.add('show');
  }

  function updateNavbarAccountDisplay(user) {
    const isAuth = !!user;
    const role = currentProfile?.role || user?.user_metadata?.role || 'umkm';
    const rawName = currentProfile?.owner_name || user?.user_metadata?.name || user?.email || 'Akun';
    const storeCode = String(currentProfile?.store_code || user?.user_metadata?.store_code || '').trim();
    const ownerCode = String(currentProfile?.owner_code || user?.user_metadata?.owner_code || '').trim();

    if (user) ensureProfileMenu(user);
    renderAccountAvatars(user);

    document.querySelectorAll('[data-account-name]').forEach(el => el.textContent = rawName);
    document.querySelectorAll('[data-account-store-code]').forEach(el => el.textContent = storeCode);

    document.querySelectorAll('a').forEach(link => {
      const isAccountLink = link.classList.contains('site-account') ||
        link.classList.contains('login-button') ||
        link.classList.contains('login-btn') ||
        link.getAttribute('href') === 'login.html' ||
        link.getAttribute('href') === '#profile' ||
        link.getAttribute('href') === '#logout';

      if (!isAccountLink) return;

      const labelEl = link.querySelector('.account-label');
      const avatarEl = link.querySelector('[data-account-avatar]');

      if (avatarEl) {
        avatarEl.style.cursor = isAuth ? 'pointer' : 'default';
        avatarEl.setAttribute('role', isAuth ? 'button' : 'img');
        avatarEl.setAttribute('tabindex', isAuth ? '0' : '-1');
        if (isAuth) {
          avatarEl.onclick = e => { e.preventDefault(); e.stopPropagation(); openProfileMenu(user); };
          avatarEl.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileMenu(user); } };
        } else {
          avatarEl.onclick = null;
          avatarEl.onkeydown = null;
        }
      }

      if (isAuth) {
        link.href = '#profile';
        link.onclick = e => {
          e.preventDefault();
          openProfileMenu(user);
        };

        let codeDisplay = '';
        if (role === 'admin') {
          codeDisplay = storeCode ? `Kode: ${storeCode}` : '';
        } else if (role === 'cashier') {
          codeDisplay = storeCode ? `Toko: ${storeCode}` : '';
        } else {
          codeDisplay = storeCode ? `Toko: ${storeCode}` : (ownerCode ? `ID: ${ownerCode}` : '');
        }

        const nameHtml = `<span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;">${escapeHtml(rawName)}</span>`;
        const codeHtml = codeDisplay ? `<span style="font-size:10px;font-weight:700;background:rgba(255,255,255,0.25);padding:2px 7px;border-radius:12px;margin-left:4px;letter-spacing:0.4px;white-space:nowrap;display:inline-block;vertical-align:middle;">${escapeHtml(codeDisplay)}</span>` : '';

        if (labelEl) {
          labelEl.innerHTML = `${nameHtml} ${codeHtml}`;
        } else {
          link.innerHTML = `<span class="account-avatar" data-account-avatar></span> ${nameHtml} ${codeHtml}`;
          renderAccountAvatars(user);
        }
        link.setAttribute('aria-label', `Menu profil ${rawName}${codeDisplay ? ' · ' + codeDisplay : ''}`);
      } else {
        link.href = 'login.html';
        link.onclick = null;
        if (labelEl) labelEl.textContent = 'Masuk';
        else link.textContent = 'Masuk';
        link.setAttribute('aria-label', 'Masuk ke akun');
      }
    });

    // Tombol ajakan "Mulai Sekarang" pada halaman publik: guest menuju login,
    // user yang sudah login langsung menuju daftar fitur.
    document.querySelectorAll('a[href="login.html"]').forEach(link => {
      const text = link.textContent.trim().toLowerCase();
      const isAccount = link.classList.contains('login-button') ||
        link.classList.contains('login-btn') || link.classList.contains('site-account');
      if (isAuth && !isAccount) {
        link.href = 'fitur.html';
        if (text.includes('mulai')) link.innerHTML = 'Buka Fitur <span>→</span>';
      }
    });
  }

  function setSession(user) {
    currentUser = user;
    writeLocal(CURRENT_KEY, user);
    originalSetItem(LOGIN_KEY, 'true');
  }

  function current() { return currentUser; }
  function key(name) { return localKey(name); }
  function accounts() { return currentUser ? [currentUser] : []; }
  function read(key, fallback) { return readLocal(key, fallback); }
  function write(key, value) { writeLocal(key, value); }

  async function logout() {
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
    session = null; currentUser = null;
    currentProfile = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CURRENT_KEY);
    localStorage.removeItem(LOGIN_KEY);
    location.href = 'login.html';
  }

  async function requireAuth() {
    await ready;
    if (!current()) {
      sessionStorage.setItem('kasirTokoAfterLogin', file + location.search);
      location.replace('login.html');
      return false;
    }
    return true;
  }

  const ready = (async () => {
    const sdk = await loadSupabase();
    client = sdk.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    client.auth.onAuthStateChange((_event, newSession) => {
      session = newSession;
      currentUser = newSession?.user || null;
      if (currentUser) {
        writeLocal(SESSION_KEY, newSession);
        writeLocal(CURRENT_KEY, currentUser);
        originalSetItem(LOGIN_KEY, 'true');
      } else {
        currentProfile = null;
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(CURRENT_KEY);
        localStorage.removeItem(LOGIN_KEY);
      }
    });
    await restoreSession();
    return currentUser;
  })();

  window.KasirAuth = {
    SUPABASE_URL, SUPABASE_KEY, CURRENT_KEY, LOGIN_KEY,
    DATA_NAMES, accounts, current, read, write, key, setSession,
    logout, requireAuth, signUp, signIn, resetPassword, uploadAvatar, loadProfile, listOwnerAccounts,
    listStockMovements, recordStockMovements, listOwnerSettlements, markOwnerSettlement,
    listBookkeepingData, listOwnerStorageProducts, claimOwnerCode, updateOwnerProductIngredients, refreshInventoryProducts, saveProductsAndWait, ready,
    get session() { return session; },
    get profile() { return currentProfile; },
    get role() { return currentProfile?.role || null; },
    get isAdmin() { return currentProfile?.role === 'admin'; },
    get isCashier() { return currentProfile?.role === 'cashier'; },
    get isUmkm() { return currentProfile?.role === 'umkm'; },
    get client() { return client; }
  };

  document.addEventListener('DOMContentLoaded', async () => {
    window.addEventListener('kasir:cloud-error', event => {
      let notice = document.getElementById('cloudSyncError');
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'cloudSyncError';
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;z-index:9998;bottom:12px;left:12px;right:12px;padding:12px 16px;border-radius:10px;background:#fff0ef;color:#9f2924;font:600 13px system-ui;box-shadow:0 4px 18px #0002';
        document.body.appendChild(notice);
      }
      notice.textContent = `Sinkronisasi gagal; perubahan belum dipastikan tersimpan: ${event.detail?.message || 'Periksa koneksi Supabase.'}`;
    });
    try {
      await ready;
    } catch (error) {
      console.warn('Supabase auth ready:', error);
      if (!publicPages.includes(file)) {
        const notice = document.createElement('div');
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;z-index:9999;top:12px;left:12px;right:12px;padding:12px 16px;border-radius:10px;background:#fff0ef;color:#9f2924;font:600 13px system-ui;box-shadow:0 4px 18px #0002';
        notice.textContent = `Autentikasi/data gagal dimuat: ${error?.message || 'Periksa koneksi dan migrasi Supabase.'}`;
        document.body.prepend(notice);
        return;
      }
    }
    const user = current();
    if (protectedPages.includes(file) && !user) {
      sessionStorage.setItem('kasirTokoAfterLogin', file + location.search);
      location.replace('login.html');
      return;
    }
    if (user && currentProfile?.role === 'umkm' && protectedPages.includes(file) && file !== 'storage.html') {
      location.replace('storage.html');
      return;
    }
    if (user && currentProfile?.role === 'umkm' && file === 'fitur.html') {
      location.replace('storage.html');
      return;
    }
    if (user && file === 'login.html') {
      location.replace(currentProfile?.role === 'umkm' ? 'storage.html' : 'fitur.html');
      return;
    }
    if (user && currentProfile?.role === 'umkm') {
      document.querySelectorAll('a[href]').forEach(link => {
        const targetPage = String(link.getAttribute('href') || '').split(/[?#]/, 1)[0].toLowerCase();
        if (protectedPages.includes(targetPage) && targetPage !== 'storage.html') link.hidden = true;
      });
      const nav = document.getElementById('siteNav');
      if (nav && !nav.querySelector('a[href="storage.html"]')) {
        const storageLink = document.createElement('a');
        storageLink.href = 'storage.html';
        storageLink.textContent = 'Storage Produk';
        nav.insertBefore(storageLink, nav.querySelector('.site-account') || null);
      }
    }
    updateNavbarAccountDisplay(user);
  });
})();
