
(() => {
  window.setKasirPaymentMethod = (method) => {
    const isQris = method === 'qris';
    const cashBtn = document.getElementById('payMethodCash');
    const qrisBtn = document.getElementById('payMethodQris');
    const cashInput = document.getElementById('cash');
    const btnExactCash = document.getElementById('btnExactCash');
    if (cashBtn) cashBtn.classList.toggle('active', !isQris);
    if (qrisBtn) qrisBtn.classList.toggle('active', isQris);
    if (cashInput) cashInput.readOnly = isQris;
    if (btnExactCash) btnExactCash.style.display = isQris ? 'none' : 'inline-block';
  };
  window.fillExactCash = () => {
    const cashInput = document.getElementById('cash');
    if (cashInput && !cashInput.readOnly) cashInput.value = '0';
  };

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
    let paymentMethod = 'cash';

    function setPaymentMethod(method) {
      paymentMethod = method === 'qris' ? 'qris' : 'cash';
      const cashBtn = $('payMethodCash');
      const qrisBtn = $('payMethodQris');
      const cashInput = $('cash');
      const btnExactCash = $('btnExactCash');

      if (cashBtn) cashBtn.classList.toggle('active', paymentMethod === 'cash');
      if (qrisBtn) qrisBtn.classList.toggle('active', paymentMethod === 'qris');

      if (paymentMethod === 'qris') {
        if (cashInput) {
          cashInput.value = total();
          cashInput.readOnly = true;
        }
        if (btnExactCash) btnExactCash.style.display = 'none';
      } else {
        if (cashInput) {
          cashInput.readOnly = false;
        }
        if (btnExactCash) btnExactCash.style.display = 'inline-block';
      }
      change();
    }
    window.setKasirPaymentMethod = setPaymentMethod;
    window.fillExactCash = () => {
      const cashInput = $('cash');
      if (cashInput && !cashInput.readOnly) {
        cashInput.value = total();
        change();
      }
    };

    function findProduct(code) {
      const normalized = normalizeCode(code);
      if (!normalized) return null;
      return products.find(product => normalizeCode(product.barcode) === normalized) || null;
    }

    function getScanQty() {
      const el = $('scanQty');
      if (!el) return 1;
      const val = parseInt(el.value, 10);
      return (!isNaN(val) && val >= 1) ? val : 1;
    }

    function add(code, quantity = 1) {
      const normalized = normalizeCode(code);
      const qtyToAdd = Math.max(1, parseInt(quantity, 10) || 1);
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
        if (existing.qty + qtyToAdd > stock) {
          toast(`Jumlah melebihi stok tersedia (sisa stok: ${Math.max(0, stock - existing.qty)}).`);
          return false;
        }
        existing.qty += qtyToAdd;
      } else {
        if (qtyToAdd > stock) {
          toast(`Jumlah melebihi stok tersedia (stok: ${stock}).`);
          return false;
        }
        cart.push({ ...product, qty: qtyToAdd });
      }

      render();
      toast(`${product.name || 'Produk'} ditambahkan ke keranjang.`);
      return true;
    }

    function total() {
      return cart.reduce((sum, item) => sum + Number(item.price || 0) * item.qty, 0);
    }

    function change() {
      if (paymentMethod === 'qris') {
        $('changeVal').textContent = 'Rp 0 (Pas)';
        $('change').style.background = 'var(--soft)';
        return;
      }
      const cash = Number($('cash')?.value || 0);
      const difference = cash - total();
      $('changeVal').textContent = rp(Math.max(0, difference));
      $('change').style.background = cash && difference < 0 ? 'var(--redsoft)' : 'var(--soft)';
    }

    function updateTotalSummary() {
      const count = cart.reduce((sum, item) => sum + item.qty, 0);
      $('items').textContent = `${count} item`;
      $('total').textContent = rp(total());
      $('checkout').disabled = cart.length === 0;
      $('empty').style.display = cart.length ? 'none' : 'block';
      if (paymentMethod === 'qris' && $('cash')) {
        $('cash').value = total();
      }
      change();
    }

    function render() {
      const body = $('cart');
      if (!body) return;
      body.innerHTML = '';

      cart.forEach((item) => {
        const maxStock = Number(item.stock || 0);
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>
            <b>${esc(item.name)}</b>
            <div class="small">Kode Produk: ${esc(item.code || item.productCode || '—')}</div>
            <div class="small">Barcode: ${esc(item.barcode)}</div>
          </td>
          <td>
            <div class="qty-ctrl">
              <button type="button" class="qty-btn qd" title="Kurangi 1" aria-label="Kurangi jumlah">−</button>
              <input type="number" class="qty-input" min="1" max="${maxStock}" value="${item.qty}" aria-label="Jumlah barang" title="Ketik untuk mengubah jumlah barang">
              <button type="button" class="qty-btn qi" title="Tambah 1" aria-label="Tambah jumlah">+</button>
            </div>
            <div class="small" style="margin-top:3px;text-align:center;color:var(--muted)">Maks: ${maxStock}</div>
          </td>
          <td class="money">${rp(item.price)}</td>
          <td class="money in row-subtotal">${rp(Number(item.price || 0) * item.qty)}</td>
          <td><button type="button" class="btn danger rm" title="Hapus dari keranjang">✕</button></td>`;

        const qtyInput = row.querySelector('.qty-input');
        const subtotalCell = row.querySelector('.row-subtotal');

        const commitQty = (rawVal) => {
          let val = parseInt(rawVal, 10);
          if (isNaN(val) || val < 1) val = 1;
          if (val > maxStock) {
            toast(`Stok tidak cukup. Maksimal ${maxStock}.`);
            val = maxStock;
          }
          item.qty = val;
          qtyInput.value = val;
          subtotalCell.textContent = rp(Number(item.price || 0) * item.qty);
          updateTotalSummary();
        };

        row.querySelector('.qi').onclick = () => {
          if (item.qty < maxStock) {
            commitQty(item.qty + 1);
          } else {
            toast('Stok tidak cukup.');
          }
        };

        row.querySelector('.qd').onclick = () => {
          if (item.qty > 1) {
            commitQty(item.qty - 1);
          } else {
            const idx = cart.indexOf(item);
            if (idx > -1) cart.splice(idx, 1);
            render();
          }
        };

        qtyInput.addEventListener('input', () => {
          if (qtyInput.value === '') return;
          let val = parseInt(qtyInput.value, 10);
          if (!isNaN(val)) {
            if (val > maxStock) {
              toast(`Stok tidak cukup. Maksimal ${maxStock}.`);
              val = maxStock;
              qtyInput.value = val;
            }
            if (val >= 1) {
              item.qty = val;
              subtotalCell.textContent = rp(Number(item.price || 0) * item.qty);
              updateTotalSummary();
            }
          }
        });

        qtyInput.addEventListener('blur', () => {
          commitQty(qtyInput.value);
        });

        qtyInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            commitQty(qtyInput.value);
            qtyInput.blur();
          }
        });

        row.querySelector('.rm').onclick = () => {
          const idx = cart.indexOf(item);
          if (idx > -1) cart.splice(idx, 1);
          render();
        };

        body.appendChild(row);
      });

      updateTotalSummary();
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
        button.onclick = () => {
          const qty = getScanQty();
          if (add(button.dataset.code, qty)) {
            const qtyInput = $('scanQty');
            if (qtyInput) qtyInput.value = '1';
          }
        };
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
      const qtyInput = $('scanQty');
      const code = input.value;
      const qty = getScanQty();
      if (add(code, qty)) {
        input.value = '';
        if (qtyInput) qtyInput.value = '1';
      }
      input.focus();
    });

    // Beberapa scanner mengirim Enter sebagai keydown sebelum submit form.
    $('scan').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        $('scanForm').requestSubmit();
      }
    });

    $('scanQty')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        if (!$('scan').value.trim()) {
          $('scan').focus();
        } else {
          $('scanForm').requestSubmit();
        }
      }
    });

    window.addEventListener('kasir:barcode-detected', event => {
      $('scan').value = event.detail.code;
      $('scanForm').requestSubmit();
    });
    cameraScanner.setReady();

    $('quickSearch').addEventListener('input', quick);
    $('cash').addEventListener('input', change);
    $('payMethodCash')?.addEventListener('click', () => setPaymentMethod('cash'));
    $('payMethodQris')?.addEventListener('click', () => setPaymentMethod('qris'));
    $('btnExactCash')?.addEventListener('click', () => {
      if ($('cash')) {
        $('cash').value = total();
        change();
      }
    });

    $('clear').addEventListener('click', () => {
      cart = [];
      $('cash').value = '';
      setPaymentMethod('cash');
      const qtyInput = $('scanQty');
      if (qtyInput) qtyInput.value = '1';
      render();
      $('scan').focus();
    });

    $('checkout').addEventListener('click', async () => {
      const transactionTotal = total();
      if (!cart.length) return toast('Keranjang masih kosong.');

      let cashReceived = Number($('cash').value || 0);
      if (paymentMethod === 'qris') {
        cashReceived = transactionTotal;
      } else {
        if (cashReceived < transactionTotal) return toast('Uang diterima kurang.');
      }

      const checkoutBtn = $('checkout');
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = '⏳ Menyimpan Transaksi...';

      try {
        const now = new Date();
        const uniqueSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
        const saleId = 'TRX-' + Date.now() + '-' + uniqueSuffix;
        const soldItems = cart.map(item => ({
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
        }));

        const methodLabel = paymentMethod === 'qris' ? 'QRIS' : 'Tunai';

        const sale = {
          id: saleId,
          date: now.toISOString(),
          items: soldItems,
          total: transactionTotal,
          cash: cashReceived,
          change: cashReceived - transactionTotal,
          paymentMethod: paymentMethod,
          paymentMethodLabel: methodLabel
        };

        const cashEntry = {
          id: saleId,
          date: sale.date,
          type: 'penjualan',
          amount: transactionTotal,
          desc: `Penjualan [${methodLabel}] ` + cart.map(item => `${item.name} x${item.qty}`).join(', '),
          saleId: saleId,
          paymentMethod: paymentMethod
        };

        // Rekam transaksi secara atomik di Supabase (aman untuk multi-perangkat kasir bersamaan)
        await KasirAuth.recordPosTransaction({
          sale,
          cash: cashEntry,
          items: soldItems
        });

        const rows = cart.map(item =>
          `<div style="display:flex;justify-content:space-between"><span>${esc(item.name)} x${item.qty}</span><span>${rp(item.price * item.qty)}</span></div>`
        ).join('');

        const receiptWindow = window.open('', '_blank', 'width=430,height=650');
        if (receiptWindow) {
          // Jangan menaruh literal </script> di source HTML utama; struk ditulis setelah JS berjalan.
          const receiptScript = '<' + '/script>';
          receiptWindow.document.write(`<!doctype html><html><body style="font-family:monospace;padding:20px">
            <h2 style="text-align:center">KASIRTOKO</h2>
            <div>${now.toLocaleString('id-ID')}</div>
            <div style="font-size:11px;color:#666">No: ${saleId}</div><hr>${rows}<hr>
            <div style="display:flex;justify-content:space-between"><b>TOTAL</b><b>${rp(transactionTotal)}</b></div>
            <div style="display:flex;justify-content:space-between">Metode Bayar <b>${methodLabel}</b></div>
            <div style="display:flex;justify-content:space-between">Bayar <span>${rp(cashReceived)}</span></div>
            <div style="display:flex;justify-content:space-between">Kembali <span>${rp(cashReceived - transactionTotal)}</span></div>
            <hr><p style="text-align:center">Terima kasih 🙏</p>
            <script>window.onload=()=>setTimeout(()=>window.print(),200)${receiptScript}
          </body></html>`);
          receiptWindow.document.close();
        }

        cart = [];
        $('cash').value = '';
        setPaymentMethod('cash');
        const qtyInput = $('scanQty');
        if (qtyInput) qtyInput.value = '1';
        render();
        quick();
        toast('Transaksi tercatat otomatis ✅');
        $('scan').focus();
      } catch (error) {
        console.error('Transaksi gagal disimpan:', error);
        toast(`Gagal menyimpan transaksi: ${error.message}`);
      } finally {
        checkoutBtn.textContent = '🧾 Selesaikan & Cetak Struk';
        checkoutBtn.disabled = cart.length === 0;
      }
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