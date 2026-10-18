(() => {
  // Navbar ditangani oleh shared-navbar.js agar konsisten di semua halaman.
  const readButton = document.getElementById('readButton');
  if (readButton) {
    readButton.addEventListener('click', () => {
      const target = document.querySelector('#panduan-detail, .guide-section');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
      else window.location.href = 'panduan.html';
    });
  }
})();
