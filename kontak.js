(() => {
  const button = document.getElementById('menuToggle');
  const menu = document.getElementById('navMenu');
  if (!button || !menu) return;
  const close = () => { menu.classList.remove('open'); button.setAttribute('aria-expanded', 'false'); };
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', e => { e.stopPropagation(); const open = !menu.classList.contains('open'); menu.classList.toggle('open', open); button.setAttribute('aria-expanded', String(open)); });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('click', e => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); });
})();
