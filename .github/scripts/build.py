import os
import re
import shutil

SRC = "."
DEST = "_site"
BASE = "/WEB_ASLI"

# 1. Kumpulkan semua nama halaman HTML (selain index.html)
html_pages = set()
for f in os.listdir(SRC):
    if f.endswith(".html") and f != "index.html":
        html_pages.add(f[:-5])

print(f"Halaman HTML ditemukan: {html_pages}")

# 2. Bersihkan dan buat folder _site
if os.path.exists(DEST):
    shutil.rmtree(DEST)
os.makedirs(DEST)

# 3. Copy semua file NON-html ke _site (js, css, gambar, font, dll)
for item in os.listdir(SRC):
    if item.startswith(".") or item == "_site" or item.endswith(".html"):
        continue
    src_path = os.path.join(SRC, item)
    dst_path = os.path.join(DEST, item)
    if os.path.isdir(src_path):
        shutil.copytree(src_path, dst_path)
    else:
        shutil.copy2(src_path, dst_path)

# 4. Fungsi perbaikan link di file HTML
def fix_links(content, is_subpage):
    prefix = "../" if is_subpage else ""

    def replace_href(m):
        quote = m.group(1)
        url = m.group(2)
        if re.match(r'^(https?://|#|mailto:|tel:|/)', url):
            return m.group(0)
        if url == "index.html" or url == "./index.html":
            new_url = "../" if is_subpage else "./"
            return f'href={quote}{new_url}{quote}'
        name = url[:-5] if url.endswith(".html") else None
        if name and name in html_pages:
            new_url = f"{prefix}{name}/" if is_subpage else f"{name}/"
            return f'href={quote}{new_url}{quote}'
        if is_subpage and not url.startswith("../") and not url.startswith("/"):
            return f'href={quote}../{url}{quote}'
        return m.group(0)

    def replace_src(m):
        quote = m.group(1)
        url = m.group(2)
        if re.match(r'^(https?://|//|/)', url):
            return m.group(0)
        if is_subpage and not url.startswith("../"):
            return f'src={quote}../{url}{quote}'
        return m.group(0)

    def replace_action(m):
        quote = m.group(1)
        url = m.group(2)
        if re.match(r'^(https?://|#|/)', url):
            return m.group(0)
        name = url[:-5] if url.endswith(".html") else None
        if name and name in html_pages:
            new_url = f"{prefix}{name}/" if is_subpage else f"{name}/"
            return f'action={quote}{new_url}{quote}'
        return m.group(0)

    def replace_data_page(m):
        quote = m.group(1)
        url = m.group(2)
        name = url[:-5] if url.endswith(".html") else url
        if name in html_pages:
            # Gunakan URL absolut /WEB_ASLI/produk agar tidak masuk folder /fitur/
            return f'data-page={quote}{BASE}/{name}{quote}'
        return m.group(0)

    content = re.sub(r'href=(["\'])([^"\']+)\1', replace_href, content)
    content = re.sub(r'src=(["\'])([^"\']+)\1', replace_src, content)
    content = re.sub(r'action=(["\'])([^"\']+)\1', replace_action, content)
    content = re.sub(r'data-page=(["\'])([^"\']+)\1', replace_data_page, content)
    return content

# 5. Build file HTML
if os.path.exists("index.html"):
    with open("index.html", "r", encoding="utf-8") as f:
        content = f.read()
    content = fix_links(content, is_subpage=False)
    with open(os.path.join(DEST, "index.html"), "w", encoding="utf-8") as f:
        f.write(content)
    print("[OK] index.html")

for page in html_pages:
    src_file = f"{page}.html"
    with open(src_file, "r", encoding="utf-8") as f:
        raw_content = f.read()

    # Subfolder clean URL: _site/page/index.html
    dst_dir = os.path.join(DEST, page)
    dst_file = os.path.join(dst_dir, "index.html")
    os.makedirs(dst_dir, exist_ok=True)
    content_sub = fix_links(raw_content, is_subpage=True)
    with open(dst_file, "w", encoding="utf-8") as f:
        f.write(content_sub)

    # Root fallback: _site/page.html
    content_root = fix_links(raw_content, is_subpage=False)
    with open(os.path.join(DEST, f"{page}.html"), "w", encoding="utf-8") as f:
        f.write(content_root)

    print(f"[OK] {src_file} -> {page}/index.html & {page}.html")

# 6. Patch file JS di dalam _site
fitur_js = os.path.join(DEST, "fitur.js")
if os.path.exists(fitur_js):
    with open(fitur_js, "r", encoding="utf-8") as f:
        js = f.read()
    js = js.replace("'login.html'", f"'{BASE}/login'")
    js = js.replace('"login.html"', f'"{BASE}/login"')
    for p in html_pages:
        js = js.replace(f"'{p}.html'", f"'{BASE}/{p}'")
        js = js.replace(f'"{p}.html"', f'"{BASE}/{p}"')
    with open(fitur_js, "w", encoding="utf-8") as f:
        f.write(js)
    print("[OK] Patched _site/fitur.js")

auth_js = os.path.join(DEST, "auth.js")
if os.path.exists(auth_js):
    with open(auth_js, "r", encoding="utf-8") as f:
        js = f.read()
    old_detect = "const file = (location.pathname.split('/').pop() || '').toLowerCase();"
    new_detect = (
        "const _parts = location.pathname.split('/').filter(Boolean);\n"
        "  let _last = _parts.length ? _parts[_parts.length - 1].toLowerCase() : '';\n"
        "  if (_last === 'web_asli') _last = 'index.html';\n"
        "  else if (_last && !_last.endsWith('.html')) _last += '.html';\n"
        "  const file = _last || 'index.html';"
    )
    js = js.replace(old_detect, new_detect)
    js = js.replace("location.replace('login.html')", f"location.replace('{BASE}/login')")
    js = js.replace("location.href = 'login.html'", f"location.href = '{BASE}/login'")
    js = js.replace("location.replace('storage.html')", f"location.replace('{BASE}/storage')")
    js = js.replace(
        "location.replace(currentProfile?.role === 'umkm' ? 'storage.html' : 'fitur.html')",
        f"location.replace(currentProfile?.role === 'umkm' ? '{BASE}/storage' : '{BASE}/fitur')"
    )
    with open(auth_js, "w", encoding="utf-8") as f:
        f.write(js)
    print("[OK] Patched _site/auth.js")

login_js = os.path.join(DEST, "login.js")
if os.path.exists(login_js):
    with open(login_js, "r", encoding="utf-8") as f:
        js = f.read()
    new_redirect = (
        "let t = target.replace(/\\.html$/i, '');\n"
        f"      if (t.startsWith('/')) location.href = t;\n"
        f"      else if (t === 'index') location.href = '{BASE}/';\n"
        f"      else location.href = '{BASE}/' + t;"
    )
    js = js.replace("location.href = target;", new_redirect)
    with open(login_js, "w", encoding="utf-8") as f:
        f.write(js)
    print("[OK] Patched _site/login.js")

for js_name, old_str, new_str in [
    ("register.js", "location.href = 'storage.html'", f"location.href = '{BASE}/storage'"),
    ("register-toko.js", "location.href = 'fitur.html'", f"location.href = '{BASE}/fitur'"),
    ("reset-password.js", "location.href = 'login.html'", f"location.href = '{BASE}/login'"),
]:
    p_js = os.path.join(DEST, js_name)
    if os.path.exists(p_js):
        with open(p_js, "r", encoding="utf-8") as f:
            content = f.read()
        content = content.replace(old_str, new_str)
        with open(p_js, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[OK] Patched _site/{js_name}")

print("\n[DONE] Build selesai.")
