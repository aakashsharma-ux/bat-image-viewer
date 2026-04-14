(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════
     VIRTUAL GALLERY ENGINE
     ─────────────────────────────────────────────────────
     Strategy:
       1. allUrls[]  = master list (never touches DOM directly)
       2. slots[]    = one lightweight <div> per URL in the DOM
                       Each slot occupies the correct grid space
                       but holds NO image until it becomes visible.
       3. IntersectionObserver watches every slot.
          - Entering viewport (+200vh margin) → build & insert real card
          - Leaving viewport  (+200vh margin) → destroy card, free <img>
       Result: regardless of how many URLs are loaded, only ~30-80
       real card DOM nodes exist at any given time.
  ════════════════════════════════════════════════════════ */

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

  /* ── State ── */
  let allUrls    = [];
  let slots      = [];
  let activeSet  = new Set();   // indices with a live card in the DOM
  let isLoading  = false;
  let stTimer    = null;
  let curH       = '240px';
  let observer   = null;

  /* ════════════════════════════════════════════════════════
     SIZE PRESETS
  ════════════════════════════════════════════════════════ */
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
    curH = s.h;
    sizeBadge.textContent = s.label;
    gallery.style.gridTemplateColumns = s.cols === 1
      ? '1fr'
      : 'repeat(' + s.cols + ', minmax(0, 1fr))';
    gallery.dataset.imgH = curH;

    /* Update every slot height so the grid layout stays correct */
    slots.forEach(function (slot) {
      slot.style.minHeight = curH;
      const box = slot.querySelector('.card-img-box');
      if (box) box.style.height = curH;
    });
  }

  sizer.addEventListener('input', function () { applySize(parseInt(sizer.value)); });
  applySize(parseInt(sizer.value));

  /* ════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════ */
  bulkArea.addEventListener('input', refreshTally);

  function refreshTally() {
    const n = parseUrls(bulkArea.value).length;
    bulkTally.innerHTML = '<b>' + n + '</b> URL' + (n !== 1 ? 's' : '') + ' detected';
  }

  function parseUrls(txt) {
    return txt
      .split(/[\n,]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 6; })
      .slice(0, 1000);
  }

  function isUrl(s) {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
    } catch (e) { return false; }
  }

  function showSt(msg, cls, ms) {
    ms = ms || 3000;
    clearTimeout(stTimer);
    bSt.textContent = msg;
    bSt.className = 'status ' + cls;
    stTimer = setTimeout(function () { bSt.className = 'status hide'; }, ms);
  }

  function refreshCount() {
    gCount.textContent = allUrls.length;
  }

  /* ════════════════════════════════════════════════════════
     SLOT SYSTEM
  ════════════════════════════════════════════════════════ */

  /* Lightweight placeholder that reserves grid space */
  function makeSlot(i) {
    const slot = document.createElement('div');
    slot.className = 'vslot';
    slot.style.minHeight = curH;
    slot.dataset.idx = String(i);
    return slot;
  }

  /* Full interactive card — built only when slot enters viewport */
  function buildCard(i) {
    const url = allUrls[i];
    const idx = i + 1;

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
    const box = document.createElement('div');
    box.className = 'card-img-box';
    box.style.height = curH;

    const spinWrap = document.createElement('div');
    spinWrap.className = 'card-spinner';
    spinWrap.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spinWrap);

    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt = 'Image ' + idx;
    img.decoding = 'async';

    img.addEventListener('load', function () {
      spinWrap.remove();
      if (img.naturalWidth) {
        dims.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
      }
    });

    img.addEventListener('error', function () {
      spinWrap.remove();
      box.innerHTML =
        '<div class="card-err">\u26a0 Could not load image' +
        '<small style="opacity:.45;word-break:break-all;display:block;margin-top:4px;">' +
        url + '</small></div>';
    });

    /* src set AFTER handlers are bound to avoid race condition */
    img.src = url;
    box.appendChild(img);

    /* ── ZOOM ──────────────────────────────────────────────
       Scale range : 1× (normal) → 5× (max)
       Origin      : cursor position inside the box
       Scroll inside box → zoom; scroll outside → normal page scroll
       Mouse-leave → smoothly reset to 1× after 400 ms idle
    ──────────────────────────────────────────────────────── */
    const ZOOM_MIN   = 1;
    const ZOOM_MAX   = 5;
    const ZOOM_STEP  = 0.12;   // scale delta per wheel tick

    let zScale  = 1;           // current scale
    let zOriginX = 50;         // transform-origin X in %
    let zOriginY = 50;         // transform-origin Y in %
    let resetTimer = null;
    let isInsideBox = false;

    /* Zoom badge that shows current scale */
    const zoomBadge = document.createElement('div');
    zoomBadge.className = 'zoom-badge';
    zoomBadge.textContent = '1\u00d7';
    box.appendChild(zoomBadge);

    /* Reset zoom helper */
    function resetZoom(instant) {
      clearTimeout(resetTimer);
      zScale   = 1;
      zOriginX = 50;
      zOriginY = 50;
      img.style.transition = instant
        ? 'none'
        : 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94), transform-origin 0.1s';
      img.style.transformOrigin = '50% 50%';
      img.style.transform       = 'scale(1)';
      zoomBadge.classList.remove('visible');
      box.classList.remove('zoomed');
    }

    /* Apply current scale/origin to the img */
    function applyZoom(fast) {
      img.style.transition = fast
        ? 'transform 0.08s ease-out'
        : 'transform 0.15s ease-out';
      img.style.transformOrigin = zOriginX + '% ' + zOriginY + '%';
      img.style.transform       = 'scale(' + zScale.toFixed(3) + ')';

      /* Update badge */
      zoomBadge.textContent = zScale.toFixed(1) + '\u00d7';
      if (zScale > 1.05) {
        zoomBadge.classList.add('visible');
        box.classList.add('zoomed');
      } else {
        zoomBadge.classList.remove('visible');
        box.classList.remove('zoomed');
      }
    }

    /* Wheel handler — only fires when cursor is inside the box */
    box.addEventListener('wheel', function (e) {
      if (!isInsideBox) return;
      e.preventDefault();       /* stop page scroll while inside box */
      e.stopPropagation();

      /* Compute cursor position as % of box dimensions */
      const rect = box.getBoundingClientRect();
      zOriginX = ((e.clientX - rect.left)  / rect.width)  * 100;
      zOriginY = ((e.clientY - rect.top)   / rect.height) * 100;

      /* Normalise delta across trackpad / mouse */
      const delta = e.deltaY !== 0 ? e.deltaY : -e.deltaX;
      const dir   = delta > 0 ? -1 : 1;          /* up = zoom-in */

      zScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zScale + dir * ZOOM_STEP));
      applyZoom(true);

      /* Auto-reset if user scrolls back to 1× */
      clearTimeout(resetTimer);
      if (zScale <= ZOOM_MIN + 0.01) resetZoom(false);
    }, { passive: false });

    /* Track whether cursor is inside the image box */
    box.addEventListener('mouseenter', function () {
      isInsideBox = true;
      clearTimeout(resetTimer);
    });

    box.addEventListener('mouseleave', function () {
      isInsideBox = false;
      /* Delay reset so user can move to adjacent card without jarring snap */
      resetTimer = setTimeout(function () {
        if (zScale > ZOOM_MIN) resetZoom(false);
      }, 500);
    });

    /* Double-click to toggle between 2.5× and reset */
    box.addEventListener('dblclick', function (e) {
      const rect = box.getBoundingClientRect();
      if (zScale > 1.05) {
        resetZoom(false);
      } else {
        zOriginX = ((e.clientX - rect.left)  / rect.width)  * 100;
        zOriginY = ((e.clientY - rect.top)   / rect.height) * 100;
        zScale = 2.5;
        applyZoom(false);
      }
    });

    /* Scroll-to-zoom hint (shows on first hover, hides when zoomed) */
    const zoomHint = document.createElement('div');
    zoomHint.className = 'zoom-hint';
    zoomHint.textContent = 'Scroll to zoom  \u2022  Double-click to toggle 2.5\u00d7';
    box.appendChild(zoomHint);

    /* url row */
    const urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';
    const urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url;
    urlTxt.textContent = url;
    urlRow.appendChild(urlTxt);

    /* toolbar */
    const toolbar = document.createElement('div');
    toolbar.className = 'card-toolbar';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'tcopy';
    copyBtn.textContent = 'Copy Link';
    let copyTimer = null;

    copyBtn.addEventListener('click', function () {
      const doCopy = navigator.clipboard
        ? navigator.clipboard.writeText(url)
        : new Promise(function (res) {
            const t = document.createElement('textarea');
            t.value = url; t.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(t); t.select();
            document.execCommand('copy'); t.remove(); res();
          });
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
    removeBtn.className = 'tremove';
    removeBtn.textContent = 'Remove';

    removeBtn.addEventListener('click', function () {
      /* Remove from master data & slot array */
      allUrls.splice(i, 1);
      const slot = slots.splice(i, 1)[0];
      activeSet.delete(i);

      /* Re-index remaining slots so their idx stays accurate */
      for (let j = i; j < slots.length; j++) {
        slots[j].dataset.idx = String(j);
        const n = slots[j].querySelector('.card-num');
        if (n) n.textContent = 'Image ' + (j + 1);
      }

      card.classList.add('out');
      setTimeout(function () {
        observer.unobserve(slot);
        slot.remove();
        refreshCount();
      }, 240);
    });

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(removeBtn);

    card.appendChild(hdr);
    card.appendChild(box);
    card.appendChild(urlRow);
    card.appendChild(toolbar);

    return card;
  }

  /* Upgrade slot → real card */
  function activateSlot(slot) {
    const i = parseInt(slot.dataset.idx, 10);
    if (activeSet.has(i) || i >= allUrls.length) return;
    activeSet.add(i);
    slot.innerHTML = '';
    slot.appendChild(buildCard(i));
  }

  /* Downgrade slot → empty placeholder, freeing the <img> memory */
  function deactivateSlot(slot) {
    const i = parseInt(slot.dataset.idx, 10);
    if (!activeSet.has(i)) return;
    activeSet.delete(i);
    /* Null src first to encourage browser to release the decoded bitmap */
    slot.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    slot.innerHTML = '';
  }

  /* IntersectionObserver:
     rootMargin '200% 0px 200% 0px' = start loading 2 viewport-heights
     before the card enters view, and keep alive 2vp below.
     This eliminates visible pop-in even at fast scroll speeds. */
  function buildObserver() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          activateSlot(entry.target);
        } else {
          deactivateSlot(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '200% 0px 200% 0px',
      threshold: 0
    });

    slots.forEach(function (slot) { observer.observe(slot); });
  }

  /* ════════════════════════════════════════════════════════
     CLEAR
  ════════════════════════════════════════════════════════ */
  function clearGallery() {
    if (observer) { observer.disconnect(); observer = null; }
    gallery.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    gallery.innerHTML = '';
    allUrls   = [];
    slots     = [];
    activeSet = new Set();
    refreshCount();
  }

  /* ════════════════════════════════════════════════════════
     BULK LOAD
     Phase 1: Build all slot placeholders in chunks (fast, no images).
     Phase 2: Hand off to IntersectionObserver → images load on demand.
  ════════════════════════════════════════════════════════ */
  bulkLoadBtn.addEventListener('click', async function () {
    if (isLoading) return;

    const urls = parseUrls(bulkArea.value).filter(isUrl);
    if (!urls.length) { showSt('No valid URLs found. Check your input.', 'err'); return; }

    isLoading = true;
    bulkLoadBtn.disabled = true;

    if (!appendMode.checked) clearGallery();

    const startIdx = allUrls.length;
    allUrls = allUrls.concat(urls);

    progWrap.classList.add('on');
    progFill.style.width = '0%';
    progLabel.textContent = 'Building grid for ' + urls.length + ' images\u2026';

    /* Disconnect observer while we batch-insert slots for performance */
    if (observer) observer.disconnect();

    const CHUNK = 200;
    let frag = document.createDocumentFragment();

    for (let i = 0; i < urls.length; i++) {
      const slot = makeSlot(startIdx + i);
      slots.push(slot);
      frag.appendChild(slot);

      if ((i + 1) % CHUNK === 0 || i === urls.length - 1) {
        gallery.appendChild(frag);
        frag = document.createDocumentFragment();

        const pct = Math.round(((i + 1) / urls.length) * 100);
        progFill.style.width = pct + '%';
        progLabel.textContent = (i + 1) + ' / ' + urls.length + ' slots placed\u2026';
        refreshCount();

        await new Promise(function (r) {
          requestAnimationFrame(function () { requestAnimationFrame(r); });
        });
      }
    }

    /* Now observe all slots — visible ones get activated immediately */
    buildObserver();

    refreshCount();
    progLabel.textContent = urls.length + ' images queued \u2014 loading visible ones\u2026';
    showSt(
      urls.length + ' image' + (urls.length > 1 ? 's' : '') +
      ' ready. Scroll to load more.',
      'ok', 4000
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

  bulkClearBtn.addEventListener('click', function () { bulkArea.value = ''; refreshTally(); });
  clearAllBtn.addEventListener('click', clearGallery);

  /* ── BACK TO TOP ── */
  window.addEventListener('scroll', function () {
    btt.classList.toggle('show', window.scrollY > 320);
  }, { passive: true });

  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  refreshCount();
  refreshTally();

})();
