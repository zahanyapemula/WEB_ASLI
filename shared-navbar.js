(() => {
  const button = document.getElementById('siteMenuToggle');
  const nav = document.getElementById('siteNav');
  if (!button || !nav) return;
  const close = () => { nav.classList.remove('open'); button.setAttribute('aria-expanded','false'); };
  button.setAttribute('aria-expanded','false');
  button.addEventListener('click', e => {
    e.stopPropagation();
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !button.contains(e.target)) close();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 850) close(); });
})();
