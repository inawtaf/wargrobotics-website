/* Marks the document as scripted. Deliberately outside the reduced-motion
   guard below: some behaviour (the sticky product bar) is a state change that
   must still apply when animation is switched off. */
document.documentElement.classList.add('js');

/* ---- sticky product bar ----------------------------------------------
   Shown only once the masthead has scrolled away.

   This one reads scroll position rather than using IntersectionObserver.
   Two entry cases defeated the observer: a 1px sentinel is non-intersecting
   both above and below the viewport, so an instant jump past it crosses no
   threshold and the callback never runs; and a page opened on a hash is
   scrolled by the browser at a moment that is not reliably before `load`,
   so a one-shot check at startup can read a position that is already stale.
   A passive listener throttled to one rAF is cheap and is correct whatever
   scroll position the page arrives at. */
(function(){
  var bar = document.querySelector('.subnav');
  var sentinel = document.querySelector('.subnav-sentinel');
  if(!bar || !sentinel) return;
  var queued = false;

  function evaluate(){
    queued = false;
    /* Trigger a nav-height early. The masthead nav is sticky through the hero
       and unpins right at this boundary, so firing at exactly 0 leaves a short
       stretch with no header on screen; this hands over instead. */
    bar.classList.toggle('on', sentinel.getBoundingClientRect().top < 72);
  }
  function schedule(){
    if(queued) return;
    queued = true;
    requestAnimationFrame(evaluate);
  }

  window.addEventListener('scroll', schedule, { passive:true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  schedule();
})();

/* Reveal on scroll. IntersectionObserver only: no scroll listeners, no rAF
   loops, no layout properties animated. Skipped entirely under reduced
   motion so the resting page is the finished page. */
(function(){
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce || !('IntersectionObserver' in window)) return;
  root.classList.add('js-anim');

  var STEP = 70;
  document.querySelectorAll('[data-stagger]').forEach(function(group){
    Array.prototype.forEach.call(group.children, function(child, i){
      child.classList.add('reveal');
      child.style.setProperty('--d', (i * STEP) + 'ms');
    });
  });
  document.querySelectorAll('[data-reveal]').forEach(function(el){ el.classList.add('reveal'); });

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      var t = e.target;
      if(t.hasAttribute('data-stagger')){
        Array.prototype.forEach.call(t.children, function(c){ c.classList.add('in'); });
      } else {
        t.classList.add('in');
      }
      io.unobserve(t);
    });
  }, { threshold:0.12, rootMargin:'0px 0px -6% 0px' });

  document.querySelectorAll('[data-stagger],[data-reveal]').forEach(function(el){ io.observe(el); });

  /* Safety net. The hidden state only exists so the reveal has somewhere to
     animate from, but IntersectionObserver samples at frame boundaries: a fast
     scroll (a scrollbar drag, End, a background tab catching up) can carry an
     element from below the fold to above it without ever producing an
     intersection, and it would then stay at opacity 0 for good. Anything that
     has gone fully past the top of the viewport is shown unconditionally, so
     no content can be permanently invisible. */
  function sweep(){
    var pending = document.querySelectorAll('.reveal:not(.in)');
    for(var i = 0; i < pending.length; i++){
      if(pending[i].getBoundingClientRect().bottom < 0) pending[i].classList.add('in');
    }
  }
  /* setTimeout, not rAF and not a leading-edge throttle. rAF is suspended in a
     backgrounded document, and a leading-edge throttle drops the call that
     matters: the one after the last scroll event of a fast burst, which is the
     moment the skipped elements are finally past the top. This always fires
     once the burst settles. */
  var timer = null;
  window.addEventListener('scroll', function(){
    if(timer) return;
    timer = setTimeout(function(){ timer = null; sweep(); }, 120);
  }, { passive:true });
  document.addEventListener('visibilitychange', sweep);
  window.addEventListener('load', sweep);
})();

/* ---- hero footage ------------------------------------------------------
   The scroll-driven reveal has gone, so the clip just plays behind the copy.
   Started from script rather than the autoplay attribute so that a visitor on
   prefers-reduced-motion gets the poster frame held still instead. */
(function(){
  var vid = document.querySelector('.hero-feed video');
  if(!vid) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var q = vid.play();
  if(q && q.catch) q.catch(function(){});
})();

(function(){
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.dep-tab'));
  if(!tabs.length) return;
  function select(i, focus){
    tabs.forEach(function(t, n){
      var on = n === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      if(on){
        panel.classList.remove('swap');
        void panel.offsetWidth;          /* restart the animation */
        panel.classList.add('swap');
      }
    });
    if(focus) tabs[i].focus();
  }
  tabs.forEach(function(t, i){
    t.addEventListener('click', function(){ select(i); });
    t.addEventListener('keydown', function(e){
      var k = e.key, n = null;
      if(k === 'ArrowDown' || k === 'ArrowRight') n = (i + 1) % tabs.length;
      else if(k === 'ArrowUp' || k === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      else if(k === 'Home') n = 0;
      else if(k === 'End') n = tabs.length - 1;
      if(n !== null){ e.preventDefault(); select(n, true); }
    });
  });
})();

/* ---- product card variants -------------------------------------------
   Two faces per card: the unit, and the same unit with the compute module on
   top of it. Scoped per .var so any number of cards can sit on one page, and
   reused by the Pro tab on the product pages. */
(function(){
  var groups = Array.prototype.slice.call(document.querySelectorAll('.var'));
  if(!groups.length) return;
  groups.forEach(function(group){
    var tabs = Array.prototype.slice.call(group.querySelectorAll('.var-tab'));
    if(tabs.length < 2) return;

    function select(i, focus){
      tabs.forEach(function(t, n){
        var on = n === i;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if(panel) panel.hidden = !on;
      });
      if(focus) tabs[i].focus();
    }

    tabs.forEach(function(t, i){
      t.addEventListener('click', function(){ select(i); });
      t.addEventListener('keydown', function(e){
        var k = e.key, n = null;
        if(k === 'ArrowRight' || k === 'ArrowDown') n = (i + 1) % tabs.length;
        else if(k === 'ArrowLeft' || k === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
        else if(k === 'Home') n = 0;
        else if(k === 'End') n = tabs.length - 1;
        if(n !== null){ e.preventDefault(); select(n, true); }
      });
    });

    /* ghost.html?variant=pro opens straight onto the Pro face. A query rather
       than a hash on purpose: #pro would also make the browser jump to the Pro
       section near the foot of the page, and the link must land at the top.
       Not ?v= — that key is the cache-bust convention on this site. */
    if(/[?&]variant=pro(&|$)/.test(location.search)){
      var pro = -1;
      tabs.forEach(function(t, i){ if(/-pro$/.test(t.id)) pro = i; });
      if(pro > 0) select(pro);
    }
  });
})();

/* ---- carousels -------------------------------------------------------
   Scoped per .car so more than one can live on a page. The rail is a real
   scroll container, so trackpad and touch drag work without any of this;
   the arrows and dots are the keyboard and pointer affordance on top. */
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(document.querySelectorAll('.car'), function(car){
    var track  = car.querySelector('.car-track');
    var ui     = car.querySelector('.car-ui');
    var dotBox = car.querySelector('.car-dots');
    var arrs   = Array.prototype.slice.call(car.querySelectorAll('.car-arr'));
    if(!track || !ui || !dotBox) return;
    var cards = Array.prototype.slice.call(track.querySelectorAll('.car-card'));
    if(!cards.length) return;

    function originOf(i){ return cards[i].offsetLeft - cards[0].offsetLeft; }
    function maxScroll(){ return track.scrollWidth - track.clientWidth; }

    /* How many cards fit depends on the viewport, so the reachable scroll
       positions are not one per card. Near the right-hand end several cards
       share the same clamped position: those are one page, not three. */
    var pages = [];
    function measure(){
      var ms = maxScroll(), seen = {}, out = [];
      for(var i = 0; i < cards.length; i++){
        var pos = Math.min(originOf(i), ms), key = Math.round(pos);
        if(!(key in seen)){ seen[key] = true; out.push({ pos: pos, card: i }); }
      }
      pages = out;
      /* Nothing to page through when everything already fits. */
      ui.hidden = pages.length < 2;
      buildDots();
    }

    function buildDots(){
      if(dotBox.children.length === pages.length) return;
      dotBox.innerHTML = '';
      pages.forEach(function(p, n){
        var last = n === pages.length - 1 ? cards.length : pages[n + 1].card;
        var span = last - p.card;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'car-dot';
        b.setAttribute('aria-label', span > 1
          ? 'Items ' + (p.card + 1) + ' to ' + last
          : 'Item ' + (p.card + 1));
        b.addEventListener('click', function(){ to(n); });
        dotBox.appendChild(b);
      });
    }

    function nearest(){
      var best = 0, bd = Infinity;
      for(var i = 0; i < pages.length; i++){
        var d = Math.abs(pages[i].pos - track.scrollLeft);
        if(d < bd){ bd = d; best = i; }
      }
      return best;
    }

    /* While a smooth scroll is in flight the live position is a poor answer
       to "which page are we on": a second arrow click would read a
       half-finished position and lose the move. */
    var pending = null;
    function current(){ return pending !== null ? pending : nearest(); }

    function to(n){
      n = Math.max(0, Math.min(pages.length - 1, n));
      pending = n;
      track.scrollTo({ left: pages[n].pos, behavior: reduce ? 'auto' : 'smooth' });
      paint(n);
    }

    function paint(n){
      Array.prototype.forEach.call(dotBox.children, function(d, i){
        d.setAttribute('aria-current', String(i === n));
      });
      arrs.forEach(function(a){
        a.disabled = Number(a.getAttribute('data-dir')) < 0 ? n <= 0 : n >= pages.length - 1;
      });
    }

    /* Fade only the side that still has cards behind it, so the first card
       is crisp at rest and the rail softens as soon as it has somewhere to
       go. Driven from scroll position rather than always-on, which would
       grey the leading card for no reason. */
    function edges(){
      var ms = maxScroll(), f = [];
      if(ms > 1){
        if(track.scrollLeft > 2) f.push('start');
        if(track.scrollLeft < ms - 2) f.push('end');
      }
      track.setAttribute('data-fade', f.join(' '));
    }

    function sync(){
      edges();
      if(!pages.length) return;
      if(pending !== null){
        if(Math.abs(track.scrollLeft - pages[Math.min(pending, pages.length - 1)].pos) < 3) pending = null;
        else { paint(pending); return; }
      }
      paint(nearest());
    }

    arrs.forEach(function(a){
      a.addEventListener('click', function(){ to(current() + Number(a.getAttribute('data-dir'))); });
    });

    var raf = null;
    track.addEventListener('scroll', function(){
      if(raf) return;
      raf = requestAnimationFrame(function(){ raf = null; sync(); });
    }, { passive:true });
    window.addEventListener('resize', function(){ pending = null; measure(); sync(); });

    measure(); sync();
  });
})();

/* ---- detail popups ----------------------------------------------------
   Click, tap, Enter or Space. There used to be a hover-after-dwell path as
   well; it was removed on the client's instruction, so the panel now only
   ever opens deliberately. It takes focus when it opens, and Escape or the
   scrim closes it and hands focus back to the trigger. */
(function(){
  var scrim = document.querySelector('.pop-scrim');
  var triggers = Array.prototype.slice.call(document.querySelectorAll('.car-more'));
  if(!scrim || !triggers.length) return;
  var openPop = null, openTrig = null;

  function close(){
    if(!openPop) return;
    var p = openPop, t = openTrig;
    p.classList.remove('on'); scrim.classList.remove('on');
    openPop = null; openTrig = null;
    t.setAttribute('aria-expanded','false');
    setTimeout(function(){
      if(openPop) return;             /* something re-opened meanwhile */
      p.hidden = true; scrim.hidden = true;
    }, 240);
  }
  function open(trig){
    var p = document.getElementById(trig.getAttribute('aria-controls'));
    if(!p) return;
    if(openPop && openPop !== p) close();
    openPop = p; openTrig = trig;
    scrim.hidden = false; p.hidden = false;
    void p.offsetWidth;                /* let the hidden -> shown frame land */
    scrim.classList.add('on'); p.classList.add('on');
    trig.setAttribute('aria-expanded','true');
    var x = p.querySelector('.pop-x');
    if(x) x.focus();
  }

  triggers.forEach(function(trig){
    var p = document.getElementById(trig.getAttribute('aria-controls'));

    trig.addEventListener('click', function(e){
      e.preventDefault();
      if(openPop === p){ close(); return; }
      open(trig);
    });

    if(p){
      var x = p.querySelector('.pop-x');
      if(x) x.addEventListener('click', function(){ close(); trig.focus(); });
    }
  });

  scrim.addEventListener('click', function(){ close(); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && openPop){ var t = openTrig; close(); if(t) t.focus(); }
  });
})();

/* ---- contact, support and pre-book forms -------------------------------
   Submissions go to a Google Apps Script web app, which writes each form to
   its own tab in a Google Sheet, saves support photographs to Google Drive
   and emails the team. Paste the web app URL (ends in /exec) below.

   Until FORM_ENDPOINT is set, or if the endpoint cannot be reached, the form
   falls back to the old behaviour: it opens the visitor's own mail client
   pre-filled, so a message is never lost.

   Sent as text/plain on purpose: Apps Script cannot answer a CORS preflight,
   and a text/plain POST does not trigger one. */
(function(){
  var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw32OyarrwQE1YGUQs6qitwD0eypmHNUrYtsIV2gZzdUFOaZk5yRKidfTd_7XQd0wCWkA/exec';

  var forms = document.querySelectorAll('#contact-form, #support-form, #prebook-form');
  if(!forms.length) return;

  var TO = { 'contact-form':'hello@wargrobotics.com', 'support-form':'support@wargrobotics.com', 'prebook-form':'hello@wargrobotics.com' };
  var SUBJ = { 'contact-form':'Website enquiry', 'support-form':'Service request', 'prebook-form':'Pre-booking' };
  var SUCCESS = {
    'contact-form':'Thanks, we have your message and will reply by email.',
    'support-form':'Your case is open. We will be in touch by email.',
    'prebook-form':'You are on the pre-booking list. No payment is taken; we will email you before anything ships.'
  };
  var MAX_FILES = 6, MAX_EDGE = 1600, MAX_RAW_BYTES = 5 * 1024 * 1024;
  var HONEYPOT = 'hp_trap';

  var endpointReady = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(FORM_ENDPOINT);

  /* Show only the follow-up questions that belong to the chosen intent, and
     take the hidden ones out of validation so a hidden required field can
     never block a submit the visitor cannot see a reason for. */
  function syncIntent(form){
    var chosen = form.querySelector('input[name="intent"]:checked');
    /* Only the intent-driven boxes. The Pro add-on uses .extra[data-addon] and is
       driven by its own block below. */
    form.querySelectorAll('.extra[data-intent]').forEach(function(box){
      var on = !!chosen && box.getAttribute('data-intent') === chosen.value;
      box.hidden = !on;
      box.querySelectorAll('input, select, textarea').forEach(function(el){ el.disabled = !on; });
    });
  }

  function clean(t){ return (t || '').replace(/\s+/g, ' ').trim().replace(/[?:]+$/, ''); }

  /* Column name in the sheet and line label in the fallback email. */
  function labelFor(el){
    if(el.getAttribute('data-label')) return el.getAttribute('data-label');
    if(el.type === 'radio'){
      var fs = el.closest('fieldset');
      var lg = fs && fs.querySelector('legend');
      if(lg) return clean(lg.textContent);
    }
    var l = el.id && el.form && el.form.querySelector('label[for="' + el.id + '"]');
    return l ? clean(l.textContent) : (el.name || el.id);
  }

  /* Visible name of a chosen radio card, not its value slug. */
  function radioValue(el){
    var box = el.parentNode.querySelector('.intent-name');
    return box ? box.textContent.trim() : el.value;
  }

  function isHoneypot(el){ return el.name === HONEYPOT; }

  function validate(form){
    var bad = null;
    form.querySelectorAll('input, select, textarea').forEach(function(el){
      if(el.disabled || el.type === 'file' || isHoneypot(el)){ return; }
      var ok = el.checkValidity();
      el.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if(!ok && !bad) bad = el;
    });
    return bad;
  }

  /* Ordered [label, value] pairs; order becomes column order in the sheet. */
  function collectFields(form){
    var out = [];
    form.querySelectorAll('input, select, textarea').forEach(function(el){
      if(el.disabled || !el.name || el.type === 'file' || isHoneypot(el)) return;
      if(el.type === 'radio'){
        if(el.checked) out.push([labelFor(el), radioValue(el)]);
        return;
      }
      if(el.type === 'checkbox'){
        out.push([labelFor(el), el.checked ? 'Yes' : 'No']);
        return;
      }
      out.push([labelFor(el), (el.value || '').trim()]);
    });
    return out;
  }

  function fileInput(form){ return form.querySelector('input[type="file"]'); }
  function chosenFiles(form){
    var fi = fileInput(form);
    return fi && fi.files ? Array.prototype.slice.call(fi.files, 0, MAX_FILES) : [];
  }

  function compose(form){
    var lines = collectFields(form).filter(function(p){ return p[1]; })
      .map(function(p){ return p[0] + ': ' + p[1]; });
    var names = chosenFiles(form).map(function(f){ return f.name; });
    if(names.length) lines.push('Photographs to attach: ' + names.join(', '));
    return lines.join('\n');
  }

  function mailtoHref(form){
    var body = compose(form);
    if(chosenFiles(form).length) body += '\n\n(Attach the photographs listed above to this email before sending.)';
    return 'mailto:' + TO[form.id] + '?subject=' + encodeURIComponent(SUBJ[form.id]) +
           '&body=' + encodeURIComponent(body);
  }

  function readAsBase64(blob){
    return new Promise(function(resolve, reject){
      var r = new FileReader();
      r.onload = function(){ resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function(){ reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  /* Phone photos are often 5-10 MB. Scale to MAX_EDGE on the long side and
     re-encode as JPEG so six of them upload quickly on mobile data. If the
     browser cannot decode the format (HEIC on some desktops), send the
     original as long as it is not huge. */
  function prepareImage(file){
    return new Promise(function(resolve){
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function(){
        var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function(blob){
          if(!blob) return resolve(raw());
          readAsBase64(blob).then(function(data){
            resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: data });
          }, function(){ resolve(raw()); });
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); resolve(raw()); };
      img.src = url;

      function raw(){
        if(file.size > MAX_RAW_BYTES) return null;
        return readAsBase64(file).then(function(data){
          return { name: file.name, type: file.type || 'application/octet-stream', data: data };
        }, function(){ return null; });
      }
    });
  }

  function send(form){
    var files = chosenFiles(form);
    return Promise.all(files.map(prepareImage)).then(function(prepared){
      var hp = form.querySelector('[name="' + HONEYPOT + '"]');
      var payload = {
        form: form.id,
        page: location.pathname,
        fields: collectFields(form),
        files: prepared.filter(Boolean),
        skippedFiles: prepared.filter(function(p){ return !p; }).length,
        hp: hp ? hp.value : ''
      };
      return fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
    }).then(function(res){
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(data){
      if(!data || !data.ok) throw new Error((data && data.error) || 'Rejected');
      return data;
    });
  }

  function setStatus(form, cls, text, href){
    var status = form.querySelector('.form-status');
    status.className = 'form-status ' + cls;
    status.textContent = text;
    if(href){
      status.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = href;
      a.textContent = 'Email it to us instead';
      status.appendChild(a);
      status.appendChild(document.createTextNode('.'));
    }
  }

  function resetForm(form){
    form.reset();
    syncIntent(form);
    var pro = form.querySelector('#addon-pro');
    if(pro) pro.dispatchEvent(new Event('change', { bubbles: true }));
    var list = form.querySelector('#filelist');
    if(list) list.innerHTML = '';
    form.querySelectorAll('[aria-invalid]').forEach(function(el){ el.removeAttribute('aria-invalid'); });
  }

  forms.forEach(function(form){
    syncIntent(form);
    form.addEventListener('change', function(e){
      if(e.target.name === 'intent') syncIntent(form);
      if(e.target.type === 'file'){
        var list = form.querySelector('#filelist');
        if(!list) return;
        list.innerHTML = '';
        Array.prototype.slice.call(e.target.files || []).slice(0, MAX_FILES).forEach(function(f){
          var li = document.createElement('li');
          li.textContent = f.name;
          list.appendChild(li);
        });
        if((e.target.files || []).length > MAX_FILES){
          var more = document.createElement('li');
          more.textContent = 'Only the first ' + MAX_FILES + ' will be sent';
          list.appendChild(more);
        }
      }
      if(e.target.matches('input, select, textarea') && e.target.getAttribute('aria-invalid') === 'true'){
        e.target.setAttribute('aria-invalid', String(!e.target.checkValidity()));
      }
    });

    var busy = false;
    form.addEventListener('submit', function(e){
      e.preventDefault();
      if(busy) return;
      var bad = validate(form);
      if(bad){
        setStatus(form, 'bad', 'Check ' + labelFor(bad).toLowerCase() + ' and try again.');
        bad.focus();
        return;
      }

      if(!endpointReady){
        var hasFiles = chosenFiles(form).length > 0;
        window.location.href = mailtoHref(form);
        setStatus(form, 'ok', hasFiles
          ? 'Your mail client should open with this filled in. Attach the photographs, then send.'
          : 'Your mail client should open with this filled in. Press send there and we have it.');
        return;
      }

      var btn = form.querySelector('button[type="submit"]');
      var btnText = btn ? btn.textContent : '';
      busy = true;
      if(btn){ btn.disabled = true; btn.textContent = 'Sending\u2026'; }
      setStatus(form, 'ok', chosenFiles(form).length ? 'Uploading your photographs\u2026' : 'Sending\u2026');

      send(form).then(function(data){
        if(window.wargTrack) wargTrack('generate_lead', { form_id: form.id });
        var msg = SUCCESS[form.id] || 'Sent. Thank you.';
        if(data.ref) msg += ' Your reference is ' + data.ref + '.';
        resetForm(form);
        setStatus(form, 'ok', msg);
      }).catch(function(err){
        if(window.console) console.error('Form submit failed:', err);
        setStatus(form, 'bad', 'That did not go through. Nothing you typed is lost \u2014 try again in a moment, or', mailtoHref(form));
      }).then(function(){
        busy = false;
        if(btn){ btn.disabled = false; btn.textContent = btnText; }
      });
    });
  });
})();

/* ---- pre-book: Pro add-on, and the unit preselected from the link -------
   Same show/hide-plus-disable contract the intent boxes use, so a hidden
   configuration field never reaches validation or the composed message. */
(function(){
  var form = document.getElementById('prebook-form');
  if(!form) return;

  /* ghost.html and greywind.html link here as prebook.html?unit=greywind */
  var want = (new URLSearchParams(location.search).get('unit') || '').toLowerCase();
  if(want){
    var radio = form.querySelector('input[name="unit"][value="' + CSS.escape(want.charAt(0).toUpperCase() + want.slice(1)) + '"]');
    if(radio) radio.checked = true;
  }

  var toggle = form.querySelector('#addon-pro');
  var box = form.querySelector('.extra[data-addon="pro"]');
  if(!toggle || !box) return;

  function sync(){
    box.hidden = !toggle.checked;
    box.querySelectorAll('input, select, textarea').forEach(function(el){
      el.disabled = !toggle.checked;
    });
  }
  sync();
  toggle.addEventListener('change', sync);
})();
