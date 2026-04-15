/* ════════════════════════════════════════════════════════════
   BAT-VIEWER  app.js  v10

   Three core problems solved vs previous versions:

   1. Ctrl+F URL SEARCH
      Every URL is inserted as a plain text node into #urlIndex,
      a position:absolute element that is NOT display:none (which
      would hide text from browser find).  Updated atomically on
      every load/remove.  All 1,000 URLs are always findable even
      though only ~30 card DOM nodes are live at a time.

   2. NO BLACK BARS IN IMAGE BOX
      card-img-box has NO fixed height.  The <img> uses
      width:100%; height:auto — it renders at its natural aspect
      ratio.  The size slider sets max-height on the box so very
      tall images are capped, but wide/landscape images fill
      exactly their natural height with zero wasted space.

   3. STICKY CONTROLS
      All controls live inside #stickyShell which is
      position:sticky top:0 z-index:500 — the logo, sliders,
      zoom toggle, URL textarea, and gallery toolbar are always
      visible regardless of scroll position.

   Other features:
   ─ Virtual gallery  (IntersectionObserver, ~30-80 live nodes)
   ─ W/S keyboard scroll  (5 speed steps, does NOT affect wheel)
   ─ Zoom (off by default, checkbox enables it)
     · wheel zoom anchored to cursor
     · left-drag pan when zoomed
     · double-click toggles 2.5×
     · Space + drag = space-pan
════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─── DOM refs ─── */
  function el(id) { return document.getElementById(id); }

  var gallery       = el('gallery');
  var urlIndex      = el('urlIndex');   /* Ctrl+F target */
  var bulkArea      = el('bulkArea');
  var bulkTally     = el('bulkTally');
  var bulkLoadBtn   = el('bulkLoadBtn');
  var bulkClearBtn  = el('bulkClearBtn');
  var appendMode    = el('appendMode');
  var statusMsg     = el('statusMsg');
  var progWrap      = el('progWrap');
  var progFill      = el('progFill');
  var progLabel     = el('progLabel');
  var gCount        = el('gCount');
  var clearAllBtn   = el('clearAllBtn');
  var btt           = el('btt');
  var sizerEl       = el('sizer');
  var sizeBadgeEl   = el('sizeBadge');
  var scrollSpeedEl = el('scrollSpeed');
  var scrollBadgeEl = el('scrollBadge');
  var zoomEnabledEl = el('zoomEnabled');

  /* ════════════════════════════════════════════════════════
     SIZE PRESETS
     Sets max-height on card-img-box + grid columns.
     Image height is NATURAL (auto) up to this max.
  ════════════════════════════════════════════════════════ */
  var SIZE_PRESETS = [
    { label: 'Tiny',      cols: 5, maxH: '120px' },
    { label: 'Small',     cols: 4, maxH: '160px' },
    { label: 'Medium',    cols: 3, maxH: '220px' },
    { label: 'Large',     cols: 2, maxH: '320px' },
    { label: 'XL',        cols: 2, maxH: '440px' },
    { label: 'XXL',       cols: 1, maxH: '520px' },
    { label: '1/Screen',  cols: 1, maxH: '70vh'  },
    { label: '1/Screen+', cols: 1, maxH: '80vh'  },
    { label: 'Full',      cols: 1, maxH: '88vh'  },
    { label: 'Max',       cols: 1, maxH: '95vh'  },
  ];

  var currentMaxH = SIZE_PRESETS[2].maxH;

  function applySize(v) {
    var p = SIZE_PRESETS[Math.min(9, Math.max(0, v - 1))];
    currentMaxH = p.maxH;
    sizeBadgeEl.textContent = p.label;
    gallery.style.gridTemplateColumns =
      p.cols === 1 ? '1fr' : 'repeat(' + p.cols + ',minmax(0,1fr))';
    /* update live boxes */
    var boxes = gallery.querySelectorAll('.card-img-box');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].style.maxHeight = p.maxH;
    }
    /* update slot min-height hints */
    var slots2 = gallery.querySelectorAll('.vslot');
    for (var j = 0; j < slots2.length; j++) {
      slots2[j].style.minHeight = p.maxH;
    }
  }

  sizerEl.addEventListener('input', function () {
    applySize(parseInt(sizerEl.value, 10));
  });
  applySize(parseInt(sizerEl.value, 10));

  /* ════════════════════════════════════════════════════════
     SCROLL SPEED  (W/S keys only — wheel NEVER touched)
  ════════════════════════════════════════════════════════ */
  var SCROLL_PRESETS = [
    { label: 'Very Slow', base: 15,  max:  50, ramp:  7  },
    { label: 'Slow',      base: 30,  max: 100, ramp: 13  },
    { label: 'Medium',    base: 55,  max: 170, ramp: 22  },
    { label: 'Fast',      base: 90,  max: 260, ramp: 36  },
    { label: 'Very Fast', base: 140, max: 400, ramp: 55  },
  ];

  function getScrollPreset() {
    return SCROLL_PRESETS[Math.min(4, Math.max(0, parseInt(scrollSpeedEl.value, 10) - 1))];
  }

  scrollSpeedEl.addEventListener('input', function () {
    scrollBadgeEl.textContent = getScrollPreset().label;
  });
  scrollBadgeEl.textContent = getScrollPreset().label;

  /* ════════════════════════════════════════════════════════
     ZOOM TOGGLE  (unchecked = off by default)
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

  /* ════════════════════════════════════════════════════════
     URL INDEX  (Ctrl+F support)
     #urlIndex is position:absolute, opacity:0 — present in
     DOM flow but invisible.  Browser find-in-page searches
     ALL text nodes in the document, including hidden-by-opacity
     elements, as long as they are NOT display:none/visibility:hidden.
     We rebuild this list on every load/remove.
  ════════════════════════════════════════════════════════ */
  function rebuildUrlIndex() {
    /* One text node per URL, newline-separated for readability */
    urlIndex.textContent = allUrls.join('\n');
    gCount.textContent = allUrls.length;
  }

  /* ════════════════════════════════════════════════════════
     VIRTUAL GALLERY ENGINE
  ════════════════════════════════════════════════════════ */
  var allUrls   = [];
  var slots     = [];
  var activeSet = new Set();
  var observer  = null;
  var isLoading = false;

  function makeSlot(i) {
    var slot = document.createElement('div');
    slot.className = 'vslot';
    slot.style.minHeight = currentMaxH;
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
    rebuildUrlIndex();
  }

  /* ════════════════════════════════════════════════════════
     CARD FACTORY
     Image box uses max-height (not fixed height) so the image
     renders at natural aspect ratio with no black bars.
     Zoom uses translate+scale with origin 0 0 (no jumps).
  ════════════════════════════════════════════════════════ */
  function buildCard(ci) {
    var url = allUrls[ci];
    var num = ci + 1;

    var card = document.createElement('div');
    card.className = 'card';

    /* header */
    var hdr   = document.createElement('div');
    hdr.className = 'card-header';
    var numEl = document.createElement('span');
    numEl.className = 'card-num';
    numEl.textContent = 'Image ' + num;
    var dimsEl = document.createElement('span');
    dimsEl.className = 'card-dims';
    hdr.appendChild(numEl);
    hdr.appendChild(dimsEl);

    /* image box — NO fixed height, NO black background */
    var box = document.createElement('div');
    box.className = 'card-img-box';
    box.style.maxHeight = currentMaxH;
    box.style.overflow  = 'hidden';

    /* spinner (absolutely positioned, doesn't push box height) */
    var spin = document.createElement('div');
    spin.className = 'card-spinner';
    spin.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spin);

    /* image — width:100%, height:auto = natural ratio */
    var img = document.createElement('img');
    img.className = 'card-img';
    img.alt = 'Image ' + num;
    img.decoding = 'async';
    img.draggable = false;
    img.style.transformOrigin = '0 0';

    img.addEventListener('load', function () {
      spin.remove();
      if (img.naturalWidth) {
        dimsEl.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
      }
    });
    img.addEventListener('error', function () {
      spin.remove();
      box.innerHTML =
        '<div class="card-err">\u26a0 Could not load image' +
        '<small style="opacity:.4;word-break:break-all;display:block;margin-top:3px;">' +
        url + '</small></div>';
    });

    img.src = url;
    box.appendChild(img);

    /* zoom overlays */
    var badge = document.createElement('div');
    badge.className = 'zoom-badge';
    box.appendChild(badge);

    var hint = document.createElement('div');
    hint.className = 'zoom-hint';
    hint.textContent = 'Scroll\u2022zoom   Drag\u2022pan   Dbl-click\u2022toggle 2.5\u00d7';
    box.appendChild(hint);

    /* ── zoom / drag state ── */
    var Z_MIN = 1, Z_MAX = 5, Z_FACTOR = 1.13;
    var s = 1, tx = 0, ty = 0;
    var inside = false, dragging = false;
    var dragStartX = 0, dragStartY = 0, dragTx0 = 0, dragTy0 = 0;
    var dragMoved = false, resetTid = null;

    function clamp(ns, ntx, nty) {
      var bw = box.offsetWidth, bh = box.offsetHeight;
      return {
        tx: Math.min(0, Math.max(bw  - bw  * ns, ntx)),
        ty: Math.min(0, Math.max(bh  - bh  * ns, nty))
      };
    }

    function applyTf(animate) {
      img.style.transition = animate
        ? 'transform 0.27s cubic-bezier(0.25,0.46,0.45,0.94)'
        : 'none';
      img.style.transform =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
    }

    function syncBadge() {
      badge.textContent = s.toFixed(1) + '\u00d7';
      var z = s > 1.02;
      badge.classList.toggle('visible', z);
      box.classList.toggle('zoomed', z);
    }

    function setCursor() {
      if (!zoomOn())    { box.style.cursor = 'default';   return; }
      if (s <= 1.02)    { box.style.cursor = 'zoom-in';   return; }
      if (dragging)     { box.style.cursor = 'grabbing';  return; }
      box.style.cursor = 'grab';
    }

    function resetZoom() {
      clearTimeout(resetTid);
      s = 1; tx = 0; ty = 0;
      applyTf(true); syncBadge(); setCursor();
    }

    /* wheel zoom — only intercepts when zoom is on */
    box.addEventListener('wheel', function (e) {
      if (!zoomOn()) return;
      var r = box.getBoundingClientRect();
      var cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (cx < 0 || cy < 0 || cx > r.width || cy > r.height) return;
      e.preventDefault(); e.stopPropagation();

      var factor = e.deltaY < 0 ? Z_FACTOR : 1 / Z_FACTOR;
      var ns = Math.min(Z_MAX, Math.max(Z_MIN, s * factor));
      if (ns === s) return;

      var c = clamp(ns, cx - (cx - tx) / s * ns, cy - (cy - ty) / s * ns);
      s = ns; tx = c.tx; ty = c.ty;
      applyTf(false); syncBadge(); setCursor();
      clearTimeout(resetTid);
      if (s <= Z_MIN + 0.02) resetZoom();
    }, { passive: false });

    box.addEventListener('mouseenter', function () {
      inside = true; clearTimeout(resetTid); setCursor();
    });
    box.addEventListener('mouseleave', function () {
      inside = false;
      if (!dragging && s > Z_MIN + 0.02) resetTid = setTimeout(resetZoom, 700);
      setCursor();
    });

    box.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !zoomOn() || s <= 1.02 || gState.spaceHeld) return;
      e.preventDefault();
      dragging = true; dragMoved = false;
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragTx0 = tx; dragTy0 = ty;
      clearTimeout(resetTid); setCursor();
    });

    function onMove(e) {
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

    function onUp() {
      if (!dragging) return;
      dragging = false; setCursor();
      if (!inside && s > Z_MIN + 0.02) resetTid = setTimeout(resetZoom, 700);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

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
        applyTf(true); syncBadge(); setCursor();
      }
    });

    /* expose for space-pan */
    box._zoom = {
      get s()  { return s;  }, set s(v)  { s  = v; },
      get tx() { return tx; }, set tx(v) { tx = v; },
      get ty() { return ty; }, set ty(v) { ty = v; },
      clamp: clamp,
      rawApply: function () {
        img.style.transition = 'none';
        img.style.transform =
          'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
          ' scale(' + s.toFixed(4) + ')';
      },
      setCursor: setCursor
    };

    box._destroy = function () {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    setCursor();

    /* URL row — text in DOM for Ctrl+F on the card itself */
    var urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';
    var urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url;
    urlTxt.textContent = url;
    urlRow.appendChild(urlTxt);

    /* toolbar */
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
            document.body.appendChild(t); t.select();
            document.execCommand('copy'); t.remove();
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
      rebuildUrlIndex();
      card.classList.add('out');
      setTimeout(function () {
        if (observer) observer.unobserve(slot);
        slot.remove();
      }, 230);
    });

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(removeBtn);
    card.appendChild(hdr);
    card.appendChild(box);
    card.appendChild(urlRow);
    card.appendChild(toolbar);
    return card;
  }

  /* ════════════════════════════════════════════════════════
     KEYBOARD + SPACE-PAN
  ════════════════════════════════════════════════════════ */
  var gState = {
    spaceHeld: false, hoveredBox: null,
    spacePanBox: null, spaceDrag: false,
    spaceStartX: 0, spaceStartY: 0,
    spaceTx0: 0, spaceTy0: 0
  };

  document.addEventListener('mouseover', function (e) {
    gState.hoveredBox = e.target.closest ? e.target.closest('.card-img-box') : null;
  }, { passive: true });

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
    /* Space — always block default, never scroll page */
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
    if (e.repeat || isTypingTarget()) return;
    var k = e.key.toLowerCase();
    if (k !== 'w' && k !== 's') return;
    e.preventDefault();
    heldKeys[k] = true;
    startScroll(k === 's' ? 1 : -1);
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      gState.spaceHeld = false; gState.spaceDrag = false;
      if (gState.spacePanBox && gState.spacePanBox._zoom) gState.spacePanBox._zoom.setCursor();
      gState.spacePanBox = null;
      return;
    }
    var k = e.key.toLowerCase();
    delete heldKeys[k];
    if (!heldKeys['w'] && !heldKeys['s']) stopScroll();
  });

  document.addEventListener('mousedown', function (e) {
    if (!gState.spaceHeld || e.button !== 0) return;
    var box = gState.spacePanBox;
    if (!box || !box._zoom || box._zoom.s <= 1.02) return;
    e.preventDefault(); e.stopPropagation();
    gState.spaceDrag   = true;
    gState.spaceStartX = e.clientX; gState.spaceStartY = e.clientY;
    gState.spaceTx0    = box._zoom.tx; gState.spaceTy0 = box._zoom.ty;
    box.style.cursor = 'grabbing';
  }, { capture: true });

  document.addEventListener('mousemove', function (e) {
    if (!gState.spaceDrag || !gState.spacePanBox) return;
    var z = gState.spacePanBox._zoom;
    if (!z) return;
    var c = z.clamp(z.s,
      gState.spaceTx0 + e.clientX - gState.spaceStartX,
      gState.spaceTy0 + e.clientY - gState.spaceStartY);
    z.tx = c.tx; z.ty = c.ty; z.rawApply();
  });

  document.addEventListener('mouseup', function () {
    if (!gState.spaceDrag) return;
    gState.spaceDrag = false;
    if (gState.spacePanBox && gState.spaceHeld) gState.spacePanBox.style.cursor = 'grab';
  });

  window.addEventListener('blur', function () {
    stopScroll(); heldKeys = {};
    gState.spaceHeld = false; gState.spaceDrag = false;
    if (gState.spacePanBox && gState.spacePanBox._zoom) gState.spacePanBox._zoom.setCursor();
    gState.spacePanBox = null;
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
    rebuildUrlIndex();   /* URLs immediately searchable via Ctrl+F */

    progWrap.classList.remove('hide');
    progFill.style.width = '0%';
    progLabel.textContent = 'Building ' + urls.length + ' slots…';

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
        progLabel.textContent = (i + 1) + ' / ' + urls.length + ' slots placed…';

        await new Promise(function (r) {
          requestAnimationFrame(function () { requestAnimationFrame(r); });
        });
      }
    }

    rebuildObserver();
    progLabel.textContent = urls.length + ' images ready!';
    showStatus(urls.length + ' image' + (urls.length !== 1 ? 's' : '') + ' loaded.', 'ok', 4000);
    setTimeout(function () {
      progWrap.classList.add('hide');
      progFill.style.width = '0%';
    }, 2400);

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

  /* ════════════════════════════════════════════════════════
     BACK TO TOP
  ════════════════════════════════════════════════════════ */
  window.addEventListener('scroll', function () {
    btt.classList.toggle('show', window.scrollY > 280);
  }, { passive: true });

  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  rebuildUrlIndex();

})();
