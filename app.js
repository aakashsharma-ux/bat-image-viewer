/* ════════════════════════════════════════════════════════════
   BAT-VIEWER  app.js  v15

   CHANGES FROM v14:
   ─ FIXED: Duplicate image rendering — activeSet now tracks slot
     references (not indices) so re-index after removals can't
     cause double-activation.
   ─ FIXED: Remove handler reads live index from slot.dataset.idx
     instead of closed-over ci (stale after prior removals).
   ─ FIXED: Document mousemove/mouseup listeners now always cleaned
     up on slot deactivation (plug the event-listener leak).
   ─ FIXED: No card hover transform animation (was triggering GPU
     compositing on every visible card simultaneously = lag at scale).
   ─ ADDED: Edit Mode — lazy-loaded, isolated, zero view-mode cost.
   ─ ADDED: img-rotate-wrap layer for clean rotation + zoom coexist.
   ─ ADDED: editStates map — edit persists across virtualization.
   ─ ADDED: Keyboard ← → ↑ ↓  scroll, +/- size, F fullscreen,
             Esc exit-edit, Ctrl+R reset-edits.
   ─ ADDED: Keyboard shortcut help tooltip (⌨ button).
   ─ REMOVED: Drag-reorder (caused index desync + duplication bugs).
   ─ PERF: rootMargin 300% for smoother preload on fast scroll.
   ─ PERF: will-change:transform only on img (already in CSS).
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
  var helpBtn       = $id('helpBtn');
  var helpTooltip   = $id('helpTooltip');

  /* ════════════════════════════════════════════════════════
     THEME
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
     HELP TOOLTIP
  ════════════════════════════════════════════════════════ */
  var helpOpen = false;
  helpBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    helpOpen = !helpOpen;
    helpTooltip.classList.toggle('visible', helpOpen);
  });
  document.addEventListener('click', function () {
    if (helpOpen) { helpOpen = false; helpTooltip.classList.remove('visible'); }
  });

  /* ════════════════════════════════════════════════════════
     SIZE PRESETS
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
     SCROLL SPEED
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
     ZOOM TOGGLE
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
    try {
      var u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
    } catch (e) { return false; }
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
     EDIT STATE PERSISTENCE
     Keyed by URL so states survive virtualization cycles.
     A card scrolled off-screen is destroyed and recreated;
     on recreation it reads from this map and re-applies.
  ════════════════════════════════════════════════════════ */
  var editStates = Object.create(null);

  function getEditState(url) {
    return editStates[url]
      ? { brightness: editStates[url].brightness, contrast: editStates[url].contrast, rotation: editStates[url].rotation }
      : { brightness: 1, contrast: 1, rotation: 0 };
  }

  function saveEditState(url, state) {
    if (state.brightness === 1 && state.contrast === 1 && state.rotation === 0) {
      delete editStates[url];
    } else {
      editStates[url] = { brightness: state.brightness, contrast: state.contrast, rotation: state.rotation };
    }
  }

  /* Apply a state object to a card's image and rotation wrapper */
  function applyStateToCard(card, state) {
    var img  = card.querySelector('.card-img');
    var wrap = card.querySelector('.img-rotate-wrap');
    if (!img || !wrap) return;
    img.style.filter = (state.brightness !== 1 || state.contrast !== 1)
      ? 'brightness(' + state.brightness + ') contrast(' + state.contrast + ')'
      : '';
    wrap.style.transform = state.rotation !== 0
      ? 'rotate(' + state.rotation + 'deg)'
      : '';
  }

  /* ════════════════════════════════════════════════════════
     EDIT MODE  (IIFE singleton — lazy, isolated)

     Lifecycle: enter(card, url) → user adjusts → exit(apply)
     Heavy DOM refs are grabbed once on first use (ensurePanel).
     The panel element exists in the DOM from page load but is
     off-screen (transform:translateX(100%)) so it has zero
     layout or paint cost in view mode.
  ════════════════════════════════════════════════════════ */
  var EditMode = (function () {
    var panelEl       = null;
    var activeCard    = null;
    var activeUrl     = null;
    var savedState    = null;    /* state on enter — restored on Cancel */
    var liveState     = null;    /* current working state */

    /* Panel control refs (grabbed on first use) */
    var epBrightness, epContrast, epRotate;
    var epBrightnessVal, epContrastVal, epRotateVal;
    var ready = false;

    /* Wire up panel controls exactly once */
    function ensurePanel() {
      if (ready) return;
      ready = true;
      panelEl        = $id('editPanel');
      epBrightness   = $id('epBrightness');
      epContrast     = $id('epContrast');
      epRotate       = $id('epRotate');
      epBrightnessVal = $id('epBrightnessVal');
      epContrastVal   = $id('epContrastVal');
      epRotateVal     = $id('epRotateVal');

      epBrightness.addEventListener('input', function () {
        liveState.brightness = epBrightness.value / 100;
        epBrightnessVal.textContent = epBrightness.value + '%';
        previewLive();
      });

      epContrast.addEventListener('input', function () {
        liveState.contrast = epContrast.value / 100;
        epContrastVal.textContent = epContrast.value + '%';
        previewLive();
      });

      epRotate.addEventListener('input', function () {
        liveState.rotation = parseInt(epRotate.value, 10);
        epRotateVal.textContent = epRotate.value + '\u00b0';
        previewLive();
      });

      $id('epRotCCW').addEventListener('click', function () {
        liveState.rotation = normaliseAngle(liveState.rotation - 90);
        syncRotSlider();
        previewLive();
      });

      $id('epRotCW').addEventListener('click', function () {
        liveState.rotation = normaliseAngle(liveState.rotation + 90);
        syncRotSlider();
        previewLive();
      });

      $id('epReset').addEventListener('click',  function () { resetLive(); });
      $id('epCancel').addEventListener('click', function () { exit(false); });
      $id('epDone').addEventListener('click',   function () { exit(true);  });
      $id('epClose').addEventListener('click',  function () { exit(false); });
    }

    /* Clamp angle to -180..180 range for the slider */
    function normaliseAngle(deg) {
      while (deg >  180) deg -= 360;
      while (deg < -180) deg += 360;
      return deg;
    }

    function syncRotSlider() {
      epRotate.value = liveState.rotation;
      epRotateVal.textContent = liveState.rotation + '\u00b0';
    }

    function previewLive() {
      if (activeCard) applyStateToCard(activeCard, liveState);
    }

    function resetLive() {
      liveState = { brightness: 1, contrast: 1, rotation: 0 };
      epBrightness.value  = 100; epBrightnessVal.textContent = '100%';
      epContrast.value    = 100; epContrastVal.textContent   = '100%';
      epRotate.value      = 0;   epRotateVal.textContent     = '0\u00b0';
      previewLive();
    }

    function populatePanel(state) {
      var b = Math.round(state.brightness * 100);
      var c = Math.round(state.contrast   * 100);
      var r = state.rotation;
      epBrightness.value       = b;  epBrightnessVal.textContent = b + '%';
      epContrast.value         = c;  epContrastVal.textContent   = c + '%';
      epRotate.value           = r;  epRotateVal.textContent     = r + '\u00b0';
    }

    /* ── Public API ── */

    function enter(card, url) {
      if (activeCard === card) return;
      if (activeCard) exit(false);       /* close any existing session */

      ensurePanel();                     /* wire controls on first use */

      activeCard = card;
      activeUrl  = url;
      savedState = getEditState(url);    /* snapshot for Cancel */
      liveState  = { brightness: savedState.brightness, contrast: savedState.contrast, rotation: savedState.rotation };

      populatePanel(liveState);

      panelEl.classList.add('visible');
      panelEl.setAttribute('aria-hidden', 'false');
      document.body.classList.add('edit-active');
      card.classList.add('editing');
    }

    function exit(apply) {
      if (!activeCard) return;

      if (apply) {
        saveEditState(activeUrl, liveState);
        applyStateToCard(activeCard, liveState);
      } else {
        /* Cancel — restore the state from when we entered */
        applyStateToCard(activeCard, savedState);
      }

      activeCard.classList.remove('editing');
      document.body.classList.remove('edit-active');
      panelEl.classList.remove('visible');
      panelEl.setAttribute('aria-hidden', 'true');

      activeCard = null;
      activeUrl  = null;
      savedState = null;
      liveState  = null;
    }

    function resetActive() {
      if (activeCard) resetLive();
    }

    function isActive() { return activeCard !== null; }

    return { enter: enter, exit: exit, reset: resetActive, isActive: isActive };
  })();

  /* ════════════════════════════════════════════════════════
     VIRTUAL GALLERY ENGINE

     FIX — activeSet now uses slot element references, not
     integer indices. This means re-indexing after a remove
     cannot accidentally mark a slot as "not active" when it
     is, or vice-versa. The integer index stored in
     slot.dataset.idx is only used to look up allUrls[i].
  ════════════════════════════════════════════════════════ */
  var allUrls   = [];
  var slots     = [];
  var activeSet = new Set();   /* Set<HTMLElement> — slot references */
  var observer  = null;
  var isLoading = false;

  function makeUrlLabel(url) {
    var s = document.createElement('span');
    s.className = 'url-label';
    s.textContent = url;
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

  /* Activate: build and insert a card into a slot */
  function activateSlot(slot) {
    if (activeSet.has(slot)) return;           /* already active — no duplicate */
    var i = parseInt(slot.dataset.idx, 10);
    if (i >= allUrls.length) return;
    activeSet.add(slot);
    slot.innerHTML = '';
    slot.appendChild(buildCard(i));
  }

  /* Deactivate: tear down the card, free memory, clean listeners */
  function deactivateSlot(slot) {
    if (!activeSet.has(slot)) return;
    activeSet.delete(slot);
    /* Cleanup zoom drag listeners attached to document */
    var box = slot.querySelector('.card-img-box');
    if (box && box._destroy) box._destroy();
    /* Release img src to free browser decode memory */
    slot.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    slot.innerHTML = '';
    var i = parseInt(slot.dataset.idx, 10);
    if (i < allUrls.length) slot.appendChild(makeUrlLabel(allUrls[i]));
  }

  function rebuildObserver() {
    if (observer) observer.disconnect();
    /* rootMargin 300%: preload 3 screens worth above and below viewport.
       This makes fast scrolling feel instant for most setups. */
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) activateSlot(e.target);
        else                  deactivateSlot(e.target);
      });
    }, { root: null, rootMargin: '300% 0px 300% 0px', threshold: 0 });
    slots.forEach(function (s) { observer.observe(s); });
  }

  function clearGallery() {
    if (observer) { observer.disconnect(); observer = null; }
    if (EditMode.isActive()) EditMode.exit(false);
    gallery.querySelectorAll('img').forEach(function (img) { img.src = ''; });
    gallery.innerHTML = '';
    allUrls = []; slots = []; activeSet = new Set();
    refreshCount();
  }

  /* ════════════════════════════════════════════════════════
     CARD FACTORY

     Structure:
       .card
         .card-header
         .card-img-box
           .img-rotate-wrap   ← rotation applied here (CSS transform)
             .card-img         ← zoom applied here (JS transform, will-change)
           .zoom-badge
           .zoom-hint
         .card-url-row
         .card-toolbar
           [Copy Link] [Edit] [Remove]
  ════════════════════════════════════════════════════════ */
  function buildCard(ci) {
    var url = allUrls[ci];
    var num = ci + 1;

    var card = document.createElement('div');
    card.className = 'card';

    /* ── Header ── */
    var hdr   = document.createElement('div'); hdr.className = 'card-header';
    var numEl = document.createElement('span'); numEl.className = 'card-num'; numEl.textContent = 'Image ' + num;
    var dimsEl= document.createElement('span'); dimsEl.className = 'card-dims';
    hdr.appendChild(numEl); hdr.appendChild(dimsEl);

    /* ── Image box ── */
    var box = document.createElement('div');
    box.className = 'card-img-box';

    /* Spinner */
    var spin = document.createElement('div');
    spin.className = 'card-spinner';
    spin.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spin);

    /* Rotation wrapper — receives CSS rotate(); isolated from zoom */
    var rotateWrap = document.createElement('div');
    rotateWrap.className = 'img-rotate-wrap';

    /* Image */
    var img = document.createElement('img');
    img.className = 'card-img';
    img.alt = 'Image ' + num;
    img.decoding = 'async';
    img.draggable = false;
    img.style.transformOrigin = '0 0';
    img.style.maxHeight = currentMaxH;

    /* Re-apply stored edit state so it survives virtualization */
    var storedEdit = getEditState(url);
    if (storedEdit.brightness !== 1 || storedEdit.contrast !== 1) {
      img.style.filter = 'brightness(' + storedEdit.brightness + ') contrast(' + storedEdit.contrast + ')';
    }
    if (storedEdit.rotation !== 0) {
      rotateWrap.style.transform = 'rotate(' + storedEdit.rotation + 'deg)';
    }

    img.addEventListener('load', function () {
      spin.remove();
      if (img.naturalWidth) dimsEl.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
      syncCursor();
    });

    img.addEventListener('error', function () {
      spin.remove();
      box.innerHTML =
        '<div class="card-err">\u26a0 Could not load<br>' +
        '<small style="opacity:.4;word-break:break-all;">' + url + '</small></div>';
    });

    img.src = url;
    rotateWrap.appendChild(img);
    box.appendChild(rotateWrap);

    /* Zoom overlays */
    var badge = document.createElement('div'); badge.className = 'zoom-badge';
    var hint  = document.createElement('div'); hint.className  = 'zoom-hint';
    hint.textContent = 'Scroll\u2022zoom    Drag\u2022pan    Dbl-click\u2022reset';
    box.appendChild(badge);
    box.appendChild(hint);

    /* ──────────────────────────────────────────────────────
       ZOOM + DRAG (per-card closures)
       transform = translate(tx,ty) scale(s)  origin = 0 0
       Rotation is on the PARENT (rotateWrap), not here.
       Both are GPU-composited; order is: rotate → translate/scale.
    ─────────────────────────────────────────────────────── */
    var Z_MIN = 1, Z_MAX = 5, Z_FACTOR = 1.13;
    var s = 1, tx = 0, ty = 0;
    var inside = false, dragging = false;
    var dragStartX = 0, dragStartY = 0, dragTx0 = 0, dragTy0 = 0;
    var dragMoved = false, resetTid = null;

    function isEditing() { return card.classList.contains('editing'); }

    function clamp(ns, ntx, nty) {
      var bw = box.offsetWidth, bh = box.offsetHeight;
      return {
        tx: Math.min(0, Math.max(bw - bw * ns, ntx)),
        ty: Math.min(0, Math.max(bh - bh * ns, nty))
      };
    }

    function applyTf(animate) {
      img.style.transition = animate ? 'transform 0.27s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
      img.style.transform  =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
    }

    function syncBadge() {
      badge.textContent = s.toFixed(1) + '\u00d7';
      var z = s > 1.02;
      badge.classList.toggle('visible', z);
      box.classList.toggle('zoomed', z);
    }

    function syncCursor() {
      if (isEditing()) {
        box.classList.remove('zoom-ready', 'zoomed', 'zoom-drag');
        return;
      }
      box.classList.toggle('zoom-ready', zoomOn() && s <= 1.02);
      box.classList.toggle('zoomed',     s > 1.02);
      if (!zoomOn() && s <= 1.02) box.classList.remove('zoom-ready', 'zoomed', 'zoom-drag');
    }

    function resetZoom(animate) {
      clearTimeout(resetTid);
      s = 1; tx = 0; ty = 0;
      applyTf(animate !== false); syncBadge(); syncCursor();
    }

    /* Scroll wheel zoom — blocked during edit mode */
    box.addEventListener('wheel', function (e) {
      if (!zoomOn() || isEditing()) return;
      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (cx < 0 || cy < 0 || cx > r.width || cy > r.height) return;
      e.preventDefault(); e.stopPropagation();
      var factor = e.deltaY < 0 ? Z_FACTOR : 1 / Z_FACTOR;
      var ns = Math.min(Z_MAX, Math.max(Z_MIN, s * factor));
      if (ns === s) return;
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

    /* Drag pan */
    box.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !zoomOn() || s <= 1.02 || gState.spaceHeld || isEditing()) return;
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
      img.style.transform  =
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

    /* Double-click: toggle 2.5× zoom */
    box.addEventListener('dblclick', function (e) {
      if (!zoomOn() || dragMoved || isEditing()) return;
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

    zoomEnabledEl.addEventListener('change', function () {
      if (!zoomOn() && s > 1.02) resetZoom();
      else syncCursor();
    });

    /* CLEANUP — called by deactivateSlot when card is virtualized away */
    box._destroy = function () {
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup',   onDocUp);
      clearTimeout(resetTid);
      dragging = false;
    };

    syncCursor();

    /* ── URL row ── */
    var urlRow = document.createElement('div'); urlRow.className = 'card-url-row';
    var urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url; urlTxt.textContent = url;
    urlRow.appendChild(urlTxt);

    /* ── Toolbar ── */
    var toolbar = document.createElement('div'); toolbar.className = 'card-toolbar';

    /* Copy Link */
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
        cpTid = setTimeout(function () { copyBtn.textContent = 'Copy Link'; copyBtn.classList.remove('ok'); }, 1500);
      });
    });

    /* Edit — entry point for Edit Mode */
    var editBtn = document.createElement('button');
    editBtn.className = 'tedit'; editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', function () {
      if (card.classList.contains('editing')) {
        /* Already editing this card → exit without saving (same as Cancel) */
        EditMode.exit(false);
      } else {
        /* Reset zoom before entering edit mode (cleaner UX) */
        if (s > 1.02) resetZoom(false);
        EditMode.enter(card, url);
      }
    });

    /* Remove */
    var removeBtn = document.createElement('button');
    removeBtn.className = 'tremove'; removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      /* FIX: read live index from DOM instead of closed-over ci */
      var parentSlot  = card.closest('.vslot');
      var currentIdx  = parentSlot ? parseInt(parentSlot.dataset.idx, 10) : ci;

      if (box._destroy) box._destroy();
      if (card.classList.contains('editing')) EditMode.exit(false);

      allUrls.splice(currentIdx, 1);
      delete editStates[url];

      var removedSlot = slots.splice(currentIdx, 1)[0];
      activeSet.delete(removedSlot);

      /* Re-sync idx on remaining slots + card-num labels */
      for (var j = currentIdx; j < slots.length; j++) {
        slots[j].dataset.idx = String(j);
        var cn = slots[j].querySelector('.card-num');
        if (cn) cn.textContent = 'Image ' + (j + 1);
      }

      refreshCount();
      card.classList.add('out');
      setTimeout(function () {
        if (observer) observer.unobserve(removedSlot);
        removedSlot.remove();
      }, 230);
    });

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(editBtn);
    toolbar.appendChild(removeBtn);

    card.appendChild(hdr);
    card.appendChild(box);
    card.appendChild(urlRow);
    card.appendChild(toolbar);
    return card;
  }

  /* ════════════════════════════════════════════════════════
     GLOBAL SPACE-PAN STATE
  ════════════════════════════════════════════════════════ */
  var gState = { spaceHeld: false, hoveredBox: null };

  document.addEventListener('mouseover', function (e) {
    gState.hoveredBox = (e.target.closest ? e.target.closest('.card-img-box') : null) || null;
  }, { passive: true });

  /* ════════════════════════════════════════════════════════
     KEYBOARD
  ════════════════════════════════════════════════════════ */
  var scrollVel = 0, scrollDir = 0, scrollRafId = null;
  var heldKeys  = Object.create(null);

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

    /* ── Space: always block default scroll ── */
    if (e.code === 'Space') {
      e.preventDefault();
      gState.spaceHeld = true;
      return;
    }

    /* ── Esc: exit edit mode ── */
    if (e.key === 'Escape') {
      if (EditMode.isActive()) EditMode.exit(false);
      return;
    }

    /* ── Ctrl+R: reset edits (only in edit mode) ── */
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      if (EditMode.isActive()) { e.preventDefault(); EditMode.reset(); }
      return;
    }

    /* ── Everything below: ignore if typing ── */
    if (isTypingTarget()) return;

    var k = e.key;

    /* ── F: fullscreen ── */
    if (k.toLowerCase() === 'f' && !e.repeat) {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen && document.exitFullscreen();
      }
      return;
    }

    /* ── Z: toggle zoom ── */
    if (k.toLowerCase() === 'z' && !e.repeat) {
      zoomEnabledEl.checked = !zoomEnabledEl.checked;
      zoomEnabledEl.dispatchEvent(new Event('change'));
      return;
    }

    /* ── +/= : size up ── */
    if ((k === '+' || k === '=') && !e.repeat) {
      sizerEl.value = String(Math.min(10, parseInt(sizerEl.value, 10) + 1));
      applySize(parseInt(sizerEl.value, 10));
      return;
    }

    /* ── -: size down ── */
    if (k === '-' && !e.repeat) {
      sizerEl.value = String(Math.max(1, parseInt(sizerEl.value, 10) - 1));
      applySize(parseInt(sizerEl.value, 10));
      return;
    }

    /* ── Scroll keys: W/S/Arrows ── */
    var isUp   = (k === 'w' || k === 'ArrowUp'   || k === 'ArrowLeft');
    var isDown = (k === 's' || k === 'ArrowDown'  || k === 'ArrowRight');

    if ((isUp || isDown) && !e.repeat) {
      e.preventDefault();
      heldKeys[k] = true;
      startScroll(isDown ? 1 : -1);
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') { gState.spaceHeld = false; return; }
    delete heldKeys[e.key];
    /* Stop scroll only if ALL scroll keys are released */
    var anyScroll = heldKeys['w'] || heldKeys['s'] ||
      heldKeys['ArrowUp']    || heldKeys['ArrowDown'] ||
      heldKeys['ArrowLeft']  || heldKeys['ArrowRight'];
    if (!anyScroll) stopScroll();
  });

  window.addEventListener('blur', function () {
    stopScroll();
    heldKeys = Object.create(null);
    gState.spaceHeld = false;
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

    var CHUNK = 200;
    var frag  = document.createDocumentFragment();

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
        /* Yield to browser so UI stays responsive during large loads */
        await new Promise(function (resolve) {
          requestAnimationFrame(function () { requestAnimationFrame(resolve); });
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
