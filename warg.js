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
    bar.classList.toggle('on', sentinel.getBoundingClientRect().top < 0);
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

/* ---- hero sequence driver ----------------------------------------------
   Progress comes from the pinned section's own rect, sampled inside a rAF
   loop that only runs while the section is on screen. No scroll listener,
   no layout properties animated, and it latches at the end so the sequence
   never plays backwards. Skipped entirely when .js-anim is absent. */
(function(){
  if(!document.documentElement.classList.contains('js-anim')) return;
  var seq   = document.querySelector('.hero-seq');
  var stage = document.querySelector('.hero-stage');
  if(!seq || !stage) return;
  var vid = stage.querySelector('video');
  var latched = false, ticking = false;
  function c01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }

  function apply(p){
    stage.style.setProperty('--cam-scale', (1 + p * 5).toFixed(3));
    stage.style.setProperty('--cam-op',  (1 - c01((p - 0.30) / 0.32)).toFixed(3));
    stage.style.setProperty('--feed-op', c01((p - 0.26) / 0.34).toFixed(3));
    stage.style.setProperty('--hud-op',  c01((p - 0.66) / 0.20).toFixed(3));
    if(vid && p > 0.26 && vid.paused){ var q = vid.play(); if(q && q.catch) q.catch(function(){}); }
  }

  function frame(){
    if(!ticking) return;
    var dist = seq.offsetHeight - stage.offsetHeight;
    var p = dist > 0 ? c01(-seq.getBoundingClientRect().top / dist) : 1;
    if(latched){ p = 1; }
    else if(p >= 0.995){ latched = true; p = 1; }
    apply(p);
    if(latched){ ticking = false; return; }
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting && !latched && !ticking){ ticking = true; requestAnimationFrame(frame); }
      else if(!e.isIntersecting){ ticking = false; }
    });
  }, { threshold:0 }).observe(seq);

  apply(0);
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

/* ---- feature carousel -------------------------------------------------
   The rail is a real scroll container, so trackpad and touch drag work
   without any of this. The arrows and dots drive scrollLeft; the active
   dot is read back off scroll position rather than tracked in a variable,
   so a manual drag stays in sync. */
(function(){
  var track = document.getElementById('feat-track');
  if(!track) return;
  var cards = Array.prototype.slice.call(track.querySelectorAll('.car-card'));
  var ui    = document.querySelector('.car-ui');
  var dotBox= document.querySelector('.car-dots');
  var arrs  = Array.prototype.slice.call(document.querySelectorAll('.car-arr'));
  if(!cards.length || !ui || !dotBox) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  ui.hidden = false;

  function originOf(i){ return cards[i].offsetLeft - cards[0].offsetLeft; }
  function maxScroll(){ return track.scrollWidth - track.clientWidth; }

  /* How many cards fit depends on the viewport, so the reachable scroll
     positions are not one per card. Near the right-hand end several cards
     share the same clamped position: those are one page, not three, and
     the dots have to say so or they promise moves that cannot happen. */
  var pages = [];
  function measure(){
    var ms = maxScroll(), seen = {}, out = [];
    for(var i = 0; i < cards.length; i++){
      var pos = Math.min(originOf(i), ms), key = Math.round(pos);
      if(!(key in seen)){ seen[key] = true; out.push({ pos: pos, card: i }); }
    }
    pages = out;
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
        ? 'Features ' + (p.card + 1) + ' to ' + last
        : 'Feature ' + (p.card + 1));
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

  /* While a smooth scroll is in flight the live position is a poor answer to
     "which page are we on": a second arrow click would read a half-finished
     position and lose the move. pending holds the destination until we land. */
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

  function sync(){
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
})();

/* ---- detail popups ----------------------------------------------------
   Opens on hover after a short dwell on a pointer that can actually hover,
   and on click, Enter or Space anywhere. A hover-opened popup closes itself
   when the pointer leaves both the trigger and the panel; a click-opened one
   stays until it is dismissed and takes focus, so a keyboard user can read it.
   Escape and the scrim always close. */
(function(){
  var scrim = document.querySelector('.pop-scrim');
  var triggers = Array.prototype.slice.call(document.querySelectorAll('.car-more'));
  if(!scrim || !triggers.length) return;
  var canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var openPop = null, openTrig = null, byHover = false, inT = false, inP = false;
  var openTimer = null, closeTimer = null;

  function close(){
    if(!openPop) return;
    var p = openPop, t = openTrig;
    p.classList.remove('on'); scrim.classList.remove('on');
    openPop = null; openTrig = null; byHover = false;
    t.setAttribute('aria-expanded','false');
    setTimeout(function(){
      if(openPop) return;             /* something re-opened meanwhile */
      p.hidden = true; scrim.hidden = true;
    }, 240);
  }
  function open(trig, hover){
    var p = document.getElementById(trig.getAttribute('aria-controls'));
    if(!p) return;
    if(openPop && openPop !== p) close();
    byHover = !!hover;
    openPop = p; openTrig = trig;
    scrim.hidden = false; p.hidden = false;
    void p.offsetWidth;                /* let the hidden -> shown frame land */
    scrim.classList.add('on'); p.classList.add('on');
    trig.setAttribute('aria-expanded','true');
    if(!hover){
      var x = p.querySelector('.pop-x');
      if(x) x.focus();
    }
  }
  function maybeCloseHover(){
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function(){
      if(byHover && !inT && !inP) close();
    }, 180);
  }

  triggers.forEach(function(trig){
    var p = document.getElementById(trig.getAttribute('aria-controls'));

    trig.addEventListener('click', function(e){
      e.preventDefault();
      clearTimeout(openTimer);
      if(openPop === p && !byHover){ close(); return; }
      open(trig, false);
    });

    if(canHover){
      trig.addEventListener('mouseenter', function(){
        inT = true; clearTimeout(closeTimer);
        if(openPop === p) return;
        openTimer = setTimeout(function(){ open(trig, true); }, 420);
      });
      trig.addEventListener('mouseleave', function(){
        inT = false; clearTimeout(openTimer); maybeCloseHover();
      });
      if(p){
        p.addEventListener('mouseenter', function(){ inP = true; clearTimeout(closeTimer); });
        p.addEventListener('mouseleave', function(){ inP = false; maybeCloseHover(); });
      }
    }

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

/* ---- contact and support forms ---------------------------------------
   There is no server yet. Rather than a Send button that silently does
   nothing, the form validates, then hands the message to the visitor's own
   mail client pre-filled. That is a stopgap, and it is labelled as one on
   the page; when an endpoint exists, give the form an action and a method
   and delete the submit handler below. The markup already carries the
   names a backend would expect. */
(function(){
  var forms = document.querySelectorAll('#contact-form, #support-form');
  if(!forms.length) return;

  var TO = { 'contact-form':'hello@wargrobotics.com', 'support-form':'support@wargrobotics.com' };
  var SUBJ = { 'contact-form':'Website enquiry', 'support-form':'Service request' };

  /* Show only the follow-up questions that belong to the chosen intent, and
     take the hidden ones out of validation so a hidden required field can
     never block a submit the visitor cannot see a reason for. */
  function syncIntent(form){
    var chosen = form.querySelector('input[name="intent"]:checked');
    form.querySelectorAll('.extra').forEach(function(box){
      var on = !!chosen && box.getAttribute('data-intent') === chosen.value;
      box.hidden = !on;
      box.querySelectorAll('input, select, textarea').forEach(function(el){ el.disabled = !on; });
    });
  }

  function labelFor(el){
    /* The intent radios are labelled by the card they sit inside, not by a
       <label for>, so read the visible name rather than falling back to the
       field's own value slug. Trailing punctuation is dropped so the composed
       line reads "What do you need: ..." and not "What do you need?: ...". */
    if(el.type === 'radio'){
      var box = el.parentNode.querySelector('.intent-name');
      if(box) return box.textContent.trim();
    }
    var l = el.id && el.form && el.form.querySelector('label[for="' + el.id + '"]');
    var t = l ? l.textContent.trim() : (el.name || el.id);
    return t.replace(/[?:]+$/, '');
  }

  function validate(form){
    var bad = null;
    form.querySelectorAll('input, select, textarea').forEach(function(el){
      if(el.disabled || el.type === 'file'){ return; }
      var ok = el.checkValidity();
      el.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if(!ok && !bad) bad = el;
    });
    return bad;
  }

  function compose(form){
    var lines = [];
    form.querySelectorAll('input, select, textarea').forEach(function(el){
      if(el.disabled || !el.name) return;
      if(el.type === 'radio'){
        if(!el.checked) return;
        lines.push('Enquiry type: ' + labelFor(el));
        return;
      }
      if(el.type === 'file'){
        var names = Array.prototype.map.call(el.files || [], function(f){ return f.name; });
        if(names.length) lines.push('Photographs to attach: ' + names.join(', '));
        return;
      }
      var v = (el.value || '').trim();
      if(v) lines.push(labelFor(el) + ': ' + v);
    });
    return lines.join('\n');
  }

  forms.forEach(function(form){
    syncIntent(form);
    form.addEventListener('change', function(e){
      if(e.target.name === 'intent') syncIntent(form);
      if(e.target.type === 'file'){
        var list = form.querySelector('#filelist');
        if(!list) return;
        list.innerHTML = '';
        Array.prototype.slice.call(e.target.files || []).slice(0, 6).forEach(function(f){
          var li = document.createElement('li');
          li.textContent = f.name;
          list.appendChild(li);
        });
      }
      if(e.target.matches('input, select, textarea') && e.target.getAttribute('aria-invalid') === 'true'){
        e.target.setAttribute('aria-invalid', String(!e.target.checkValidity()));
      }
    });

    form.addEventListener('submit', function(e){
      e.preventDefault();
      var status = form.querySelector('.form-status');
      var bad = validate(form);
      if(bad){
        status.className = 'form-status bad';
        status.textContent = 'Check ' + labelFor(bad).toLowerCase() + ' and try again.';
        bad.focus();
        return;
      }
      var body = compose(form);
      var hasFiles = !!form.querySelector('input[type="file"] input, input[type="file"]') &&
                     (form.querySelector('input[type="file"]') || {}).files &&
                     form.querySelector('input[type="file"]').files.length;
      if(hasFiles){
        body += '\n\n(Attach the photographs listed above to this email before sending.)';
      }
      window.location.href = 'mailto:' + TO[form.id] +
        '?subject=' + encodeURIComponent(SUBJ[form.id]) +
        '&body=' + encodeURIComponent(body);
      status.className = 'form-status ok';
      status.textContent = hasFiles
        ? 'Your mail client should open with this filled in. Attach the photographs, then send.'
        : 'Your mail client should open with this filled in. Press send there and we have it.';
    });
  });
})();
