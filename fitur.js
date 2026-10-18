(() => {
  // Navbar ditangani oleh shared-navbar.js agar konsisten di semua halaman.
  const toUrl = page => (window.resolvePageUrl || window.KasirAuth?.pageUrl || (p => p))(page);

  document.querySelectorAll('.tool-card[data-page]').forEach(card => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    const open = async () => {
      const page = card.dataset.page;
      if (!page) return;
      try {
        await window.KasirAuth?.ready;
        if (!window.KasirAuth?.current()) {
          sessionStorage.setItem('kasirTokoAfterLogin', page);
          window.location.href = toUrl('login.html');
          return;
        }
        window.location.href = toUrl(page);
      } catch (error) {
        console.error('Auth:', error);
        sessionStorage.setItem('kasirTokoAfterLogin', page);
        window.location.href = toUrl('login.html');
      }
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  window.openTool = async function(tool) {
    const pages = {
      barcode: 'produk.html',
      kasir: 'kasir.html',
      dashboard: 'dashboard.html',
      storage: 'storage.html',
      'buku-kas': 'buku-kas.html',
      keuntungan: 'perbandingan.html',
      ingredients: 'scan-ingredient.html'
    };
    const page = pages[tool];
    if (!page) return;
    try {
      await window.KasirAuth?.ready;
      if (!window.KasirAuth?.current()) {
        sessionStorage.setItem('kasirTokoAfterLogin', page);
        window.location.href = toUrl('login.html');
        return;
      }
      window.location.href = toUrl(page);
    } catch (error) {
      console.error('Auth:', error);
      window.location.href = toUrl(page);
    }
  };
})();
