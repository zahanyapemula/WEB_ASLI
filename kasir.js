
(() => {
  const setupCameraScanner = () => {
    const $ = id => document.getElementById(id);
    let reader = null;
    let controls = null;
    let devices = [];
    let activeDeviceId = null;
    let facingMode = 'environment';
    let generation = 0;
    let ready = false;
    let pendingBarcode = null;

    const showStatus = message => { $('cameraStatus').textContent = message; };
    const stopStream = () => {
      controls?.stop();
      controls = null;
      reader?.reset();
      const video = $('cameraPreview');
      video.srcObject?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      activeDeviceId = null;
    };
    const stop = () => {
      generation++;
      stopStream();
      $('cameraModal').hidden = true;
    };
    const emitBarcode = code => {
      if (!ready) {
        pendingBarcode = code;
        return;
      }
      window.dispatchEvent(new CustomEvent('kasir:barcode-detected', { detail: { code } }));
    };
    const cameraErrorMessage = error => {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        return 'Izin kamera ditolak. Izinkan akses kamera untuk situs ini di pengaturan browser.';
      }
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        return 'Kamera tidak ditemukan. Pastikan perangkat memiliki kamera yang dapat digunakan.';
      }
      if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
      }
      return 'Kamera gagal dibuka. Pastikan halaman memakai HTTPS atau localhost, izin kamera aktif, dan kamera tidak sedang dipakai aplikasi lain.';
    };
    const refreshDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        devices = [];
        return false;
      }
      try {
        devices = (await navigator.mediaDevices.enumerateDevices())
          .filter(device => device.kind === 'videoinput');
      } catch (error) {
        console.error('Daftar kamera tidak dapat dibaca:', error);
        devices = [];
        $('switchCamera').disabled = true;
        showStatus('Kamera aktif, tetapi daftar kamera tambahan tidak dapat dibaca.');
        return false;
      }
      activeDeviceId = $('cameraPreview').srcObject?.getVideoTracks()[0]?.getSettings().deviceId || activeDeviceId;
      $('switchCamera').disabled = devices.length < 2;
      $('switchCamera').textContent = devices.length < 2
        ? '🔄 Hanya satu kamera tersedia'
        : `🔄 Ganti ke kamera ${facingMode === 'environment' ? 'depan' : 'belakang'}`;
      return true;
    };
    const start = async (deviceId, isFallback = false) => {
      stopStream();
      const requestId = ++generation;
      $('switchCamera').disabled = true;
      showStatus('Menghubungkan kamera...');
      try {
        const nextReader = new ZXing.BrowserMultiFormatReader();
        reader = nextReader;
        const nextControls = await nextReader.decodeFromVideoDevice(
          deviceId || undefined,
          $('cameraPreview'),
          result => {
            if (requestId !== generation || !result) return;
            const code = result.getText();
            stop();
            emitBarcode(code);
          }
        );
        if (requestId !== generation) {
          nextControls.stop();
          nextReader.reset();
          return;
        }
        controls = nextControls;
        if (await refreshDevices()) showStatus('Arahkan kamera ke barcode produk.');
      } catch (error) {
        if (requestId !== generation) return;
        if (!deviceId && !isFallback && error.name !== 'NotAllowedError' && navigator.mediaDevices?.enumerateDevices) {
          try {
            const available = (await navigator.mediaDevices.enumerateDevices())
              .filter(device => device.kind === 'videoinput');
            if (available.length) {
              await start(available[0].deviceId, true);
              return;
            }
          } catch (enumerationError) {
            console.error('Daftar kamera fallback tidak dapat dibaca:', enumerationError);
          }
        }
        showStatus(cameraErrorMessage(error));
        $('switchCamera').disabled = false;
      }
    };

    $('openCamera').addEventListener('click', async () => {
      $('cameraModal').hidden = false;
      facingMode = 'environment';
      $('switchCamera').textContent = '🔄 Ganti ke kamera depan';
      if (!window.ZXing?.BrowserMultiFormatReader) {
        showStatus('Pemindai barcode belum termuat. Muat ulang halaman dan periksa koneksi internet.');
        return;
      }
      if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
        showStatus('Browser memblokir kamera di alamat ini. Buka aplikasi melalui HTTPS atau localhost.');
        return;
      }
      await start();
    });
    $('switchCamera').addEventListener('click', async () => {
      if (devices.length < 2) return;
      const nextMode = facingMode === 'environment' ? 'user' : 'environment';
      const labelPattern = nextMode === 'user' ? /front|user|fac(e|ing)/i : /back|rear|environment|world/i;
      const nextDevice = devices.find(device => device.deviceId !== activeDeviceId && labelPattern.test(device.label))
        || devices.find(device => device.deviceId !== activeDeviceId);
      if (!nextDevice) {
        showStatus('Tidak ditemukan kamera lain yang dapat digunakan.');
        return;
      }
      facingMode = nextMode;
      await start(nextDevice.deviceId);
    });
    $('closeCamera').addEventListener('click', stop);
    $('cameraModal').addEventListener('click', event => {
      if (event.target === $('cameraModal')) stop();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('cameraModal').hidden) stop();
    });

    return {
      setReady() {
        ready = true;
        if (pendingBarcode !== null) {
          const code = pendingBarcode;
          pendingBarcode = null;
          emitBarcode(code);
        }
      }
    };
  };

  const cameraScanner = setupCameraScanner();

  const boot = async () => {
    try {
      await KasirAuth.ready;
    } catch (error) {
      console.error('Kasir gagal memuat sesi:', error);
      return;
    }

    const STORE = {
      products: KasirAuth.key('products'),
      sales: KasirAuth.key('sales'),
      cash: KasirAuth.key('cash')
    };

    const $ = id => document.getElementById(id);
    const load = (key, fallback = []) => {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
      } catch {
        return fallback;
      }
    };
    const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
    const toast = message => {
      const el = $('toast');
      if (!el) return;
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(el._timer);
      el._timer = setTimeout(() => el.classList.remove('show'), 2200);
    };
    const normalizeCode = value => String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, '')
      .trim();

    let products = load(STORE.products, []);
    let cart = [];

    function findProduct(code) {
      const normalized = normalizeCode(code);
      if (!normalized) return null;
      return products.find(product => normalizeCode(product.barcode) === normalized) || null;
    }

    function add(code) {
      const normalized = normalizeCode(code);
      if (!normalized) {
        toast('Masukkan atau scan kode barcode terlebih dahulu.');
        return false;
      }

      const product = findProduct(normalized);
      if (!product) {
        toast('Barcode tidak ditemukan. Pastikan produk sudah dibuat di Produk.');
        return false;
      }

      const stock = Number(product.stock || 0);
      if (stock <= 0) {
        toast(`Stok ${product.name || 'produk'} habis. Atur stok di Storage.`);
        return false;
      }

      const existing = cart.find(item => item.id === product.id);
      if (existing) {
        if (existing.qty >= stock) {
          toast('Jumlah melebihi stok tersedia.');
          return false;
        }
        existing.qty += 1;
      } else {
        cart.push({ ...product, qty: 1 });
      }

      render();
      toast(`${product.name || 'Produk'} ditambahkan ke keranjang.`);
      return true;
    }

    function total() {
      return cart.reduce((sum, item) => sum + Number(item.price || 0) * item.qty, 0);
    }

    function change() {
      const cash = Number($('cash')?.value || 0);
      const difference = cash - total();
      $('changeVal').textContent = rp(Math.max(0, difference));
      $('change').style.background = cash && difference < 0 ? 'var(--redsoft)' : 'var(--soft)';
    }

    function render() {
      const body = $('cart');
      if (!body) return;
      body.innerHTML = '';
      $('empty').style.display = cart.length ? 'none' : 'block';

      cart.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><b>${esc(item.name)}</b><div class="small">Kode Produk: ${esc(item.code || item.productCode || '—')}</div><div class="small">Barcode: ${esc(item.barcode)}</div></td>
          <td>
            <div style="display:flex;gap:5px;align-items:center">
              <button type="button" class="btn secondary qd">−</button>
              <b>${item.qty}</b>
              <button type="button" class="btn secondary qi">+</button>
            </div>
          </td>
          <td class="money">${rp(item.price)}</td>
          <td class="money in">${rp(Number(item.price || 0) * item.qty)}</td>
          <td><button type="button" class="btn danger rm">✕</button></td>`;

        row.querySelector('.qi').onclick = () => {
          if (item.qty < Number(item.stock || 0)) item.qty += 1;
          else toast('Stok tidak cukup.');
          render();
        };
        row.querySelector('.qd').onclick = () => {
          item.qty -= 1;
          if (item.qty <= 0) cart.splice(index, 1);
          render();
        };
        row.querySelector('.rm').onclick = () => {
          cart.splice(index, 1);
          render();
        };
        body.appendChild(row);
      });

      const count = cart.reduce((sum, item) => sum + item.qty, 0);
      $('items').textContent = `${count} item`;
      $('total').textContent = rp(total());
      $('checkout').disabled = cart.length === 0;
      change();
    }

    function quick() {
      const box = $('quick');
      if (!box) return;
      const query = $('quickSearch').value.trim().toLocaleLowerCase('id-ID');
      const visibleProducts = products.filter(product =>
        [product.name, product.code, product.productCode, product.barcode]
          .some(value => String(value || '').toLocaleLowerCase('id-ID').includes(query))
      );
      box.innerHTML = visibleProducts.map(product => `
        <button type="button" class="product" style="text-align:left;cursor:pointer" data-code="${esc(product.barcode)}">
          <h4>${esc(product.name)}</h4>
          <div class="price">${rp(product.price)}</div>
          <div class="small">Kode Produk: ${esc(product.code || product.productCode || '—')}</div>
          <div class="small">Stok ${Number(product.stock || 0)} · Barcode: ${esc(product.barcode)}</div>
        </button>`).join('');
      if (!visibleProducts.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = products.length ? 'Produk tidak ditemukan.' : 'Belum ada produk.';
        box.appendChild(empty);
      }
      box.querySelectorAll('[data-code]').forEach(button => {
        button.onclick = () => add(button.dataset.code);
      });
    }

    function refreshProducts() {
      products = load(STORE.products, []);
      const validIds = new Set(products.map(product => product.id));
      cart = cart
        .filter(item => validIds.has(item.id))
        .map(item => {
          const current = products.find(product => product.id === item.id);
          return current ? { ...current, qty: Math.min(item.qty, Number(current.stock || 0)) } : item;
        })
        .filter(item => item.qty > 0);
      quick();
      render();
    }

    $('scanForm').addEventListener('submit', event => {
      event.preventDefault();
      const input = $('scan');
      const code = input.value;
      if (add(code)) input.value = '';
      input.focus();
    });

    // Beberapa scanner mengirim Enter sebagai keydown sebelum submit form.
    $('scan').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        $('scanForm').requestSubmit();
      }
    });


    window.addEventListener('kasir:barcode-detected', event => {
      $('scan').value = event.detail.code;
      $('scanForm').requestSubmit();
    });
    cameraScanner.setReady();

    $('quickSearch').addEventListener('input', quick);
    $('cash').addEventListener('input', change);
    $('clear').addEventListener('click', () => {
      cart = [];
      $('cash').value = '';
      render();
      $('scan').focus();
    });

    $('checkout').addEventListener('click', () => {
      const cashReceived = Number($('cash').value || 0);
      const transactionTotal = total();
      if (!cart.length) return toast('Keranjang masih kosong.');
      if (cashReceived < transactionTotal) return toast('Uang diterima kurang.');

      const now = new Date();
      const sale = {
        id: 'TRX-' + Date.now(),
        date: now.toISOString(),
        items: cart.map(item => ({
          id: item.id,
          name: item.name,
          code: item.code || item.productCode || '',
          productCode: item.productCode || item.code || '',
          barcode: item.barcode,
          owner: item.owner || '',
          ownerCode: item.ownerCode || '',
          qty: item.qty,
          price: Number(item.price || 0),
          cost: Number(item.cost || 0),
          total: Number(item.price || 0) * item.qty
        })),
        total: transactionTotal,
        cash: cashReceived,
        change: cashReceived - transactionTotal
      };

      const sales = load(STORE.sales, []);
      sales.push(sale);
      save(STORE.sales, sales);

      products.forEach(product => {
        const sold = cart.find(item => item.id === product.id);
        if (sold) product.stock = Math.max(0, Number(product.stock || 0) - sold.qty);
      });
      save(STORE.products, products);
      const stockSaleMovements = cart
        .filter(item => /^\d{4}$/.test(String(item.ownerCode || '')))
        .map(item => ({
          product_id: item.id,
          product_code: item.code || item.productCode,
          product_name: item.name,
          owner_code: item.ownerCode,
          owner_name: item.owner,
          movement_type: 'sale',
          quantity: item.qty,
          gross_amount: Number(item.total) || Number(item.price || 0) * item.qty,
          occurred_at: sale.date,
          sale_id: sale.id
        }));
      if (stockSaleMovements.length) {
        KasirAuth.recordStockMovements(stockSaleMovements).catch(error => {
          console.error('Riwayat penjualan stok gagal disinkronkan:', error);
          toast(`Transaksi tersimpan, tetapi rekap stok belum tersinkron: ${error.message}`);
        });
      }

      const cash = load(STORE.cash, []);
      cash.push({
        id: sale.id,
        date: sale.date,
        type: 'penjualan',
        amount: transactionTotal,
        desc: 'Penjualan ' + cart.map(item => `${item.name} x${item.qty}`).join(', '),
        saleId: sale.id
      });
      save(STORE.cash, cash);

      const rows = cart.map(item =>
        `<div style="display:flex;justify-content:space-between"><span>${esc(item.name)} x${item.qty}</span><span>${rp(item.price * item.qty)}</span></div>`
      ).join('');

      const receiptWindow = window.open('', '_blank', 'width=430,height=650');
      if (receiptWindow) {
        // Jangan menaruh literal </script> di source HTML utama; struk ditulis setelah JS berjalan.
        const receiptScript = '<' + '/script>';
        receiptWindow.document.write(`<!doctype html><html><body style="font-family:monospace;padding:20px">
          <h2 style="text-align:center">KASIRTOKO</h2>
          <div>${now.toLocaleString('id-ID')}</div><hr>${rows}<hr>
          <div style="display:flex;justify-content:space-between"><b>TOTAL</b><b>${rp(transactionTotal)}</b></div>
          <div style="display:flex;justify-content:space-between">Bayar <span>${rp(cashReceived)}</span></div>
          <div style="display:flex;justify-content:space-between">Kembali <span>${rp(cashReceived - transactionTotal)}</span></div>
          <hr><p style="text-align:center">Terima kasih 🙏</p>
          <script>window.onload=()=>setTimeout(()=>window.print(),200)${receiptScript}
        </body></html>`);
        receiptWindow.document.close();
      }

      cart = [];
      $('cash').value = '';
      render();
      quick();
      toast('Transaksi tercatat otomatis ✅');
      $('scan').focus();
    });

    window.addEventListener('storage', refreshProducts);
    window.addEventListener('webpkm:data-change', event => {
      if (event.detail?.name === 'products' || !event.detail?.name) refreshProducts();
    });

    quick();
    render();
    $('scan').focus();
  };

  if (window.KasirAuth?.ready) boot();
  else window.addEventListener('load', boot, { once: true });
})();