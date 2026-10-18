(() => {
  // Navbar ditangani oleh shared-navbar.js agar konsisten di semua halaman.
  const readButton = document.getElementById('readButton');
  if (readButton) {
    readButton.addEventListener('click', () => {
      const target = document.querySelector('#panduan-detail, .guide-section');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
      else {
        const toUrl = window.resolvePageUrl || KasirAuth?.pageUrl || (p => p);
        window.location.href = toUrl('panduan.html');
      }
    });
  }
})();
