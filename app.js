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
       Model: transform = translate(tx, ty) scale(s)
       with transform-origin ALWAYS fixed at "0 0".

       Why this beats changing transform-origin:
         Changing transform-origin on an already-scaled element
         shifts the visual position, causing jumps.  Instead we
         keep the origin at top-left (0 0) and compute the exact
         tx/ty that keeps the pixel under the cursor stationary.

       Math for cursor-anchored zoom:
         Before zoom: point P is at screen position (cx, cy).
         P in image space = ((cx - tx) / s,  (cy - ty) / s)
         After new scale s2, we want P to stay at (cx, cy):
           cx = tx2 + P.x * s2
           tx2 = cx - P.x * s2 = cx - ((cx - tx) / s) * s2

       Coordinates are in box-local pixels (no percentages).
    ──────────────────────────────────────────────────────── */
    const ZOOM_MIN  = 1;
    const ZOOM_MAX  = 5;
    const ZOOM_FACTOR = 1.15;   // multiply/divide scale per wheel notch

    let s  = 1;     // current scale
    let tx = 0;     // current translate X (px, box-local)
    let ty = 0;     // current translate Y (px, box-local)
    let resetTimer  = null;
    let insideBox   = false;

    /* Always keep transform-origin at top-left so math stays simple */
    img.style.transformOrigin = '0 0';

    /* Zoom level badge */
    const zoomBadge = document.createElement('div');
    zoomBadge.className = 'zoom-badge';
    zoomBadge.textContent = '1\u00d7';
    box.appendChild(zoomBadge);

    /* Clamp translate so the image never leaves the box */
    function clampTranslate(scale, newTx, newTy) {
      const bw = box.offsetWidth;
      const bh = box.offsetHeight;
      const maxTx = 0;
      const minTx = bw - bw * scale;
      const maxTy = 0;
      const minTy = bh - bh * scale;
      return {
        tx: Math.min(maxTx, Math.max(minTx, newTx)),
        ty: Math.min(maxTy, Math.max(minTy, newTy))
      };
    }

    /* Expose zoom state + clamp to the global space-pan handler.
       We use a plain object so mutations (tx=, ty=) are reflected
       in commitZoom which reads s/tx/ty from the same closure. */
    box._zoomState = { get s() { return s; }, get tx() { return tx; }, get ty() { return ty; },
                       set s(v) { s = v; },   set tx(v) { tx = v; },   set ty(v) { ty = v; } };
    box._clamp     = clampTranslate;

    /* Commit s / tx / ty to the DOM */
    function commitZoom(animate) {
      img.style.transition = animate
        ? 'transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)'
        : 'none';
      img.style.transform =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';

      zoomBadge.textContent = s.toFixed(1) + '\u00d7';
      const zoomed = s > 1.02;
      zoomBadge.classList.toggle('visible', zoomed);
      box.classList.toggle('zoomed', zoomed);
    }

    /* Animate back to identity */
    function resetZoom() {
      clearTimeout(resetTimer);
      s = 1; tx = 0; ty = 0;
      commitZoom(true);
    }

    /* ── Wheel: strict boundary check then zoom ── */
    box.addEventListener('wheel', function (e) {
      /* Hard boundary: only react when pointer is provably inside the box */
      const rect = box.getBoundingClientRect();
      const cx = e.clientX - rect.left;   // cursor X in box-local px
      const cy = e.clientY - rect.top;    // cursor Y in box-local px

      if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height) return;

      e.preventDefault();
      e.stopPropagation();

      /* Determine zoom direction: deltaY>0 = scroll down = zoom out */
      const dir    = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const newS   = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * dir));
      if (newS === s) return;

      /* Cursor-anchored translate:
         We want the box-local point (cx, cy) to map to the same
         image point before and after the scale change.
         Image-space point = (cx - tx) / s
         New translate = cx - imagePoint * newS               */
      const imgPx = (cx - tx) / s;
      const imgPy = (cy - ty) / s;
      let newTx = cx - imgPx * newS;
      let newTy = cy - imgPy * newS;

      /* Clamp so image fills the box (no empty gaps) */
      const clamped = clampTranslate(newS, newTx, newTy);
      s  = newS;
      tx = clamped.tx;
      ty = clamped.ty;

      commitZoom(false);

      /* Auto-reset timer when zoomed back to 1× */
      clearTimeout(resetTimer);
      if (s <= ZOOM_MIN + 0.02) resetZoom();
    }, { passive: false });

    /* ── Mouse enter/leave — strict box tracking ── */
    box.addEventListener('mouseenter', function () {
      insideBox = true;
      clearTimeout(resetTimer);
    });

    box.addEventListener('mouseleave', function () {
      insideBox = false;
      if (s > ZOOM_MIN + 0.02) {
        resetTimer = setTimeout(resetZoom, 600);
      }
    });

    /* ── Double-click: toggle 2.5× anchored at click point ── */
    box.addEventListener('dblclick', function (e) {
      /* Ignore if this dblclick ended a drag */
      if (dragMoved) return;
      const rect = box.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (s > 1.05) {
        resetZoom();
      } else {
        const targetS = 2.5;
        const imgPx   = (cx - tx) / s;
        const imgPy   = (cy - ty) / s;
        const clamped = clampTranslate(targetS,
          cx - imgPx * targetS,
          cy - imgPy * targetS);
        s  = targetS;
        tx = clamped.tx;
        ty = clamped.ty;
        commitZoom(true);
      }
    });

    /* ── DRAG / PAN ──────────────────────────────────────────
       Only active when s > 1 (zoomed in).
       Uses box-scoped mousemove/mouseup so the drag stays
       locked even if the pointer briefly leaves the image.
       Space key is explicitly ignored — it must never affect zoom.
    ──────────────────────────────────────────────────────── */
    let dragging  = false;
    let dragMoved = false;   // suppresses dblclick after drag
    let dragStartX = 0;
    let dragStartY = 0;
    let dragTx0    = 0;
    let dragTy0    = 0;

    /* Update cursor — space-pan system may override this externally */
    function updateCursor() {
      if (s <= 1.02) {
        box.style.cursor = 'zoom-in';
      } else if (dragging || spaceDragging) {
        box.style.cursor = 'grabbing';
      } else if (spaceHeld && hoveredBox === box) {
        box.style.cursor = 'grab';
      } else {
        box.style.cursor = 'grab';
      }
    }
    box._updateCursor = updateCursor;

    box.addEventListener('mousedown', function (e) {
      /* Only left button; never triggered by space or keyboard */
      if (e.button !== 0) return;
      if (s <= 1.02) return;           // not zoomed — nothing to pan
      e.preventDefault();

      dragging   = true;
      dragMoved  = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragTx0    = tx;
      dragTy0    = ty;
      clearTimeout(resetTimer);        // freeze auto-reset while dragging
      updateCursor();
    });

    /* Use document-level listeners so drag works even if pointer
       briefly exits the box boundary during a fast swipe */
    function onMouseMove(e) {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      /* Mark as a real drag once the pointer moves > 2 px */
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

      const clamped = clampTranslate(s, dragTx0 + dx, dragTy0 + dy);
      tx = clamped.tx;
      ty = clamped.ty;

      /* No transition during live drag — instant follow */
      img.style.transition = 'none';
      img.style.transform  =
        'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)' +
        ' scale(' + s.toFixed(4) + ')';
    }

    function onMouseUp(e) {
      if (!dragging) return;
      dragging = false;
      updateCursor();

      /* Restart auto-reset clock if cursor is outside the box */
      if (!insideBox && s > ZOOM_MIN + 0.02) {
        resetTimer = setTimeout(resetZoom, 600);
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);

    /* Clean up document listeners when the card is removed from DOM */
    box._cleanupDrag = function () {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };

    /* Update cursor whenever zoom level changes */
    const _origCommit = commitZoom;
    function commitZoomWithCursor(animate) {
      _origCommit(animate);
      updateCursor();
    }
    /* Rebind so all callers get cursor update */
    box.__commitZoom = commitZoomWithCursor;

    /* Initialise cursor */
    updateCursor();

    /* Hint overlay */
    const zoomHint = document.createElement('div');
    zoomHint.className = 'zoom-hint';
    zoomHint.textContent =
      'Scroll \u2022 zoom    Drag \u2022 pan    Dbl-click \u2022 2.5\u00d7';
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
      /* Clean up document-level drag listeners */
      if (box._cleanupDrag) box._cleanupDrag();

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
    /* Clean up any document-level drag listeners before wiping the card */
    const b = slot.querySelector('.card-img-box');
    if (b && b._cleanupDrag) b._cleanupDrag();
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

  /* ════════════════════════════════════════════════════════
     KEYBOARD SCROLL  (W = up, S = down)
     SPACE PAN MODE   (hold Space + drag = pan any zoomed image)
     ─────────────────────────────────────────────────────
     Space key:
       • NEVER scrolls the page (always e.preventDefault())
       • While held, activates "pan mode" on whatever zoomed
         image the cursor is currently over.
       • Cursor changes to "grab" on the hovered box, "grabbing"
         while dragging.
       • Releasing Space cancels pan mode and restores cursor.

     W / S scroll:
       • Uses requestAnimationFrame loop for smooth motion.
       • Speed is driven by the Scroll Speed slider (1-3):
           1 = Slow  (base 40 px, max 120 px/frame)
           2 = Med   (base 80 px, max 240 px/frame)
           3 = Fast  (base 140 px, max 420 px/frame)
       • Acceleration ramps from base → max while key held.
       • Instant stop on key-up; window blur also stops scroll.

     Guards (both features):
       • Ignored when focus is in INPUT / TEXTAREA / contenteditable.
  ════════════════════════════════════════════════════════ */

  /* ── Scroll speed presets driven by #scrollSpeed slider ── */
  const scrollSpeedEl = document.getElementById('scrollSpeed');
  const scrollBadgeEl = document.getElementById('scrollBadge');

  const SPEED_PRESETS = [
    { label: 'Slow',   base: 40,  max: 120,  ramp: 20 },
    { label: 'Medium', base: 80,  max: 240,  ramp: 35 },
    { label: 'Fast',   base: 140, max: 420,  ramp: 60 },
  ];

  function getSpeedPreset() {
    return SPEED_PRESETS[parseInt(scrollSpeedEl.value, 10) - 1];
  }

  scrollSpeedEl.addEventListener('input', function () {
    scrollBadgeEl.textContent = getSpeedPreset().label;
  });
  scrollBadgeEl.textContent = getSpeedPreset().label;

  let scrollVelocity = 0;
  let scrollRafId    = null;
  let scrollDir      = 0;
  const heldKeys     = {};

  function isTypingTarget() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function scrollTick() {
    if (scrollDir === 0) return;
    const preset = getSpeedPreset();
    scrollVelocity = Math.min(preset.max, scrollVelocity + preset.ramp);
    window.scrollBy({ top: scrollDir * scrollVelocity, behavior: 'instant' });
    scrollRafId = requestAnimationFrame(scrollTick);
  }

  function startScroll(dir) {
    if (scrollDir === dir) return;
    cancelAnimationFrame(scrollRafId);
    scrollDir      = dir;
    scrollVelocity = getSpeedPreset().base;
    scrollRafId    = requestAnimationFrame(scrollTick);
  }

  function stopScroll() {
    cancelAnimationFrame(scrollRafId);
    scrollDir      = 0;
    scrollVelocity = 0;
  }

  /* ── SPACE PAN MODE ── */
  let spaceHeld      = false;    // is Space currently down?
  let spacePanBox    = null;     // which box is being panned
  let spaceDragging  = false;
  let spaceStartX    = 0;
  let spaceStartY    = 0;
  let spaceTx0       = 0;
  let spaceTy0       = 0;
  /* track which box the cursor is hovering — updated via mouseover */
  let hoveredBox     = null;

  document.addEventListener('mouseover', function (e) {
    const box = e.target.closest('.card-img-box');
    hoveredBox = box || null;
  });

  /* Space keydown: activate pan mode on the hovered box (if zoomed) */
  document.addEventListener('keydown', function (e) {
    /* ── SPACE ── */
    if (e.code === 'Space') {
      e.preventDefault();          // NEVER let space scroll the page
      if (spaceHeld) return;       // already down
      spaceHeld = true;
      /* Activate grab cursor on whatever zoomed box cursor is over */
      if (hoveredBox && hoveredBox._zoomState && hoveredBox._zoomState.s > 1.02) {
        hoveredBox.style.cursor = 'grab';
        spacePanBox = hoveredBox;
      }
      return;
    }

    /* ── W / S ── */
    if (e.repeat) return;
    if (isTypingTarget()) return;
    const key = e.key.toLowerCase();
    if (key !== 'w' && key !== 's') return;
    e.preventDefault();
    heldKeys[key] = true;
    startScroll(key === 's' ? 1 : -1);
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      spaceHeld = false;
      /* Release pan mode */
      if (spacePanBox) {
        /* Restore cursor based on zoom state */
        if (spacePanBox._zoomState) {
          spacePanBox.style.cursor =
            spacePanBox._zoomState.s > 1.02 ? 'grab' : 'zoom-in';
        }
        spacePanBox = null;
      }
      spaceDragging = false;
      return;
    }
    const key = e.key.toLowerCase();
    delete heldKeys[key];
    if (!heldKeys['w'] && !heldKeys['s']) stopScroll();
  });

  /* Space + mousedown on a zoomed box starts space-pan drag */
  document.addEventListener('mousedown', function (e) {
    if (!spaceHeld || e.button !== 0) return;
    if (!spacePanBox || !spacePanBox._zoomState) return;
    const zs = spacePanBox._zoomState;
    if (zs.s <= 1.02) return;        // not zoomed — nothing to pan

    e.preventDefault();
    spaceDragging  = true;
    spaceStartX    = e.clientX;
    spaceStartY    = e.clientY;
    spaceTx0       = zs.tx;
    spaceTy0       = zs.ty;
    spacePanBox.style.cursor = 'grabbing';
  }, true);    /* capture so it fires before card's own mousedown */

  document.addEventListener('mousemove', function (e) {
    if (!spaceDragging || !spacePanBox || !spacePanBox._zoomState) return;
    const zs  = spacePanBox._zoomState;
    const dx  = e.clientX - spaceStartX;
    const dy  = e.clientY - spaceStartY;

    /* Re-use the same clampTranslate logic — stored on the box */
    const clamped = spacePanBox._clamp(zs.s, spaceTx0 + dx, spaceTy0 + dy);
    zs.tx = clamped.tx;
    zs.ty = clamped.ty;

    const img = spacePanBox.querySelector('.card-img');
    if (img) {
      img.style.transition = 'none';
      img.style.transform  =
        'translate(' + zs.tx.toFixed(2) + 'px,' + zs.ty.toFixed(2) + 'px)' +
        ' scale(' + zs.s.toFixed(4) + ')';
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (!spaceDragging) return;
    spaceDragging = false;
    if (spacePanBox && spaceHeld) {
      spacePanBox.style.cursor = 'grab';
    }
  });

  window.addEventListener('blur', function () {
    stopScroll();
    spaceHeld     = false;
    spaceDragging = false;
    if (spacePanBox) {
      if (spacePanBox._zoomState) {
        spacePanBox.style.cursor =
          spacePanBox._zoomState.s > 1.02 ? 'grab' : 'zoom-in';
      }
      spacePanBox = null;
    }
  });

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
