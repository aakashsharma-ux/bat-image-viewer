(function () {
  'use strict';

  /* ── DOM refs ── */
  const gallery      = document.getElementById('gallery');
  const bulkArea     = document.getElementById('bulkArea');
  const bulkTally    = document.getElementById('bulkTally');
  const bulkLoadBtn  = document.getElementById('bulkLoadBtn');
  const bulkClearBtn = document.getElementById('bulkClearBtn');
  const appendMode   = document.getElementById('appendMode');
  const bSt          = document.getElementById('bSt');
  const progWrap     = document.getElementById('progWrap');
  const progFill     = document.getElementById('progFill');
  const progLabel    = document.getElementById('progLabel');
  const gCount       = document.getElementById('gCount');
  const clearAllBtn  = document.getElementById('clearAll');
  const btt          = document.getElementById('btt');
  const sizer        = document.getElementById('sizer');
  const sizeBadge    = document.getElementById('sizeBadge');

  let cardIndex = 0;
  let isLoading = false;
  let stTimer   = null;

  /* ── SIZE PRESETS ── */
  const SIZES = [
    { label: 'Tiny',      cols: 5, h: '140px' },
    { label: 'Small',     cols: 4, h: '180px' },
    { label: 'Medium',    cols: 3, h: '240px' },
    { label: 'Large',     cols: 2, h: '340px' },
    { label: 'XL',        cols: 2, h: '480px' },
    { label: 'XXL',       cols: 1, h: '540px' },
    { label: '1/Screen',  cols: 1, h: '72vh'  },
    { label: '1/Screen+', cols: 1, h: '82vh'  },
    { label: 'Full',      cols: 1, h: '90vh'  },
    { label: 'Max',       cols: 1, h: '96vh'  },
  ];

  function applySize(val) {
    const s = SIZES[val - 1];
    sizeBadge.textContent = s.label;
    gallery.style.gridTemplateColumns = s.cols === 1
      ? '1fr'
      : 'repeat(' + s.cols + ', minmax(0, 1fr))';
    document.querySelectorAll('.card-img-box').forEach(b => {
      b.style.height = s.h;
    });
    gallery.dataset.imgH = s.h;
  }

  sizer.addEventListener('input', () => applySize(parseInt(sizer.value)));
  applySize(parseInt(sizer.value));

  /* ── URL COUNTER ── */
  bulkArea.addEventListener('input', refreshTally);

  function refreshTally() {
    const n = parseUrls(bulkArea.value).length;
    bulkTally.innerHTML = '<b>' + n + '</b> URL' + (n !== 1 ? 's' : '') + ' detected';
  }

  /* ── HELPERS ── */
  function parseUrls(txt) {
    return txt
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 6)
      .slice(0, 1000);
  }

  function isUrl(s) {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
    } catch {
      return false;
    }
  }

  function showSt(msg, cls, ms) {
    ms = ms || 3000;
    clearTimeout(stTimer);
    bSt.textContent = msg;
    bSt.className = 'status ' + cls;
    stTimer = setTimeout(() => { bSt.className = 'status hide'; }, ms);
  }

  /* ── COUNT ── */
  function refreshCount() {
    gCount.textContent = gallery.querySelectorAll('.card').length;
  }

  /* ── CLEAR GALLERY ── */
  function clearGallery() {
    gallery.querySelectorAll('.card').forEach(c => c.remove());
    cardIndex = 0;
    refreshCount();
  }

  /* ── CREATE CARD ── */
  function createCard(url) {
    cardIndex++;
    const idx  = cardIndex;
    const curH = gallery.dataset.imgH || '240px';

    /* card wrapper */
    const card = document.createElement('div');
    card.className = 'card';

    /* header */
    const hdr  = document.createElement('div');
    hdr.className = 'card-header';

    const num  = document.createElement('span');
    num.className = 'card-num';
    num.textContent = 'Image ' + idx;

    const dims = document.createElement('span');
    dims.className = 'card-dims';

    hdr.appendChild(num);
    hdr.appendChild(dims);

    /* image box */
    const box  = document.createElement('div');
    box.className = 'card-img-box';
    box.style.height = curH;

    const spinWrap = document.createElement('div');
    spinWrap.className = 'card-spinner';
    spinWrap.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spinWrap);

    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt       = 'Image ' + idx;
    img.decoding  = 'async';

    /* attach handlers BEFORE setting src to avoid race condition */
    img.addEventListener('load', function () {
      spinWrap.remove();
      if (img.naturalWidth) {
        dims.textContent = img.naturalWidth + ' x ' + img.naturalHeight;
      }
    });

    img.addEventListener('error', function () {
      spinWrap.remove();
      box.innerHTML =
        '<div class="card-err">' +
          '&#9888; Could not load image<br>' +
          '<small style="opacity:.45;word-break:break-all;display:block;margin-top:4px;">' + url + '</small>' +
        '</div>';
    });

    img.src = url;   /* src set AFTER handlers are bound */
    box.appendChild(img);

    /* url row */
    const urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';

    const urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title     = url;
    urlTxt.textContent = url;
    urlRow.appendChild(urlTxt);

    /* toolbar */
    const toolbar = document.createElement('div');
    toolbar.className = 'card-toolbar';

    const copyBtn = document.createElement('button');
    copyBtn.className   = 'tcopy';
    copyBtn.textContent = 'Copy Link';
    let copyTimer = null;

    copyBtn.addEventListener('click', function () {
      var doCopy;
      if (navigator.clipboard) {
        doCopy = navigator.clipboard.writeText(url);
      } else {
        doCopy = new Promise(function (res) {
          var t = document.createElement('textarea');
          t.value = url;
          t.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(t);
          t.select();
          document.execCommand('copy');
          t.remove();
          res();
        });
      }
      doCopy.then(function () {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('ok');
        clearTimeout(copyTimer);
        copyTimer = setTimeout(function () {
          copyBtn.textContent = 'Copy Link';
          copyBtn.classList.remove('ok');
        }, 1600);
      });
    });

    const removeBtn = document.createElement('button');
    removeBtn.className   = 'tremove';
    removeBtn.textContent = 'Remove';

    removeBtn.addEventListener('click', function () {
      card.classList.add('out');
      setTimeout(function () { card.remove(); refreshCount(); }, 240);
    });

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(removeBtn);

    card.appendChild(hdr);
    card.appendChild(box);
    card.appendChild(urlRow);
    card.appendChild(toolbar);

    return card;
  }

  /* ── BULK LOAD ──
     Default behaviour: REPLACE existing images (auto-clear).
     "Append to existing" checkbox: accumulate across loads instead.
  */
  bulkLoadBtn.addEventListener('click', async function () {
    if (isLoading) return;

    const urls = parseUrls(bulkArea.value).filter(isUrl);
    if (!urls.length) {
      showSt('No valid URLs found. Check your input.', 'err');
      return;
    }

    isLoading = true;
    bulkLoadBtn.disabled = true;

    /* Auto-clear unless append mode is on */
    if (!appendMode.checked) {
      clearGallery();
    }

    progWrap.classList.add('on');
    progFill.style.width = '0%';
    progLabel.textContent = 'Preparing ' + urls.length + ' image' + (urls.length > 1 ? 's' : '') + '\u2026';

    const CHUNK = 40;
    let done = 0;

    for (let i = 0; i < urls.length; i += CHUNK) {
      const frag = document.createDocumentFragment();
      urls.slice(i, i + CHUNK).forEach(function (u) {
        frag.appendChild(createCard(u));
      });
      gallery.appendChild(frag);

      done = Math.min(i + CHUNK, urls.length);
      progFill.style.width = Math.round((done / urls.length) * 100) + '%';
      progLabel.textContent = done + ' / ' + urls.length + ' loaded\u2026';
      refreshCount();

      /* yield to browser so it can paint + decode images */
      await new Promise(function (r) {
        requestAnimationFrame(function () { requestAnimationFrame(r); });
      });
    }

    refreshCount();
    progLabel.textContent = urls.length + ' image' + (urls.length > 1 ? 's' : '') + ' ready!';
    showSt(
      urls.length + ' image' + (urls.length > 1 ? 's' : '') + ' loaded into the Batcave.',
      'ok',
      3500
    );
    setTimeout(function () {
      progWrap.classList.remove('on');
      progFill.style.width = '0%';
    }, 2400);

    bulkArea.value = '';
    refreshTally();
    isLoading = false;
    bulkLoadBtn.disabled = false;
  });

  /* Clear input textarea */
  bulkClearBtn.addEventListener('click', function () {
    bulkArea.value = '';
    refreshTally();
  });

  /* Manual clear all cards */
  clearAllBtn.addEventListener('click', clearGallery);

  /* ── BACK TO TOP ── */
  window.addEventListener('scroll', function () {
    btt.classList.toggle('show', window.scrollY > 320);
  }, { passive: true });

  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* init */
  refreshCount();
  refreshTally();

})();
