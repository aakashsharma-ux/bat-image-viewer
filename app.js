/* ════════════════════════════════════════════════════════════
   BAT-VIEWER  app.js  v13

   IMAGE RENDERING GUARANTEE:
   ─ Every image is displayed at full width of its card column.
   ─ height:auto preserves aspect ratio — no distortion ever.
   ─ max-height (from size slider) caps very tall images using
     object-fit:contain — the full image is visible, letterboxed
     inside the card background. NOT a single pixel is cropped.
   ─ overflow:hidden is NEVER set on .card-img-box.
   ─ The card itself uses overflow:visible.

   ZOOM:
   ─ Clicking a zoomed image opens a fullscreen lightbox overlay.
   ─ Inside the overlay: scroll-wheel zoom, drag-to-pan, Esc/click-X closes.
   ─ The source card image is never modified or clipped.
   ─ Z key toggles the zoom-enabled checkbox (synced).
   ─ When zoom is OFF, clicking an image does nothing.

   KEYBOARD:
   ─ W / S  → page scroll (speed from slider)
   ─ Space  → blocked (never scrolls page)
   ─ Z      → toggle zoom checkbox
   ─ Esc    → close lightbox

   CTRL+F:
   ─ Each .vslot contains a .url-label text node even when the
     card is not rendered, so all URLs are always findable.
════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  function $id(id) { return document.getElementById(id); }

  /* ── DOM refs ── */
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

  /* ════════════════════════════════════════════════════════
     SIZE PRESETS
     max-height is applied to .card-img (the <img> tag).
     The box has no fixed height — it grows with the image.
     object-fit:contain + object-position:top center ensures
     the full image is always visible when max-height kicks in.
  ════════════════════════════════════════════════════════ */
  var SIZE_PRESETS = [
    { label: 'Tiny',       cols: 5, maxH: '120px' },
    { label: 'Small',      cols: 4, maxH: '160px' },
    { label: 'Medium',     cols: 3, maxH: '220px' },
    { label: 'Large',      cols: 2, maxH: '320px' },
    { label: 'XL',         cols: 2, maxH: '440px' },
    { label: 'XXL',        cols: 1, maxH: '540px' },
    { label: '1/Screen',   cols: 1, maxH: '70vh'  },
    { label: '1/Screen+',  cols: 1, maxH: '80vh'  },
    { label: 'Full',       cols: 1, maxH: '90vh'  },
    { label: 'Max',        cols: 1, maxH: 'none'  },  /* no cap */
  ];

  var currentMaxH = SIZE_PRESETS[2].maxH;

  function applySize(v) {
    var p = SIZE_PRESETS[Math.min(9, Math.max(0, v - 1))];
    currentMaxH = p.maxH;
    sizeBadgeEl.textContent = p.label;
    gallery.style.gridTemplateColumns =
      p.cols === 1 ? '1fr' : 'repeat(' + p.cols + ',minmax(0,1fr))';
    /* update all live card images */
    gallery.querySelectorAll('.card-img').forEach(function (img) {
      img.style.maxHeight = p.maxH;
    });
    /* update slot min-height hints for grid layout stability */
    gallery.querySelectorAll('.vslot').forEach(function (s) {
      s.style.minHeight = p.maxH === 'none' ? '200px' : p.maxH;
    });
  }

  sizerEl.addEventListener('input', function () { applySize(parseInt(sizerEl.value, 10)); });
  applySize(parseInt(sizerEl.value, 10));

  /* ════════════════════════════════════════════════════════
     SCROLL SPEED  (W/S keys only)
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
     ZOOM TOGGLE  — off by default, Z key syncs with checkbox
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
     ZOOM LIGHTBOX OVERLAY
     A single fullscreen overlay reused for every image.
     The overlay has overflow:hidden to clip the zoomed image —
     the SOURCE card is NEVER touched or modified.
  ════════════════════════════════════════════════════════ */
  var overlay = document.createElement('div');
  overlay.id = 'zoomOverlay';
  overlay.innerHTML =
    '<div class="zo-img-wrap">' +
      '<img id="zoomImg" alt="Zoomed image">' +
      '<button id="zoomClose">✕ Close</button>' +
      '<div id="zoomBadge">1.0×</div>' +
      '<div id="zoomHint">Scroll · zoom &nbsp;&nbsp; Drag · pan &nbsp;&nbsp; Esc · close</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var zoomImg    = $id('zoomImg');
  var zoomClose  = $id('zoomClose');
  var zoomBadge  = $id('zoomBadge');

  /* Zoom state */
  var zS = 1, zTx = 0, zTy = 0;
  var zDragging  = false;
  var zStartX = 0, zStartY = 0, zTx0 = 0, zTy0 = 0;
  var Z_MIN = 1, Z_MAX = 8, Z_FACTOR = 1.15;

  function zApply(animate) {
    zoomImg.style.transition = animate
      ? 'transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
    zoomImg.style.transform =
      'translate(' + zTx.toFixed(1) + 'px,' + zTy.toFixed(1) + 'px)' +
      ' scale(' + zS.toFixed(4) + ')';
    zoomBadge.textContent = zS.toFixed(1) + '\u00d7';
  }

  function zClamp(ns, ntx, nty) {
    /* Clamp so image always covers viewport (no empty gap visible) */
    var vw = window.innerWidth, vh = window.innerHeight;
    var iw = zoomImg.naturalWidth  || vw;
    var ih = zoomImg.naturalHeight || vh;
    /* fitted dimensions inside viewport at scale 1 */
    var ratio    = Math.min(vw / iw, vh / ih);
    var fw = iw * ratio, fh = ih * ratio;
    /* at zoom level ns */
    var sw = fw * ns, sh = fh * ns;
    var ox = (vw - fw) / 2;   /* initial centering offset */
    var oy = (vh - fh) / 2;
    var minTx = sw >= vw ? -(sw - vw) - ox * ns : (vw - sw) / 2 - ox * ns;
    var maxTx = -ox * ns;
    var minTy = sh >= vh ? -(sh - vh) - oy * ns : (vh - sh) / 2 - oy * ns;
    var maxTy = -oy * ns;
    return {
      tx: sw < vw ? (vw - sw) / 2 - ox * ns : Math.min(maxTx, Math.max(minTx, ntx)),
      ty: sh < vh ? (vh - sh) / 2 - oy * ns : Math.min(maxTy, Math.max(minTy, nty))
    };
  }

  function openLightbox(url) {
    zS = 1; zTx = 0; zTy = 0;
    zoomImg.style.transition = 'none';
    zoomImg.style.transform  = 'translate(0,0) scale(1)';
    zoomImg.style.transformOrigin = '0 0';
    zoomImg.src = url;
    zoomBadge.textContent = '1.0\u00d7';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    zoomImg.src = '';
    zDragging = false;
  }

  zoomClose.addEventListener('click', closeLightbox);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeLightbox();
  });

  overlay.addEventListener('wheel', function (e) {
    e.preventDefault();
    var wrap  = overlay.querySelector('.zo-img-wrap');
    var rect  = wrap.getBoundingClientRect();
    var cx    = e.clientX - rect.left;
    var cy    = e.clientY - rect.top;

    /* cursor-anchored zoom math */
    var factor = e.deltaY < 0 ? Z_FACTOR : 1 / Z_FACTOR;
    var ns = Math.min(Z_MAX, Math.max(Z_MIN, zS * factor));
    if (ns === zS) return;

    var ipx = (cx - zTx) / zS;
    var ipy = (cy - zTy) / zS;
    var c   = zClamp(ns, cx - ipx * ns, cy - ipy * ns);
    zS = ns; zTx = c.tx; zTy = c.ty;
    zApply(false);
  }, { passive: false });

  zoomImg.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    zDragging = true; zStartX = e.clientX; zStartY = e.clientY;
    zTx0 = zTx; zTy0 = zTy;
    zoomImg.classList.add('dragging');
  });

  document.addEventListener('mousemove', function (e) {
    if (!zDragging) return;
    var c = zClamp(zS, zTx0 + e.clientX - zStartX, zTy0 + e.clientY - zStartY);
    zTx = c.tx; zTy = c.ty;
    zoomImg.style.transition = 'none';
    zoomImg.style.transform =
      'translate(' + zTx.toFixed(1) + 'px,' + zTy.toFixed(1) + 'px)' +
      ' scale(' + zS.toFixed(4) + ')';
    zoomBadge.textContent = zS.toFixed(1) + '\u00d7';
  });

  document.addEventListener('mouseup', function () {
    if (!zDragging) return;
    zDragging = false;
    zoomImg.classList.remove('dragging');
  });

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
    slot.style.minHeight = currentMaxH === 'none' ? '200px' : currentMaxH;
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
     THE CORE RENDERING CONTRACT:
     - .card-img-box  → no overflow:hidden, no fixed height
     - .card-img      → width:100%, height:auto, max-height from slider
     - object-fit:contain → if max-height reached, scale DOWN to fit
                            but NEVER crop. Full image always visible.
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

    /* image box — no clipping, no fixed height */
    var box = document.createElement('div');
    box.className = 'card-img-box';

    /* spinner (absolute so it doesn't push box height) */
    var spin = document.createElement('div');
    spin.className = 'card-spinner';
    spin.innerHTML = '<div class="spinner"></div>';
    box.appendChild(spin);

    /* image — this is the ONLY element doing visual rendering */
    var img = document.createElement('img');
    img.className = 'card-img';
    img.alt = 'Image ' + num;
    img.decoding = 'async';
    img.draggable = false;
    img.style.maxHeight = currentMaxH;

    img.addEventListener('load', function () {
      spin.remove();
      if (img.naturalWidth) {
        dimsEl.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
      }
      /* Update cursor based on zoom state */
      updateBoxCursor(box);
    });

    img.addEventListener('error', function () {
      spin.remove();
      box.innerHTML =
        '<div class="card-err">\u26a0 Could not load<br>' +
        '<small style="opacity:.4;word-break:break-all;">' + url + '</small></div>';
    });

    img.src = url;
    box.appendChild(img);

    /* Click image to open in lightbox (when zoom enabled) */
    box.addEventListener('click', function (e) {
      if (!zoomOn()) return;
      if (e.target === box || e.target === img) {
        openLightbox(url);
      }
    });

    function updateBoxCursor(b) {
      b.classList.toggle('zoom-ready', zoomOn());
      if (!zoomOn()) b.classList.remove('zoom-ready', 'zoom-active', 'zoom-dragging');
    }

    /* Re-apply cursor on zoom toggle */
    zoomEnabledEl.addEventListener('change', function () {
      updateBoxCursor(box);
    });

    updateBoxCursor(box);

    /* URL row */
    var urlRow = document.createElement('div');
    urlRow.className = 'card-url-row';
    var urlTxt = document.createElement('span');
    urlTxt.className = 'card-url-text';
    urlTxt.title = url; urlTxt.textContent = url;
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

    /* Esc — close lightbox */
    if (e.key === 'Escape') {
      if (overlay.classList.contains('open')) closeLightbox();
      return;
    }

    /* Space — always prevent page scroll */
    if (e.code === 'Space') {
      e.preventDefault();
      return;
    }

    /* Ignore when typing */
    if (isTypingTarget()) return;

    var k = e.key.toLowerCase();

    /* Z — toggle zoom checkbox */
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
    var k = e.key.toLowerCase();
    delete heldKeys[k];
    if (!heldKeys['w'] && !heldKeys['s']) stopScroll();
  });

  window.addEventListener('blur', function () {
    stopScroll(); heldKeys = {};
    if (overlay.classList.contains('open')) closeLightbox();
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
