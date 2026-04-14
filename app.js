/* ================================================================
   BAT-VIEWER — app.js  (clean rewrite v9)

   Features:
   ─ Virtual gallery (IntersectionObserver, ~30-80 live DOM nodes)
   ─ Image size slider  (10 presets)
   ─ W/S keyboard scroll with 5-step fine speed control
     • Speed slider ONLY affects W/S keys
     • Mouse wheel & scrollbar are NEVER touched
   ─ Zoom (disabled by default; checkbox toggles it)
     • Scroll-wheel zoom anchored to cursor
     • Left-click drag to pan when zoomed
     • Double-click to toggle 2.5×
     • Space + drag = space-pan mode
   ─ Image URLs visible in DOM → fully Ctrl+F searchable
   ─ Sticky header with all controls always accessible
================================================================ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     DOM REFS
  ───────────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  var gallery       = $('gallery');
  var bulkArea      = $('bulkArea');
  var bulkTally     = $('bulkTally');
  var bulkLoadBtn   = $('bulkLoadBtn');
  var bulkClearBtn  = $('bulkClearBtn');
  var appendMode    = $('appendMode');
  var statusMsg     = $('statusMsg');
  var progWrap      = $('progWrap');
  var progFill      = $('progFill');
  var progLabel     = $('progLabel');
  var gCount        = $('gCount');
  var clearAllBtn   = $('clearAllBtn');
  var btt           = $('btt');
  var sizerEl       = $('sizer');
  var sizeBadgeEl   = $('sizeBadge');
  var scrollSpeedEl = $('scrollSpeed');
  var scrollBadgeEl = $('scrollBadge');
  var zoomEnabledEl = $('zoomEnabled');

  /* ─────────────────────────────────────────────────────────
     IMAGE SIZE PRESETS
  ───────────────────────────────────────────────────────── */
  var SIZE_PRESETS = [
    { label: 'Tiny',      cols: 5, h: '130px' },
    { label: 'Small',     cols: 4, h: '170px' },
    { label: 'Medium',    cols: 3, h: '230px' },
    { label: 'Large',     cols: 2, h: '320px' },
    { label: 'XL',        cols: 2, h: '460px' },
    { label: 'XXL',       cols: 1, h: '520px' },
    { label: '1/Screen',  cols: 1, h: '70vh'  },
    { label: '1/Screen+', cols: 1, h: '80vh'  },
    { label: 'Full',      cols: 1, h: '88vh'  },
    { label: 'Max',       cols: 1, h: '94vh'  },
  ];

  var currentH = SIZE_PRESETS[2].h;

  function applySize(v) {
    var p = SIZE_PRESETS[v - 1];
    currentH = p.h;
    sizeBadgeEl.textContent = p.label;
    gallery.style.gridTemplateColumns =
      p.cols === 1 ? '1fr' : 'repeat(' + p.cols + ',minmax(0,1fr))';
    /* update all live card-img-box heights */
    var boxes = gallery.querySelectorAll('.card-img-box');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].style.height = p.h;
    }
  }

  sizerEl.addEventListener('input', function () {
    applySize(parseInt(sizerEl.value, 10));
  });
  applySize(parseInt(sizerEl.value, 10));

  /* ─────────────────────────────────────────────────────────
     W/S KEYBOARD SCROLL SPEED
     5 fine-grained presets.
     These values ONLY affect W/S key scrolling.
     Mouse-wheel events are never intercepted here.
  ───────────────────────────────────────────────────────── */
  var SCROLL_PRESETS = [
    { label: 'Very Slow', base: 18,  max:  60, ramp:  8  },
    { label: 'Slow',      base: 35,  max: 110, ramp: 15  },
    { label: 'Medium',    base: 60,  max: 180, ramp: 25  },
    { label: 'Fast',      base: 100, max: 280, ramp: 40  },
    { label: 'Very Fast', base: 150, max: 420, ramp: 60  },
  ];

  function getScrollPreset() {
    var idx = Math.min(4, Math.max(0, parseInt(scrollSpeedEl.value, 10) - 1));
    return SCROLL_PRESETS[idx];
  }

  function syncScrollBadge() {
    scrollBadgeEl.textContent = getScrollPreset().label;
  }

  scrollSpeedEl.addEventListener('input', syncScrollBadge);
  syncScrollBadge();

  /* ─────────────────────────────────────────────────────────
     ZOOM TOGGLE  (off by default — checkbox unchecked)
  ───────────────────────────────────────────────────────── */
  function zoomOn() { return zoomEnabledEl.checked; }

  /* ─────────────────────────────────────────────────────────
     URL / STATUS HELPERS
  ───────────────────────────────────────────────────────── */
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
    var el = document.activeElement;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  var stTimer = null;
  function showStatus(msg, cls, ms) {
    clearTimeout(stTimer);
    statusMsg.textContent = msg;
    statusMsg.className = 'status ' + (cls || 'ok');
    stTimer = setTimeout(function () { statusMsg.className = 'status hide'; }, ms || 3000);
  }

  function refreshCount() { gCount.textContent = allUrls.length; }

  bulkArea.addEventListener('input', function () {
    var n = parseUrls(bulkArea.value).length;
    bulkTally.innerHTML = '<b>' + n + '</b> URL' + (n !== 1 ? 's' : '') + ' detected';
  });

  /* ─────────────────────────────────────────────────────────
     VIRTUAL GALLERY ENGINE
     allUrls[]  = master list  (never touches DOM)
     slots[]    = one <div.vslot> per URL
     IntersectionObserver builds real cards when visible,
     destroys them when off-screen to stay memory-light.
  ───────────────────────────────────────────────────────── */
  var allUrls   = [];
  var slots     = [];
  var activeSet = new Set();
  var observer  = null;
  var isLoading = false;

  function makeSlot(i) {
    var slot = document.createElement('div');
    slot.className = 'vslot';
    slot.style.minHeight = currentH;
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
    refreshCount();
  }

  /* ─────────────────────────────────────────────────────────
     CARD FACTORY
     Zoom model:  transform = translate(tx,ty) scale(s)
                  transform-origin fixed at "0 0"
     Clamp keeps image filling the box (no empty gaps).
  ───────────────────────────────────────────────────────── */
  function buildCard(cardIdx) {
    var url = allUrls[cardIdx];
    var num = cardIdx + 1;

    /* card */
    var card = document.createElement('div');
    card.className = 'card';

    /* header */
    var hdr = document.createElement('div');
    hdr.className = 'card-header';
    var numEl  = document.createElement('span');
    numEl.className = 'card-num';
    numEl.textContent = 'Image ' + num;
    var dimsEl = document.createElement('span');
    dimsEl.className = 'card-dims';
    hdr.appendChild(numEl);
    hdr.appendChild(dimsEl);

    /* image box — height matches current size preset */
    var box = document.createElement('div');
    box.className = 'card-img-box';
    box.style.height = currentH;

    /* spinner */
    var spin = document.createElement('div');
    spin.className = 'card-spinner';
    spin.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spin);

    /* image */
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

    /* ── zoom badge + hint ── */
    var badge = document.createElement('div');
    badge.className = 'zoom-badge';
    box.appendChild(badge);

    var hint = document.createElement('div');
    hint.className = 'zoom-hint';
    hint.textContent = 'Scroll\u2022zoom   Drag\u2022pan   Dbl-click\u2022toggle 2.5\u00d7';
    box.appendChild(hint);

    /* ──────────────────────────────────────────────────────
       ZOOM + DRAG STATE (per card)
    ────────────────────────────────────────────────────── */
    var Z_MIN    = 1;
    var Z_MAX    = 5;
    var Z_FACTOR = 1.13;

    var s  = 1, tx = 0, ty = 0;
    var inside     = false;
    var dragging   = false;
    var dragStartX = 0, dragStartY = 0;
    var dragTx0    = 0, dragTy0    = 0;
    var dragMoved  = false;
    var resetTid   = null;

    function clamp(ns, ntx, nty) {
      var bw = box.offsetWidth, bh = box.offsetHeight;
      return {
        tx: Math.min(0, Math.max(bw - bw * ns, ntx)),
        ty: Math.min(0, Math.max(bh - bh * ns, nty))
      };
    }

    function applyTransform(animate) {
      img.style.transition = animate
        ? 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)'
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
      if (!zoomOn())       { box.style.cursor = 'default'; return; }
      if (s <= 1.02)       { box.style.cursor = 'zoom-in'; return; }
      if (dragging)        { box.style.cursor = 'grabbing'; return; }
      box.style.cursor = 'grab';
    }

    function resetZoom() {
      clearTimeout(resetTid);
      s = 1; tx = 0; ty = 0;
      applyTransform(true);
      syncBadge();
      setCursor();
    }

    /* ── wheel zoom (only when zoomOn()) ── */
    box.addEventListener('wheel', function (e) {
      if (!zoomOn()) return;   /* zoom off → don't intercept wheel */

      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left;
      var cy = e.clientY - r.top;
      /* strict boundary — only act if cursor is inside the box */
      if (cx < 0 || cy < 0 || cx > r.width || cy > r.height) return;

      e.preventDefault();   /* stop page scroll ONLY inside zoomed box */
      e.stopPropagation();

      var factor = e.deltaY < 0 ? Z_FACTOR : 1 / Z_FACTOR;
      var ns = Math.min(Z_MAX, Math.max(Z_MIN, s * factor));
      if (ns === s) return;

      /* keep cursor point stationary */
      var ipx = (cx - tx) / s;
      var ipy = (cy - ty) / s;
      var c   = clamp(ns, cx - ipx * ns, cy - ipy * ns);
      s = ns; tx = c.tx; ty = c.ty;
      applyTransform(false);
      syncBadge();
      setCursor();

      clearTimeout(resetTid);
      if (s <= Z_MIN + 0.02) resetZoom();
    }, { passive: false });

    /* ── mouse enter/leave ── */
    box.addEventListener('mouseenter', function () {
      inside = true;
      clearTimeout(resetTid);
      setCursor();
    });

    box.addEventListener('mouseleave', function () {
      inside = false;
      if (!dragging && s > Z_MIN + 0.02) {
        resetTid = setTimeout(resetZoom, 700);
      }
      setCursor();
    });

    /* ── mousedown → left-drag pan (when zoomed, zoom on, space not held) ── */
    box.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!zoomOn() || s <= 1.02) return;
      if (gState.spaceHeld) return;  /* space-pan takes over */
      e.preventDefault();
      dragging   = true;
      dragMoved  = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragTx0    = tx;
      dragTy0    = ty;
      clearTimeout(resetTid);
      setCursor();
    });

    function onMove(e) {
      if (!dragging) return;
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

    function onUp() {
      if (!dragging) return;
      dragging = false;
      setCursor();
      if (!inside && s > Z_MIN + 0.02) resetTid = setTimeout(resetZoom, 700);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    /* ── double-click → toggle 2.5× ── */
    box.addEventListener('dblclick', function (e) {
      if (!zoomOn() || dragMoved) return;
      var r  = box.getBoundingClientRect();
      var cx = e.clientX - r.left;
      var cy = e.clientY - r.top;
      if (s > 1.05) {
        resetZoom();
      } else {
        var ns  = 2.5;
        var ipx = (cx - tx) / s;
        var ipy = (cy - ty) / s;
        var c   = clamp(ns, cx - ipx * ns, cy - ipy * ns);
        s = ns; tx = c.tx; ty = c.ty;
        applyTransform(true); syncBadge(); setCursor();
      }
    });

    /* ── expose API for space-pan ── */
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

    /* ── URL row  (plain text in DOM → Ctrl+F finds it) ── */
    var urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';
    var urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url;
    urlTxt.textContent = url;   /* plain text node → browser find works */
    urlRow.appendChild(urlTxt);

    /* ── toolbar ── */
    var toolbar = document.createElement('div');
    toolbar.className = 'card-toolbar';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'tcopy';
    copyBtn.textContent = 'Copy Link';
    var copyTid = null;
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
        clearTimeout(copyTid);
        copyTid = setTimeout(function () {
          copyBtn.textContent = 'Copy Link'; copyBtn.classList.remove('ok');
        }, 1600);
      });
    });

    var removeBtn = document.createElement('button');
    removeBtn.className = 'tremove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      if (box._destroy) box._destroy();
      allUrls.splice(cardIdx, 1);
      var slot = slots.splice(cardIdx, 1)[0];
      activeSet.delete(cardIdx);
      /* re-index subsequent slots */
      for (var j = cardIdx; j < slots.length; j++) {
        slots[j].dataset.idx = String(j);
        var n = slots[j].querySelector('.card-num');
        if (n) n.textContent = 'Image ' + (j + 1);
      }
      card.classList.add('out');
      setTimeout(function () {
        if (observer) observer.unobserve(slot);
        slot.remove(); refreshCount();
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

  /* ─────────────────────────────────────────────────────────
     GLOBAL KEYBOARD + SPACE-PAN STATE
     Shared across all card instances via gState object.
  ───────────────────────────────────────────────────────── */
  var gState = {
    spaceHeld:     false,
    hoveredBox:    null,
    spacePanBox:   null,
    spaceDrag:     false,
    spaceStartX:   0, spaceStartY: 0,
    spaceTx0:      0, spaceTy0:    0
  };

  /* track which box cursor is over */
  document.addEventListener('mouseover', function (e) {
    var b = e.target.closest ? e.target.closest('.card-img-box') : null;
    gState.hoveredBox = b || null;
  }, { passive: true });

  /* ── rAF scroll loop for W/S keys ── */
  var scrollVel = 0, scrollDir = 0, scrollRafId = null;
  var heldKeys  = {};

  function scrollTick() {
    if (scrollDir === 0) return;
    var p = getScrollPreset();
    /* ramp velocity each frame */
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

    /* SPACE — always block default (never let it scroll page) */
    if (e.code === 'Space') {
      e.preventDefault();
      if (gState.spaceHeld) return;
      gState.spaceHeld = true;
      /* activate grab cursor on hovered zoomed box */
      var box = gState.hoveredBox;
      if (box && box._zoom && box._zoom.s > 1.02 && zoomOn()) {
        box.style.cursor = 'grab';
        gState.spacePanBox = box;
      }
      return;
    }

    /* W / S — keyboard page scroll only */
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
      gState.spaceHeld  = false;
      gState.spaceDrag  = false;
      if (gState.spacePanBox && gState.spacePanBox._zoom) {
        gState.spacePanBox._zoom.setCursor();
      }
      gState.spacePanBox = null;
      return;
    }
    var k = e.key.toLowerCase();
    delete heldKeys[k];
    if (!heldKeys['w'] && !heldKeys['s']) stopScroll();
  });

  /* ── Space + mousedown → start space-pan drag ── */
  document.addEventListener('mousedown', function (e) {
    if (!gState.spaceHeld || e.button !== 0) return;
    var box = gState.spacePanBox;
    if (!box || !box._zoom) return;
    var z = box._zoom;
    if (z.s <= 1.02) return;
    e.preventDefault(); e.stopPropagation();
    gState.spaceDrag    = true;
    gState.spaceStartX  = e.clientX;
    gState.spaceStartY  = e.clientY;
    gState.spaceTx0     = z.tx;
    gState.spaceTy0     = z.ty;
    box.style.cursor = 'grabbing';
  }, { capture: true });

  document.addEventListener('mousemove', function (e) {
    if (!gState.spaceDrag || !gState.spacePanBox) return;
    var box = gState.spacePanBox;
    var z   = box._zoom;
    if (!z) return;
    var c = z.clamp(z.s,
      gState.spaceTx0 + (e.clientX - gState.spaceStartX),
      gState.spaceTy0 + (e.clientY - gState.spaceStartY));
    z.tx = c.tx; z.ty = c.ty;
    z.rawApply();
  });

  document.addEventListener('mouseup', function () {
    if (!gState.spaceDrag) return;
    gState.spaceDrag = false;
    if (gState.spacePanBox && gState.spaceHeld) {
      gState.spacePanBox.style.cursor = 'grab';
    }
  });

  /* reset everything on focus loss */
  window.addEventListener('blur', function () {
    stopScroll(); heldKeys = {};
    gState.spaceHeld = false; gState.spaceDrag = false;
    if (gState.spacePanBox && gState.spacePanBox._zoom) {
      gState.spacePanBox._zoom.setCursor();
    }
    gState.spacePanBox = null;
  });

  /* ─────────────────────────────────────────────────────────
     BULK LOAD
  ───────────────────────────────────────────────────────── */
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
    refreshCount();
    progLabel.textContent = urls.length + ' images ready!';
    showStatus(urls.length + ' image' + (urls.length !== 1 ? 's' : '') + ' loaded.', 'ok', 4000);
    setTimeout(function () {
      progWrap.classList.add('hide');
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

  /* ─────────────────────────────────────────────────────────
     BACK TO TOP
  ───────────────────────────────────────────────────────── */
  window.addEventListener('scroll', function () {
    btt.classList.toggle('show', window.scrollY > 300);
  }, { passive: true });

  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  refreshCount();

})();
