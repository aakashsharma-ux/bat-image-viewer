/* ════════════════════════════════════════════════════════════
   BAT-VIEWER  app.js  v14

   CHANGES FROM v13:
   ─ REMOVED: lightbox / overlay / openLightbox / closeLightbox
   ─ REMOVED: click-to-open behavior
   ─ RESTORED: inline scroll-wheel zoom on card image box
   ─ ZERO CROP GUARANTEE:
       At s=1 → .card-img-box has NO overflow → full image visible
       At s>1 → JS adds class "zoomed" → overflow:hidden clips zoom
   ─ ADDED: theme toggle (Night ↔ Moon) with smooth CSS transition
   ─ Z key syncs with zoom checkbox (existing feature, preserved)
   ─ All other behavior (W/S scroll, virtual gallery, bulk load,
     drag-pan, space-pan) preserved exactly from v13
════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  function $id(id) { return document.getElementById(id); }

  /* ── DOM refs ── */
  var html          = document.documentElement;
  var gallery       = $id('gallery');
  var bulkArea      = $id('bulkArea');
  var bulkTally     = $id('bulkTally');
  var bulkLoadBtn   = $id('bulkLoadBtn');
  var bulkClearBtn  = $id('bulkClearBtn');
  var appendMode    = $id('appendMode');
  var statusMsg     = $id('statusMsg');
  var progWrap      = $id('progWrap');
  var progFill      = $id('progFill');
  var progLabel     = $id('progLabel');
  var gCount        = $id('gCount');
  var clearAllBtn   = $id('clearAllBtn');
  var btt           = $id('btt');
  var sizerEl       = $id('sizer');
  var sizeBadgeEl   = $id('sizeBadge');
  var scrollSpeedEl = $id('scrollSpeed');
  var scrollBadgeEl = $id('scrollBadge');
  var zoomEnabledEl = $id('zoomEnabled');
  var themeToggleEl = $id('themeToggle');
  var themeLabelEl  = $id('themeLabel');

  /* ════════════════════════════════════════════════════════
     THEME TOGGLE  (Night ↔ Moon)
     Persists via localStorage.
  ════════════════════════════════════════════════════════ */
  var savedTheme = localStorage.getItem('bv-theme') || 'night';
  applyTheme(savedTheme);

  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    themeToggleEl.checked = (theme === 'moon');
    themeLabelEl.textContent = theme === 'moon' ? '\uD83C\uDF15 Moon' : '\uD83C\uDF19 Night';
    localStorage.setItem('bv-theme', theme);
  }

  themeToggleEl.addEventListener('change', function () {
    applyTheme(themeToggleEl.checked ? 'moon' : 'night');
  });

  /* ════════════════════════════════════════════════════════
     SIZE PRESETS
     max-height applied to .card-img — box has NO fixed height.
     At max-height: object-fit:contain scales down while keeping
     full image visible. At 'none': no cap, image is full size.
  ════════════════════════════════════════════════════════ */
  var SIZE_PRESETS = [
    { label: 'Tiny',      cols: 5, maxH: '120px' },
    { label: 'Small',     cols: 4, maxH: '160px' },
    { label: 'Medium',    cols: 3, maxH: '220px' },
    { label: 'Large',     cols: 2, maxH: '320px' },
    { label: 'XL',        cols: 2, maxH: '440px' },
    { label: 'XXL',       cols: 1, maxH: '540px' },
    { label: '1/Screen',  cols: 1, maxH: '70vh'  },
    { label: '1/Screen+', cols: 1, maxH: '80vh'  },
    { label: 'Full',      cols: 1, maxH: '90vh'  },
    { label: 'Max',       cols: 1, maxH: 'none'  },
  ];

  var currentMaxH = SIZE_PRESETS[2].maxH;

  function applySize(v) {
    var p = SIZE_PRESETS[Math.min(9, Math.max(0, v - 1))];
    currentMaxH = p.maxH;
    sizeBadgeEl.textContent = p.label;
    gallery.style.gridTemplateColumns =
      p.cols === 1 ? '1fr' : 'repeat(' + p.cols + ',minmax(0,1fr))';
    gallery.querySelectorAll('.card-img').forEach(function (img) {
      img.style.maxHeight = p.maxH;
    });
    gallery.querySelectorAll('.vslot').forEach(function (s) {
      s.style.minHeight = p.maxH === 'none' ? '200px' : p.maxH;
    });
  }

  sizerEl.addEventListener('input', function () { applySize(parseInt(sizerEl.value, 10)); });
  applySize(parseInt(sizerEl.value, 10));

  /* ════════════════════════════════════════════════════════
     SCROLL SPEED  (W/S only, never affects mouse wheel)
  ════════════════════════════════════════════════════════ */
  var SCROLL_PRESETS = [
    { label: 'Very Slow', base: 15,  max:  50, ramp:  7 },
    { label: 'Slow',      base: 30,  max: 100, ramp: 13 },
    { label: 'Medium',    base: 55,  max: 170, ramp: 22 },
    { label: 'Fast',      base: 90,  max: 260, ramp: 36 },
    { label: 'Very Fast', base: 140, max: 400, ramp: 55 },
  ];

  function getScrollPreset() {
    return SCROLL_PRESETS[Math.min(4, Math.max(0, parseInt(scrollSpeedEl.value, 10) - 1))];
  }

  scrollSpeedEl.addEventListener('input', function () {
    scrollBadgeEl.textContent = getScrollPreset().label;
  });
  scrollBadgeEl.textContent = getScrollPreset().label;

  /* ════════════════════════════════════════════════════════
     ZOOM TOGGLE  (off by default; Z key syncs)
  ════════════════════════════════════════════════════════ */
  function zoomOn() { return zoomEnabledEl.checked; }

  /* ════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════ */
  function parseUrls(txt) {
    return txt.split(/[\n,]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 6; })
      .slice(0, 1000);
  }

  function isUrl(s) {
    try { var u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:'; }
    catch (e) { return false; }
  }

  function isTypingTarget() {
    var a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }

  var stTid = null;
  function showStatus(msg, cls, ms) {
    clearTimeout(stTid);
    statusMsg.textContent = msg;
    statusMsg.className = 'status ' + (cls || 'ok');
    stTid = setTimeout(function () { statusMsg.className = 'status hide'; }, ms || 3000);
  }

  bulkArea.addEventListener('input', function () {
    var n = parseUrls(bulkArea.value).length;
    bulkTally.innerHTML = '<b>' + n + '</b> URL' + (n !== 1 ? 's' : '');
  });

  function refreshCount() { gCount.textContent = allUrls.length; }

  /* ════════════════════════════════════════════════════════
     VIRTUAL GALLERY ENGINE
  ════════════════════════════════════════════════════════ */
  var allUrls   = [];
  var slots     = [];
  var activeSet = new Set();
  var observer  = null;
  var isLoading = false;

  function makeUrlLabel(url) {
    var s = document.createElement('span');
    s.className = 'url-label'; s.textContent = url;
    return s;
  }

  function makeSlot(i) {
    var slot = document.createElement('div');
    slot.className = 'vslot';
    slot.style.minHeight = (currentMaxH === 'none' ? '200px' : currentMaxH);
    slot.dataset.idx = String(i);
    slot.appendChild(makeUrlLabel(allUrls[i]));
    return slot;
  }

  function activateSlot(slot) {
    var i = parseInt(slot.dataset.idx, 10);
    if (activeSet.has(i) || i >= allUrls.length) return;
    activeSet.add(i);
    slot.innerHTML = '';
    slot.appendChild(buildCard(i));
  }

  function deactivateSlot(slot) {
    var i = parseInt(slot.dataset.idx, 10);
    if (!activeSet.has(i)) return;
    activeSet.delete(i);
    slot.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    slot.innerHTML = '';
    if (i < allUrls.length) slot.appendChild(makeUrlLabel(allUrls[i]));
  }

  function rebuildObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) activateSlot(e.target);
        else deactivateSlot(e.target);
      });
    }, { root: null, rootMargin: '200% 0px 200% 0px', threshold: 0 });
    slots.forEach(function (s) { observer.observe(s); });
  }

  function clearGallery() {
    if (observer) { observer.disconnect(); observer = null; }
    gallery.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    gallery.innerHTML = '';
    allUrls = []; slots = []; activeSet = new Set();
    refreshCount();
  }

  /* ════════════════════════════════════════════════════════
     CARD FACTORY

     IMAGE RENDERING (zero-crop contract):
     ─ .card-img-box has NO overflow in CSS
     ─ At s=1: box.classList has NO "zoomed" → no overflow → full image
     ─ At s>1: box.classList has "zoomed"    → overflow:hidden clips zoom
     ─ img: width:100%; height:auto; max-height from slider
     ─ object-fit:contain on img ensures full visibility under max-height

     ZOOM (inline scroll-wheel):
     ─ translate(tx,ty) scale(s) on the img element
     ─ transform-origin fixed at 0 0 (no jumps)
     ─ Cursor-anchored: math keeps the hovered pixel stationary
     ─ Resets on mouseLeave after 700ms
     ─ Only active when zoomOn() is true

     CLICK: does nothing. No lightbox, no tab, no modal.
  ════════════════════════════════════════════════════════ */
  function buildCard(ci) {
    var url = allUrls[ci];
    var num = ci + 1;

    var card = document.createElement('div');
    card.className = 'card';

    /* header */
    var hdr    = document.createElement('div');
    hdr.className = 'card-header';
    var numEl  = document.createElement('span');
    numEl.className = 'card-num'; numEl.textContent = 'Image ' + num;
    var dimsEl = document.createElement('span');
    dimsEl.className = 'card-dims';
    hdr.appendChild(numEl); hdr.appendChild(dimsEl);

    /* image box — no overflow:hidden in CSS, added dynamically */
    var box = document.createElement('div');
    box.className = 'card-img-box';

    /* spinner */
    var spin = document.createElement('div');
    spin.className = 'card-spinner';
    spin.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spin);

    /* image — natural size rendering */
    var img = document.createElement('img');
    img.className = 'card-img';
    img.alt = 'Image ' + num;
    img.decoding = 'async';
    img.draggable = false;
    img.style.transformOrigin = '0 0';
    img.style.maxHeight = currentMaxH;

    img.addEventListener('load', function () {
      spin.remove();
      if (img.naturalWidth) {
        dimsEl.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
      }
      syncCursor();
    });

    img.addEventListener('error', function () {
      spin.remove();
      box.innerHTML =
        '<div class="card-err">\u26a0 Could not load<br>' +
        '<small style="opacity:.4;word-break:break-all;">' + url + '</small></div>';
    });

    img.src = url;
    box.appendChild(img);

    /* zoom overlays */
    var badge = document.createElement('div');
    badge.className = 'zoom-badge';
    box.appendChild(badge);

    var hint = document.createElement('div');
    hint.className = 'zoom-hint';
    hint.textContent = 'Scroll\u2022zoom    Drag\u2022pan    Dbl-click\u2022reset';
    box.appendChild(hint);

    /* ─────────────────────────────────────────────────────
       ZOOM + DRAG STATE (per card, inline)
       transform = translate(tx,ty) scale(s)  origin = 0 0
    ───────────────────────────────────────────────────── */
    var Z_MIN = 1, Z_MAX = 5, Z_FACTOR = 1.13;
    var s = 1, tx = 0, ty = 0;
    var inside = false, dragging = false;
    var dragStartX = 0, dragStartY = 0, dragTx0 = 0, dragTy0 = 0;
    var dragMoved = false, resetTid = null;

    function clamp(ns, ntx, nty) {
      var bw = box.offsetWidth, bh = box.offsetHeight;
      return {
        tx: Math.min(0, Math.max(bw - bw * ns, ntx)),
        ty: Math.min(0, Math.max(bh - bh * ns, nty))
      };
    }

    function applyTf(animate) {
      img.style.transition = animate
        ? 'transform 0.27s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
      img.style.transform =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
    }

    function syncBadge() {
      badge.textContent = s.toFixed(1) + '\u00d7';
      var z = s > 1.02;
      badge.classList.toggle('visible', z);
      /* Add/remove overflow:hidden dynamically based on zoom level */
      box.classList.toggle('zoomed', z);
    }

    function syncCursor() {
      box.classList.toggle('zoom-ready', zoomOn() && s <= 1.02);
      box.classList.toggle('zoomed', s > 1.02);
      if (!zoomOn() && s <= 1.02) {
        box.classList.remove('zoom-ready', 'zoomed', 'zoom-drag');
      }
    }

    function resetZoom() {
      clearTimeout(resetTid);
      s = 1; tx = 0; ty = 0;
      applyTf(true); syncBadge(); syncCursor();
    }

    /* Wheel zoom — strict boundary, only when enabled */
    box.addEventListener('wheel', function (e) {
      if (!zoomOn()) return;

      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (cx < 0 || cy < 0 || cx > r.width || cy > r.height) return;

      e.preventDefault();
      e.stopPropagation();

      var factor = e.deltaY < 0 ? Z_FACTOR : 1 / Z_FACTOR;
      var ns = Math.min(Z_MAX, Math.max(Z_MIN, s * factor));
      if (ns === s) return;

      /* cursor-anchored zoom math */
      var c = clamp(ns, cx - (cx - tx) / s * ns, cy - (cy - ty) / s * ns);
      s = ns; tx = c.tx; ty = c.ty;
      applyTf(false); syncBadge(); syncCursor();
      clearTimeout(resetTid);
      if (s <= Z_MIN + 0.02) resetZoom();
    }, { passive: false });

    box.addEventListener('mouseenter', function () {
      inside = true; clearTimeout(resetTid); syncCursor();
    });

    box.addEventListener('mouseleave', function () {
      inside = false;
      if (!dragging && s > Z_MIN + 0.02) resetTid = setTimeout(resetZoom, 700);
      syncCursor();
    });

    /* Left-drag pan — only when zoomed */
    box.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !zoomOn() || s <= 1.02 || gState.spaceHeld) return;
      e.preventDefault();
      dragging = true; dragMoved = false;
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragTx0 = tx; dragTy0 = ty;
      clearTimeout(resetTid);
      box.classList.add('zoom-drag'); box.classList.remove('zoomed');
    });

    function onDocMove(e) {
      if (!dragging) return;
      var dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
      var c = clamp(s, dragTx0 + dx, dragTy0 + dy);
      tx = c.tx; ty = c.ty;
      img.style.transition = 'none';
      img.style.transform =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
    }

    function onDocUp() {
      if (!dragging) return;
      dragging = false;
      box.classList.remove('zoom-drag'); box.classList.add('zoomed');
      syncCursor();
      if (!inside && s > Z_MIN + 0.02) resetTid = setTimeout(resetZoom, 700);
    }

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup',   onDocUp);

    /* Double-click — toggle 2.5× (NO lightbox, stays inline) */
    box.addEventListener('dblclick', function (e) {
      if (!zoomOn() || dragMoved) return;
      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (s > 1.05) {
        resetZoom();
      } else {
        var ns = 2.5;
        var c  = clamp(ns, cx - (cx - tx) / s * ns, cy - (cy - ty) / s * ns);
        s = ns; tx = c.tx; ty = c.ty;
        applyTf(true); syncBadge(); syncCursor();
      }
    });

    /* Zoom toggle change → update cursor on existing cards */
    zoomEnabledEl.addEventListener('change', function () {
      if (!zoomOn() && s > 1.02) resetZoom();
      else syncCursor();
    });

    /* Cleanup document listeners when virtualized away */
    box._destroy = function () {
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup',   onDocUp);
    };

    syncCursor();

    /* URL row (Ctrl+F searchable) */
    var urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';
    var urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url; urlTxt.textContent = url;
    urlRow.appendChild(urlTxt);

    /* Toolbar */
    var toolbar = document.createElement('div');
    toolbar.className = 'card-toolbar';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'tcopy'; copyBtn.textContent = 'Copy Link';
    var cpTid = null;
    copyBtn.addEventListener('click', function () {
      var p = navigator.clipboard
        ? navigator.clipboard.writeText(url)
        : Promise.resolve().then(function () {
            var t = document.createElement('textarea');
            t.value = url; t.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
          });
      p.then(function () {
        copyBtn.textContent = 'Copied!'; copyBtn.classList.add('ok');
        clearTimeout(cpTid);
        cpTid = setTimeout(function () {
          copyBtn.textContent = 'Copy Link'; copyBtn.classList.remove('ok');
        }, 1500);
      });
    });

    var removeBtn = document.createElement('button');
    removeBtn.className = 'tremove'; removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      if (box._destroy) box._destroy();
      allUrls.splice(ci, 1);
      var slot = slots.splice(ci, 1)[0];
      activeSet.delete(ci);
      for (var j = ci; j < slots.length; j++) {
        slots[j].dataset.idx = String(j);
        var n = slots[j].querySelector('.card-num');
        if (n) n.textContent = 'Image ' + (j + 1);
      }
      refreshCount();
      card.classList.add('out');
      setTimeout(function () {
        if (observer) observer.unobserve(slot);
        slot.remove();
      }, 230);
    });

    toolbar.appendChild(copyBtn); toolbar.appendChild(removeBtn);
    card.appendChild(hdr); card.appendChild(box);
    card.appendChild(urlRow); card.appendChild(toolbar);
    return card;
  }

  /* deactivateSlot — cleanup drag listeners */
  function deactivateSlotWithCleanup(slot) {
    var box = slot.querySelector('.card-img-box');
    if (box && box._destroy) box._destroy();
    deactivateSlot(slot);
  }

  /* ════════════════════════════════════════════════════════
     GLOBAL SPACE-PAN STATE
     Space + drag pans the zoomed image the cursor is over.
  ════════════════════════════════════════════════════════ */
  var gState = {
    spaceHeld: false, hoveredBox: null,
    spacePanBox: null, spaceDrag: false,
    spaceStartX: 0, spaceStartY: 0, spaceTx0: 0, spaceTy0: 0
  };

  document.addEventListener('mouseover', function (e) {
    gState.hoveredBox = (e.target.closest ? e.target.closest('.card-img-box') : null) || null;
  }, { passive: true });

  /* ════════════════════════════════════════════════════════
     KEYBOARD
  ════════════════════════════════════════════════════════ */
  var scrollVel = 0, scrollDir = 0, scrollRafId = null;
  var heldKeys  = {};

  function scrollTick() {
    if (scrollDir === 0) return;
    var p = getScrollPreset();
    scrollVel = Math.min(p.max, scrollVel + p.ramp);
    window.scrollBy({ top: scrollDir * scrollVel, behavior: 'instant' });
    scrollRafId = requestAnimationFrame(scrollTick);
  }

  function startScroll(dir) {
    if (scrollDir === dir) return;
    cancelAnimationFrame(scrollRafId);
    scrollDir = dir; scrollVel = getScrollPreset().base;
    scrollRafId = requestAnimationFrame(scrollTick);
  }

  function stopScroll() {
    cancelAnimationFrame(scrollRafId); scrollDir = 0; scrollVel = 0;
  }

  document.addEventListener('keydown', function (e) {
    /* Space — always block page scroll */
    if (e.code === 'Space') {
      e.preventDefault();
      if (gState.spaceHeld) return;
      gState.spaceHeld = true;
      var box = gState.hoveredBox;
      if (box && box._zoom && box._zoom.s > 1.02 && zoomOn()) {
        box.style.cursor = 'grab';
        gState.spacePanBox = box;
      }
      return;
    }

    if (isTypingTarget()) return;
    var k = e.key.toLowerCase();

    /* Z — toggle zoom */
    if (k === 'z' && !e.repeat) {
      zoomEnabledEl.checked = !zoomEnabledEl.checked;
      zoomEnabledEl.dispatchEvent(new Event('change'));
      return;
    }

    /* W / S — page scroll */
    if (k !== 'w' && k !== 's') return;
    if (e.repeat) return;
    e.preventDefault();
    heldKeys[k] = true;
    startScroll(k === 's' ? 1 : -1);
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      gState.spaceHeld = false; gState.spaceDrag = false;
      gState.spacePanBox = null; return;
    }
    var k = e.key.toLowerCase();
    delete heldKeys[k];
    if (!heldKeys['w'] && !heldKeys['s']) stopScroll();
  });

  window.addEventListener('blur', function () {
    stopScroll(); heldKeys = {};
    gState.spaceHeld = false; gState.spaceDrag = false; gState.spacePanBox = null;
  });

  /* ════════════════════════════════════════════════════════
     BULK LOAD
  ════════════════════════════════════════════════════════ */
  bulkLoadBtn.addEventListener('click', async function () {
    if (isLoading) return;
    var urls = parseUrls(bulkArea.value).filter(isUrl);
    if (!urls.length) { showStatus('No valid URLs found.', 'err'); return; }

    isLoading = true;
    bulkLoadBtn.disabled = true;

    if (!appendMode.checked) clearGallery();

    var startIdx = allUrls.length;
    allUrls = allUrls.concat(urls);

    progWrap.classList.remove('hide');
    progFill.style.width = '0%';
    progLabel.textContent = 'Building ' + urls.length + ' slots\u2026';

    if (observer) observer.disconnect();

    var CHUNK = 200, frag = document.createDocumentFragment();
    for (var i = 0; i < urls.length; i++) {
      var slot = makeSlot(startIdx + i);
      slots.push(slot);
      frag.appendChild(slot);
      if ((i + 1) % CHUNK === 0 || i === urls.length - 1) {
        gallery.appendChild(frag);
        frag = document.createDocumentFragment();
        progFill.style.width = Math.round(((i + 1) / urls.length) * 100) + '%';
        progLabel.textContent = (i + 1) + ' / ' + urls.length + ' slots placed\u2026';
        refreshCount();
        await new Promise(function (r) {
          requestAnimationFrame(function () { requestAnimationFrame(r); });
        });
      }
    }

    rebuildObserver();
    progLabel.textContent = urls.length + ' images ready!';
    showStatus(urls.length + ' image' + (urls.length !== 1 ? 's' : '') + ' loaded.', 'ok', 4000);
    setTimeout(function () { progWrap.classList.add('hide'); progFill.style.width = '0%'; }, 2400);
    bulkArea.value = '';
    bulkTally.innerHTML = '<b>0</b> URLs';
    isLoading = false;
    bulkLoadBtn.disabled = false;
  });

  bulkClearBtn.addEventListener('click', function () {
    bulkArea.value = '';
    bulkTally.innerHTML = '<b>0</b> URLs';
  });

  clearAllBtn.addEventListener('click', clearGallery);

  window.addEventListener('scroll', function () {
    btt.classList.toggle('show', window.scrollY > 280);
  }, { passive: true });

  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  refreshCount();

})();
