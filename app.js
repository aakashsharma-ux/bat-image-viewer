/* ================================================================
   BAT-VIEWER  —  app.js  (clean rewrite)
   ================================================================
   Sections:
     1.  DOM refs & global state
     2.  Size presets (image grid)
     3.  Scroll speed control  ← W/S keyboard scroll
     4.  Zoom toggle (enable/disable)
     5.  URL helpers
     6.  Virtual gallery engine (IntersectionObserver)
     7.  Card factory  — zoom · drag · space-pan per card
     8.  Keyboard handling  — W/S scroll · Space pan
     9.  Bulk load
    10.  Back-to-top
   ================================================================ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────
     1. DOM REFS
  ────────────────────────────────────────────────────────── */
  const gallery       = document.getElementById('gallery');
  const bulkArea      = document.getElementById('bulkArea');
  const bulkTally     = document.getElementById('bulkTally');
  const bulkLoadBtn   = document.getElementById('bulkLoadBtn');
  const bulkClearBtn  = document.getElementById('bulkClearBtn');
  const appendMode    = document.getElementById('appendMode');
  const bSt           = document.getElementById('bSt');
  const progWrap      = document.getElementById('progWrap');
  const progFill      = document.getElementById('progFill');
  const progLabel     = document.getElementById('progLabel');
  const gCount        = document.getElementById('gCount');
  const clearAllBtn   = document.getElementById('clearAll');
  const btt           = document.getElementById('btt');
  const sizerEl       = document.getElementById('sizer');
  const sizeBadgeEl   = document.getElementById('sizeBadge');
  const scrollSpeedEl = document.getElementById('scrollSpeed');
  const scrollBadgeEl = document.getElementById('scrollBadge');
  const zoomEnabledEl = document.getElementById('zoomEnabled');

  /* ──────────────────────────────────────────────────────────
     2. IMAGE SIZE PRESETS
  ────────────────────────────────────────────────────────── */
  const SIZE_PRESETS = [
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

  let currentImgH = SIZE_PRESETS[2].h;

  function applySize(val) {
    const p = SIZE_PRESETS[val - 1];
    currentImgH = p.h;
    sizeBadgeEl.textContent = p.label;
    gallery.style.gridTemplateColumns =
      p.cols === 1 ? '1fr' : 'repeat(' + p.cols + ',minmax(0,1fr))';
    document.querySelectorAll('.card-img-box')
      .forEach(function (b) { b.style.height = p.h; });
  }

  sizerEl.addEventListener('input', function () {
    applySize(parseInt(sizerEl.value, 10));
  });
  applySize(parseInt(sizerEl.value, 10));

  /* ──────────────────────────────────────────────────────────
     3. SCROLL SPEED CONTROL
     Three presets; the rAF scroll loop reads these live so
     changing the slider mid-scroll takes effect immediately.
  ────────────────────────────────────────────────────────── */
  const SCROLL_PRESETS = [
    { label: 'Slow',   base: 40,  max: 120, ramp: 15 },
    { label: 'Medium', base: 80,  max: 240, ramp: 30 },
    { label: 'Fast',   base: 150, max: 450, ramp: 55 },
  ];

  function getScrollPreset() {
    return SCROLL_PRESETS[Math.min(2, Math.max(0,
      parseInt(scrollSpeedEl.value, 10) - 1))];
  }

  function syncScrollBadge() {
    scrollBadgeEl.textContent = getScrollPreset().label;
  }

  scrollSpeedEl.addEventListener('input', syncScrollBadge);
  syncScrollBadge();

  /* ──────────────────────────────────────────────────────────
     4. ZOOM TOGGLE
  ────────────────────────────────────────────────────────── */
  function zoomAllowed() {
    return zoomEnabledEl.checked;
  }

  /* ──────────────────────────────────────────────────────────
     5. URL HELPERS
  ────────────────────────────────────────────────────────── */
  function parseUrls(txt) {
    return txt.split(/[\n,]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 6; })
      .slice(0, 1000);
  }

  function isUrl(s) {
    try {
      var u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
    } catch (e) { return false; }
  }

  function isTypingTarget() {
    var el = document.activeElement;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  /* status bar */
  var stTimer = null;
  function showSt(msg, cls, ms) {
    clearTimeout(stTimer);
    bSt.textContent = msg;
    bSt.className = 'status ' + (cls || 'ok');
    stTimer = setTimeout(function () { bSt.className = 'status hide'; }, ms || 3000);
  }

  function refreshCount() {
    gCount.textContent = allUrls.length;
  }

  bulkArea.addEventListener('input', function () {
    var n = parseUrls(bulkArea.value).length;
    bulkTally.innerHTML = '<b>' + n + '</b> URL' + (n !== 1 ? 's' : '') + ' detected';
  });

  /* ──────────────────────────────────────────────────────────
     6. VIRTUAL GALLERY ENGINE
     Each URL gets one lightweight <div class="vslot">.
     IntersectionObserver upgrades visible slots to full cards
     and downgrades off-screen cards back to empty slots —
     keeping live DOM nodes to ~30-80 regardless of list size.
  ────────────────────────────────────────────────────────── */
  var allUrls   = [];
  var slots     = [];
  var activeSet = new Set();
  var observer  = null;
  var isLoading = false;

  function makeSlot(i) {
    var slot = document.createElement('div');
    slot.className = 'vslot';
    slot.style.minHeight = currentImgH;
    slot.dataset.idx = String(i);
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
    var box = slot.querySelector('.card-img-box');
    if (box && box._destroy) box._destroy();
    slot.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    slot.innerHTML = '';
  }

  function buildObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) activateSlot(entry.target);
        else deactivateSlot(entry.target);
      });
    }, { root: null, rootMargin: '200% 0px 200% 0px', threshold: 0 });
    slots.forEach(function (s) { observer.observe(s); });
  }

  function clearGallery() {
    if (observer) { observer.disconnect(); observer = null; }
    gallery.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    gallery.innerHTML = '';
    allUrls   = [];
    slots     = [];
    activeSet = new Set();
    refreshCount();
  }

  /* ──────────────────────────────────────────────────────────
     7. CARD FACTORY
     Zoom model: transform = translate(tx,ty) scale(s)
       transform-origin is fixed at "0 0" permanently.
       Cursor-anchored zoom math:
         imgPoint = (cursor - translate) / scale
         newTranslate = cursor - imgPoint * newScale
       This keeps the pixel under the cursor stationary.
     Drag model: mousedown captures start pos + translate,
       mousemove on document applies delta + clamp.
  ────────────────────────────────────────────────────────── */
  function buildCard(i) {
    var url = allUrls[i];
    var idx = i + 1;

    /* ── outer card ── */
    var card = document.createElement('div');
    card.className = 'card';

    /* ── header ── */
    var hdr  = document.createElement('div');
    hdr.className = 'card-header';
    var numEl  = document.createElement('span');
    numEl.className = 'card-num';
    numEl.textContent = 'Image ' + idx;
    var dimsEl = document.createElement('span');
    dimsEl.className = 'card-dims';
    hdr.appendChild(numEl);
    hdr.appendChild(dimsEl);

    /* ── image box ── */
    var box = document.createElement('div');
    box.className = 'card-img-box';
    box.style.height = currentImgH;

    var spinWrap = document.createElement('div');
    spinWrap.className = 'card-spinner';
    spinWrap.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spinWrap);

    var img = document.createElement('img');
    img.className = 'card-img';
    img.alt = 'Image ' + idx;
    img.decoding = 'async';
    img.style.transformOrigin = '0 0';
    img.style.willChange = 'transform';
    /* block browser native drag */
    img.draggable = false;

    img.addEventListener('load', function () {
      spinWrap.remove();
      if (img.naturalWidth) {
        dimsEl.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
      }
    });
    img.addEventListener('error', function () {
      spinWrap.remove();
      box.innerHTML = '<div class="card-err">\u26a0 Could not load image' +
        '<small style="opacity:.45;word-break:break-all;display:block;margin-top:4px;">' +
        url + '</small></div>';
    });

    img.src = url;
    box.appendChild(img);

    /* ──────────────────────────────────────────────────────
       ZOOM + DRAG STATE  (per card, fully self-contained)
    ────────────────────────────────────────────────────── */
    var ZOOM_MIN    = 1;
    var ZOOM_MAX    = 5;
    var ZOOM_FACTOR = 1.13;

    var s  = 1, tx = 0, ty = 0;   /* current transform */
    var insideBox  = false;
    var dragActive = false;
    var dragStartX = 0, dragStartY = 0;
    var dragTx0    = 0, dragTy0    = 0;
    var dragMoved  = false;
    var resetTimerId = null;

    /* zoom badge */
    var badge = document.createElement('div');
    badge.className = 'zoom-badge';
    box.appendChild(badge);

    /* hint */
    var hint = document.createElement('div');
    hint.className = 'zoom-hint';
    hint.textContent = 'Scroll \u2022 zoom    Drag \u2022 pan    Dbl-click \u2022 2.5\u00d7';
    box.appendChild(hint);

    /* ── helpers ── */
    function clamp(scale, ntx, nty) {
      var bw = box.offsetWidth, bh = box.offsetHeight;
      return {
        tx: Math.min(0, Math.max(bw - bw * scale, ntx)),
        ty: Math.min(0, Math.max(bh - bh * scale, nty))
      };
    }

    function commit(animate) {
      img.style.transition = animate
        ? 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)'
        : 'none';
      img.style.transform =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
      badge.textContent = s.toFixed(1) + '\u00d7';
      var zoomed = s > 1.02;
      badge.classList.toggle('visible', zoomed);
      box.classList.toggle('zoomed', zoomed);
      updateCursor();
    }

    function resetZoom() {
      clearTimeout(resetTimerId);
      s = 1; tx = 0; ty = 0;
      commit(true);
    }

    function updateCursor() {
      if (!zoomAllowed()) { box.style.cursor = 'default'; return; }
      if (s <= 1.02)      { box.style.cursor = 'zoom-in'; return; }
      if (dragActive)     { box.style.cursor = 'grabbing'; return; }
      box.style.cursor = 'grab';
    }

    /* ── WHEEL → zoom (only when zoomAllowed) ── */
    box.addEventListener('wheel', function (e) {
      if (!zoomAllowed()) return;   /* zoom toggle off — pass through */

      /* strict boundary check */
      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left;
      var cy = e.clientY - r.top;
      if (cx < 0 || cy < 0 || cx > r.width || cy > r.height) return;

      e.preventDefault();
      e.stopPropagation();

      var factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      var newS   = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * factor));
      if (newS === s) return;

      /* cursor-anchored translate */
      var ipx = (cx - tx) / s;
      var ipy = (cy - ty) / s;
      var c   = clamp(newS, cx - ipx * newS, cy - ipy * newS);
      s = newS; tx = c.tx; ty = c.ty;
      commit(false);

      clearTimeout(resetTimerId);
      if (s <= ZOOM_MIN + 0.02) resetZoom();
    }, { passive: false });

    /* ── MOUSEENTER / LEAVE ── */
    box.addEventListener('mouseenter', function () {
      insideBox = true;
      clearTimeout(resetTimerId);
      updateCursor();
    });
    box.addEventListener('mouseleave', function () {
      insideBox = false;
      if (s > ZOOM_MIN + 0.02 && !dragActive) {
        resetTimerId = setTimeout(resetZoom, 600);
      }
      updateCursor();
    });

    /* ── MOUSEDOWN → start left-button drag (only when zoomed) ── */
    box.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (s <= 1.02) return;       /* not zoomed, nothing to drag */
      /* don't start drag if Space pan is active */
      if (globalState.spaceHeld) return;

      e.preventDefault();
      dragActive = true;
      dragMoved  = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragTx0    = tx;
      dragTy0    = ty;
      clearTimeout(resetTimerId);
      updateCursor();
    });

    /* document-level mousemove/mouseup so drag survives leaving the box */
    function onDocMove(e) {
      if (!dragActive) return;
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
      var c = clamp(s, dragTx0 + dx, dragTy0 + dy);
      tx = c.tx; ty = c.ty;
      img.style.transition = 'none';
      img.style.transform =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
    }

    function onDocUp() {
      if (!dragActive) return;
      dragActive = false;
      updateCursor();
      if (!insideBox && s > ZOOM_MIN + 0.02) {
        resetTimerId = setTimeout(resetZoom, 600);
      }
    }

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup',   onDocUp);

    /* ── DOUBLE-CLICK → toggle 2.5× ── */
    box.addEventListener('dblclick', function (e) {
      if (!zoomAllowed()) return;
      if (dragMoved) return;   /* was a drag, not a dblclick */
      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left;
      var cy = e.clientY - r.top;
      if (s > 1.05) {
        resetZoom();
      } else {
        var tgt = 2.5;
        var ipx = (cx - tx) / s;
        var ipy = (cy - ty) / s;
        var c   = clamp(tgt, cx - ipx * tgt, cy - ipy * tgt);
        s = tgt; tx = c.tx; ty = c.ty;
        commit(true);
      }
    });

    /* ── expose API for space-pan (section 8) ── */
    box._zoom = {
      get s()  { return s;  }, set s(v)  { s  = v; },
      get tx() { return tx; }, set tx(v) { tx = v; },
      get ty() { return ty; }, set ty(v) { ty = v; },
      clamp:   clamp,
      commit:  commit,
      resetZoom: resetZoom,
      get insideBox() { return insideBox; },
      applyTransformImmediate: function () {
        img.style.transition = 'none';
        img.style.transform =
          'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
          ' scale(' + s.toFixed(4) + ')';
      }
    };

    /* cleanup when card is virtualized away */
    box._destroy = function () {
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup',   onDocUp);
    };

    updateCursor();

    /* ── url row ── */
    var urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';
    var urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url; urlTxt.textContent = url;
    urlRow.appendChild(urlTxt);

    /* ── toolbar ── */
    var toolbar = document.createElement('div');
    toolbar.className = 'card-toolbar';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'tcopy'; copyBtn.textContent = 'Copy Link';
    var copyTimer = null;
    copyBtn.addEventListener('click', function () {
      var p = navigator.clipboard
        ? navigator.clipboard.writeText(url)
        : Promise.resolve().then(function () {
            var t = document.createElement('textarea');
            t.value = url; t.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(t); t.select();
            document.execCommand('copy'); t.remove();
          });
      p.then(function () {
        copyBtn.textContent = 'Copied!'; copyBtn.classList.add('ok');
        clearTimeout(copyTimer);
        copyTimer = setTimeout(function () {
          copyBtn.textContent = 'Copy Link'; copyBtn.classList.remove('ok');
        }, 1600);
      });
    });

    var removeBtn = document.createElement('button');
    removeBtn.className = 'tremove'; removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      if (box._destroy) box._destroy();
      allUrls.splice(i, 1);
      var slot = slots.splice(i, 1)[0];
      activeSet.delete(i);
      for (var j = i; j < slots.length; j++) {
        slots[j].dataset.idx = String(j);
        var n = slots[j].querySelector('.card-num');
        if (n) n.textContent = 'Image ' + (j + 1);
      }
      card.classList.add('out');
      setTimeout(function () {
        if (observer) observer.unobserve(slot);
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

  /* ──────────────────────────────────────────────────────────
     8. KEYBOARD HANDLING
     ─────────────────────────────────────────────────────────
     W / S  → page scroll (speed from slider, rAF loop)
     Space  → hold to pan mode: cursor changes to grab on the
              hovered zoomed image; mousedown+drag pans it.
              Space NEVER scrolls the page.
  ────────────────────────────────────────────────────────── */
  var globalState = {
    spaceHeld:    false,
    hoveredBox:   null,   /* box the cursor is currently over */
    spacePanBox:  null,   /* box being space-panned right now */
    spaceDragging: false,
    spaceStartX:  0, spaceStartY: 0,
    spaceTx0: 0, spaceTy0: 0
  };

  /* track hovered box */
  document.addEventListener('mouseover', function (e) {
    var box = e.target.closest ? e.target.closest('.card-img-box') : null;
    globalState.hoveredBox = box || null;
  });

  /* ── rAF scroll loop ── */
  var scrollVel = 0, scrollDir = 0, scrollRafId = null;
  var heldKeys = {};

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
    scrollDir = dir;
    scrollVel = getScrollPreset().base;
    scrollRafId = requestAnimationFrame(scrollTick);
  }

  function stopScroll() {
    cancelAnimationFrame(scrollRafId);
    scrollDir = 0; scrollVel = 0;
  }

  /* ── keydown ── */
  document.addEventListener('keydown', function (e) {

    /* SPACE — always block default (never scroll page) */
    if (e.code === 'Space') {
      e.preventDefault();
      if (globalState.spaceHeld) return;   /* already down */
      globalState.spaceHeld = true;

      /* activate grab cursor on hovered zoomed box */
      var box = globalState.hoveredBox;
      if (box && box._zoom && box._zoom.s > 1.02 && zoomAllowed()) {
        box.style.cursor = 'grab';
        globalState.spacePanBox = box;
      }
      return;
    }

    /* W / S — page scroll */
    if (e.repeat || isTypingTarget()) return;
    var k = e.key.toLowerCase();
    if (k !== 'w' && k !== 's') return;
    e.preventDefault();
    heldKeys[k] = true;
    startScroll(k === 's' ? 1 : -1);
  });

  /* ── keyup ── */
  document.addEventListener('keyup', function (e) {

    if (e.code === 'Space') {
      globalState.spaceHeld    = false;
      globalState.spaceDragging = false;
      /* restore cursor */
      if (globalState.spacePanBox && globalState.spacePanBox._zoom) {
        var z = globalState.spacePanBox._zoom;
        globalState.spacePanBox.style.cursor = z.s > 1.02 ? 'grab' : 'zoom-in';
      }
      globalState.spacePanBox = null;
      return;
    }

    var k = e.key.toLowerCase();
    delete heldKeys[k];
    if (!heldKeys['w'] && !heldKeys['s']) stopScroll();
  });

  /* ── Space + mousedown → start space-pan ── */
  document.addEventListener('mousedown', function (e) {
    if (!globalState.spaceHeld || e.button !== 0) return;
    var box = globalState.spacePanBox;
    if (!box || !box._zoom) return;
    var z = box._zoom;
    if (z.s <= 1.02) return;

    e.preventDefault();
    e.stopPropagation();
    globalState.spaceDragging = true;
    globalState.spaceStartX   = e.clientX;
    globalState.spaceStartY   = e.clientY;
    globalState.spaceTx0      = z.tx;
    globalState.spaceTy0      = z.ty;
    box.style.cursor = 'grabbing';
  }, { capture: true });

  /* ── Space drag move ── */
  document.addEventListener('mousemove', function (e) {
    if (!globalState.spaceDragging) return;
    var box = globalState.spacePanBox;
    if (!box || !box._zoom) return;
    var z  = box._zoom;
    var dx = e.clientX - globalState.spaceStartX;
    var dy = e.clientY - globalState.spaceStartY;
    var c  = z.clamp(z.s, globalState.spaceTx0 + dx, globalState.spaceTy0 + dy);
    z.tx = c.tx; z.ty = c.ty;
    z.applyTransformImmediate();
  });

  /* ── Space drag up ── */
  document.addEventListener('mouseup', function (e) {
    if (!globalState.spaceDragging) return;
    globalState.spaceDragging = false;
    var box = globalState.spacePanBox;
    if (box && globalState.spaceHeld) {
      box.style.cursor = 'grab';
    }
  });

  /* reset on focus loss */
  window.addEventListener('blur', function () {
    stopScroll();
    heldKeys = {};
    if (globalState.spaceHeld) {
      globalState.spaceHeld    = false;
      globalState.spaceDragging = false;
      if (globalState.spacePanBox && globalState.spacePanBox._zoom) {
        var z = globalState.spacePanBox._zoom;
        globalState.spacePanBox.style.cursor = z.s > 1.02 ? 'grab' : 'zoom-in';
      }
      globalState.spacePanBox = null;
    }
  });

  /* ──────────────────────────────────────────────────────────
     9. BULK LOAD
  ────────────────────────────────────────────────────────── */
  bulkLoadBtn.addEventListener('click', async function () {
    if (isLoading) return;
    var urls = parseUrls(bulkArea.value).filter(isUrl);
    if (!urls.length) { showSt('No valid URLs found.', 'err'); return; }

    isLoading = true;
    bulkLoadBtn.disabled = true;

    if (!appendMode.checked) clearGallery();

    var startIdx = allUrls.length;
    allUrls = allUrls.concat(urls);

    progWrap.classList.add('on');
    progFill.style.width = '0%';
    progLabel.textContent = 'Building grid for ' + urls.length + ' images\u2026';

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

    buildObserver();
    refreshCount();
    progLabel.textContent = urls.length + ' images ready!';
    showSt(urls.length + ' image' + (urls.length > 1 ? 's' : '') + ' loaded.', 'ok', 4000);
    setTimeout(function () {
      progWrap.classList.remove('on');
      progFill.style.width = '0%';
    }, 2400);

    bulkArea.value = '';
    bulkTally.innerHTML = '<b>0</b> URLs detected';
    isLoading = false;
    bulkLoadBtn.disabled = false;
  });

  bulkClearBtn.addEventListener('click', function () {
    bulkArea.value = '';
    bulkTally.innerHTML = '<b>0</b> URLs detected';
  });
  clearAllBtn.addEventListener('click', clearGallery);

  /* ──────────────────────────────────────────────────────────
     10. BACK TO TOP
  ────────────────────────────────────────────────────────── */
  window.addEventListener('scroll', function () {
    btt.classList.toggle('show', window.scrollY > 320);
  }, { passive: true });

  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* init */
  refreshCount();

})();
