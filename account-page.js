/* Account area (account.html) and order page (order.html). */
(function () {
  var api = window.WargApi, F = window.WargForm, inr = window.inr;
  var q = new URLSearchParams(location.search);
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function date(s) { return s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  var STATUS = { created: 'Awaiting payment', paid: 'Paid', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded',
    open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
  var KIND = { repair: 'Repair', warranty: 'Warranty claim', return: 'Return', setup: 'Setup help', other: 'Other' };
  function pill(status) { return el('span', 'pill ' + status, STATUS[status] || status); }

  // ---------------------------------------------------------------- one order (shared)
  function renderOrder(box, o, opts) {
    opts = opts || {};
    box.innerHTML = '';
    var steps = el('ol', 'order-steps');
    var reached = ['paid', 'processing', 'shipped', 'delivered'].indexOf(o.status);
    ['Paid', 'Processing', 'Shipped', 'Delivered'].forEach(function (s, i) { var li = el('li', i <= reached ? 'done' : '', s); steps.appendChild(li); });
    if (o.status === 'cancelled') steps = el('p', 'banner', 'This order was cancelled' + (o.cancel_reason ? ': ' + o.cancel_reason : '.') + ' A full refund goes back to the account you paid from.');

    var wrap = el('div', 'checkout');
    var left = el('div');
    left.appendChild(steps);
    if (o.tracking_number) {
      var t = el('div', 'order-ship');
      t.appendChild(el('h2', 'field-legend', 'Tracking'));
      t.appendChild(el('p', '', o.courier + ' · ' + o.tracking_number));
      if (o.expected_delivery && o.status === 'shipped') t.appendChild(el('p', '', 'Expected by ' + new Date(o.expected_delivery + 'T00:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })));
      if (o.tracking_url) { var a = el('a', 'btn btn-line', 'Track your parcel'); a.href = o.tracking_url; a.target = '_blank'; a.rel = 'noopener'; t.appendChild(a); }
      left.appendChild(t);
    }
    if (o.address_line1) {
      left.appendChild(el('h2', 'field-legend', 'Delivering to'));
      left.appendChild(el('p', 't-body', [o.customer_name, o.address_line1, o.address_line2, o.city + ', ' + o.state_code + ' ' + o.pincode, o.phone].filter(Boolean).join(', ')));
      var b = o.billing;
      if (b && (!b.same || o.gstin || o.business_name)) {
        left.appendChild(el('h2', 'field-legend', 'Billed to'));
        left.appendChild(el('p', 't-body', [o.business_name, b.same ? 'Same as delivery address' : [b.name, b.address_line1, b.address_line2, b.city + ', ' + b.state_code + ' ' + b.pincode].filter(Boolean).join(', '), o.gstin && 'GSTIN ' + o.gstin].filter(Boolean).join(' · ')));
      }
    }
    var actions = el('div', 'card-actions');
    if (opts.signedIn && o.invoice_available) { var inv = el('a', 'btn btn-line', 'Download invoice ' + (o.invoice_number || '')); inv.href = '/api/account/orders/' + encodeURIComponent(o.order_number) + '/invoice'; actions.appendChild(inv); }
    if (opts.signedIn && o.status !== 'created') {
      var re = el('button', 'btn btn-line', 'Buy again'); re.type = 'button';
      re.onclick = function () { api('/account/orders/' + encodeURIComponent(o.order_number) + '/reorder', { method: 'POST' }).then(function () { location.href = '/cart'; }); };
      actions.appendChild(re);
      var sv = el('a', 'btn btn-line', 'Request service'); sv.href = '/account?order=' + encodeURIComponent(o.order_number) + '#service';
      actions.appendChild(sv);
    }
    if (!opts.signedIn) { var lg = el('a', 'btn btn-line', 'Sign in to see invoices and service'); lg.href = '/login?next=' + encodeURIComponent('/account#orders'); actions.appendChild(lg); }
    left.appendChild(actions);
    if (o.timeline && o.timeline.length) {
      left.appendChild(el('h2', 'field-legend', 'Updates'));
      var ol = el('ol', 'order-timeline');
      o.timeline.slice().reverse().forEach(function (e) {
        var li = el('li');
        li.appendChild(el('time', '', new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
        li.appendChild(el('span', '', e.message || STATUS[e.status] || ''));
        ol.appendChild(li);
      });
      left.appendChild(ol);
    }
    if (opts.service && opts.service.length) {
      left.appendChild(el('h2', 'field-legend', 'Service requests'));
      opts.service.forEach(function (s) { var p = el('p', 't-body'); p.appendChild(pill(s.status)); p.appendChild(document.createTextNode(' ' + s.request_number + ' · ' + s.subject)); left.appendChild(p); });
    }

    var aside = el('aside', 'summary');
    aside.appendChild(el('h2', 'field-legend', 'Order ' + o.order_number));
    (o.items || []).forEach(function (i) {
      aside.appendChild(el('p', 'summary-item', i.product_name + ' × ' + i.quantity));
      aside.appendChild(el('p', 'summary-offer', inr(i.subtotal_paise) + (i.price_type === 'offer' ? ' · offer price' : '')));
    });
    var dl = el('dl', 'summary-lines');
    function row(k, v, cls) { var d = el('div', cls); d.appendChild(el('dt', '', k)); d.appendChild(el('dd', '', v)); dl.appendChild(d); }
    row('Subtotal', inr(o.subtotal_paise));
    row(o.tax_kind === 'intra' ? 'CGST 9% + SGST 9%' : 'IGST 18%', inr(o.gst_paise));
    row(o.status === 'created' ? 'Total' : 'Total paid', inr(o.total_paise), 'summary-total');
    aside.appendChild(dl);
    aside.appendChild(el('p', 'hint', 'Placed ' + date(o.paid_at || o.created_at) + (o.invoice_number ? ' · invoice ' + o.invoice_number : '')));
    wrap.appendChild(left); wrap.appendChild(aside);
    box.appendChild(wrap);
  }

  // ================================================================ order.html
  if ($('order-body')) {
    var n = q.get('n'), tok = q.get('t'), tries = 0;
    var fail = function (m) { $('order-lede').textContent = m; };
    if (!n) return fail('This link is incomplete. Use the link in your order email, or open your account.');
    // Orders are private: the link in the email asks you to sign in first.
    var load = function () {
      window.WargMe().then(function (d) {
        if (!d.user) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
        return api('/account/orders/' + encodeURIComponent(n)).then(function (r) { show(r.order, true, r.service_requests); })
          .catch(function (e) {
            fail(e.status === 404
              ? 'This order is not in the account you are signed in to (' + d.user.email + '). Sign out, then sign in with the email address the order email was sent to.'
              : 'We could not load this order. Please try again.');
          });
      }).catch(function () { fail('We could not load this order. Please try again.'); });
    };
    var show = function (o, signed, service) {
      $('order-body').hidden = false;
      renderOrder($('order-body'), o, { signedIn: signed, service: service });
      var first = (o.customer_name || '').split(' ')[0];
      if (o.status === 'created') {
        $('order-h').textContent = 'Confirming your payment';
        $('order-lede').textContent = 'This usually takes a few seconds. If you were charged, your order is safe and we will email you.';
        if (tries++ < 20) setTimeout(load, 3000);
        return;
      }
      $('order-h').textContent = o.status === 'paid' ? 'Thank you, ' + first : o.status === 'processing' ? 'Being prepared' : o.status === 'shipped' ? 'On its way' : o.status === 'delivered' ? 'Delivered' : 'Order ' + STATUS[o.status].toLowerCase();
      $('order-lede').textContent = o.status === 'paid' ? 'Order ' + o.order_number + ' is confirmed. Your GST invoice is on its way by email. We email tracking when it ships.'
        : o.status === 'processing' ? 'We are testing and packing your order. Tracking follows by email when it ships.'
        : o.status === 'shipped' ? 'Delivery instructions are in your email.' : '';
    };
    load();
    return;
  }

  // ================================================================ account.html
  if (!$('acct-tabs') && !document.querySelector('.acct-tabs')) return;
  var me = null, orders = [];
  var banner = $('acct-banner');
  function note(msg, ok, action) {
    banner.hidden = !msg; banner.className = 'banner' + (ok ? ' ok' : ''); banner.textContent = msg || '';
    if (action) banner.appendChild(action);
  }

  window.WargMe().then(function (d) {
    if (!d.user) { location.href = '/login?next=' + encodeURIComponent('/account' + location.hash); return; }
    me = d.user;
    $('acct-h').textContent = 'Hello, ' + me.name.split(' ')[0];
    $('acct-lede').textContent = me.email + (me.email_verified ? ' · confirmed' : ' · not confirmed yet');
    banners();
    profile();
    loadOrders().then(loadService);
    loadAddresses();
    showTab();
  });

  function banners() {
    if (q.get('verify') === 'done') return note('Thanks, your email is confirmed. You can place orders now.', true);
    if (q.get('verify') === 'expired') note('That confirmation link has expired or was already used.');
    if (q.get('reset') === 'done') return note('Your new password is saved.', true);
    if (q.get('google') === 'linked') return note('Google sign-in is linked to your account.', true);
    if (q.get('google') === 'taken') return note('That Google account is already linked to a different Warg account.');
    if (!me.email_verified) {
      var b = el('button', 'link-btn', 'Send the link again'); b.type = 'button';
      b.onclick = function () { api('/auth/resend-verification', { method: 'POST' }).then(function () { note('Sent. Check your inbox and spam folder.', true); }).catch(function (e) { note(e.message); }); };
      note((q.get('welcome') ? 'Welcome! ' : '') + 'Confirm your email to place orders: we sent a link to ' + me.email + '.', false, b);
    }
  }

  // ---------------------------------------------------------------- tabs
  function showTab() {
    var name = (location.hash || '#orders').slice(1);
    if (!document.querySelector('[data-panel="' + name + '"]')) name = 'orders';
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (a) {
      if (a.getAttribute('data-tab') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (name === 'orders') { $('order-detail').hidden = true; $('orders-list').hidden = false; }
  }
  window.addEventListener('hashchange', showTab);

  // ---------------------------------------------------------------- orders
  function loadOrders() {
    return api('/account/orders').then(function (d) {
      orders = d.orders;
      var box = $('orders-list'); box.innerHTML = '';
      if (!orders.length) { box.innerHTML = '<div class="empty">No orders yet. <a href="/#products">See the cameras</a>.</div>'; return; }
      orders.forEach(function (o) {
        var c = el('div', 'card');
        var head = el('div', 'card-head');
        var t = el('p', 'card-title', o.order_number + ' · ' + inr(o.total_paise));
        head.appendChild(t); head.appendChild(pill(o.status));
        c.appendChild(head);
        c.appendChild(el('p', 'card-meta', date(o.paid_at || o.created_at) + ' · ' + o.summary));
        var acts = el('div', 'card-actions');
        var view = el('button', 'btn btn-line', 'Details'); view.type = 'button';
        view.onclick = function () { openOrder(o.order_number); };
        acts.appendChild(view);
        if (o.tracking_url) { var tr = el('a', 'btn btn-line', 'Track'); tr.href = o.tracking_url; tr.target = '_blank'; tr.rel = 'noopener'; acts.appendChild(tr); }
        if (o.invoice_number) { var inv = el('a', 'btn btn-line', 'Invoice'); inv.href = '/api/account/orders/' + encodeURIComponent(o.order_number) + '/invoice'; acts.appendChild(inv); }
        c.appendChild(acts);
        box.appendChild(c);
      });
    });
  }
  function openOrder(num) {
    api('/account/orders/' + encodeURIComponent(num)).then(function (d) {
      var box = $('order-detail');
      box.hidden = false; $('orders-list').hidden = true;
      renderOrder(box, d.order, { signedIn: true, service: d.service_requests });
      var back = el('button', 'link-btn', '← All orders'); back.type = 'button';
      back.onclick = function () { box.hidden = true; $('orders-list').hidden = false; };
      box.insertBefore(back, box.firstChild);
      box.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------------------------------------------------------------- service
  function loadService() {
    var sel = $('sv-order');
    orders.forEach(function (o) { var op = el('option', '', o.order_number + ' · ' + o.summary); op.value = o.order_number; sel.appendChild(op); });
    if (q.get('order')) sel.value = q.get('order');
    return api('/account/service').then(function (d) {
      var box = $('service-list'); box.innerHTML = '';
      if (!d.service_requests.length) { box.innerHTML = '<div class="empty">No service requests. Open one with the form.</div>'; return; }
      d.service_requests.forEach(function (s) {
        var c = el('div', 'card');
        var head = el('div', 'card-head');
        head.appendChild(el('p', 'card-title', s.subject)); head.appendChild(pill(s.status));
        c.appendChild(head);
        c.appendChild(el('p', 'card-meta', s.request_number + ' · ' + KIND[s.kind] + (s.order_number ? ' · order ' + s.order_number : '') + ' · ' + date(s.created_at)));
        if (s.team_note) { var n2 = el('p', 't-body'); n2.style.marginTop = '10px'; n2.textContent = 'Our update: ' + s.team_note; c.appendChild(n2); }
        box.appendChild(c);
      });
    });
  }
  $('service-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target; F.clear(f);
    api('/account/service', { method: 'POST', body: F.values(f) }).then(function (d) {
      f.reset(); F.status(f, 'Request ' + d.service_request.request_number + ' sent. We have emailed you a copy.', 'ok');
      loadService();
    }).catch(function (err) { F.fail(f, err); });
  });

  // ---------------------------------------------------------------- addresses
  var states = {};
  api('/products').then(function (p) {
    var sel = $('af-state');
    p.states.forEach(function (s) { states[s.code] = s.name; var o = el('option', '', s.name); o.value = s.code; sel.appendChild(o); });
  });
  var aForm = $('address-form');
  function loadAddresses() {
    return api('/account/addresses').then(function (d) {
      var box = $('address-list'); box.innerHTML = '';
      if (!d.addresses.length) { box.innerHTML = '<div class="empty">No saved addresses yet.</div>'; return; }
      d.addresses.forEach(function (a) {
        var c = el('div', 'card');
        var head = el('div', 'card-head');
        head.appendChild(el('p', 'card-title', (a.label ? a.label + ' · ' : '') + a.name));
        if (a.is_default) head.appendChild(el('span', 'pill paid', 'Default delivery'));
        if (a.is_default_billing) head.appendChild(el('span', 'pill processing', 'Default billing'));
        c.appendChild(head);
        c.appendChild(el('p', 'card-meta', [a.business_name, a.address_line1, a.address_line2, a.city + ', ' + (states[a.state_code] || a.state_code) + ' ' + a.pincode, a.phone, a.gstin && 'GSTIN ' + a.gstin].filter(Boolean).join(', ')));
        var acts = el('div', 'card-actions');
        var ed = el('button', 'btn btn-line', 'Edit'); ed.type = 'button'; ed.onclick = function () { editAddress(a); };
        acts.appendChild(ed);
        if (!a.is_default) {
          var df = el('button', 'btn btn-line', 'Deliver here by default'); df.type = 'button';
          df.onclick = function () { api('/account/addresses/' + a.id + '/default', { method: 'POST' }).then(loadAddresses); };
          acts.appendChild(df);
        }
        if (!a.is_default_billing) {
          var db = el('button', 'btn btn-line', 'Bill here by default'); db.type = 'button';
          db.onclick = function () { api('/account/addresses/' + a.id + '/default?for=billing', { method: 'POST' }).then(loadAddresses); };
          acts.appendChild(db);
        }
        var rm = el('button', 'btn btn-line', 'Delete'); rm.type = 'button';
        rm.onclick = function () { if (confirm('Delete this address?')) api('/account/addresses/' + a.id, { method: 'DELETE' }).then(loadAddresses); };
        acts.appendChild(rm);
        c.appendChild(acts);
        box.appendChild(c);
      });
    });
  }
  function editAddress(a) {
    F.clear(aForm);
    ['id', 'label', 'name', 'phone', 'address_line1', 'address_line2', 'city', 'pincode', 'state_code', 'business_name', 'gstin'].forEach(function (k) {
      aForm.elements[k].value = a ? (a[k] || '') : '';
    });
    aForm.elements.is_default.checked = Boolean(a && a.is_default);
    aForm.elements.is_default_billing.checked = Boolean(a && a.is_default_billing);
    $('af-h').textContent = a ? 'Edit address' : 'Add an address';
    $('af-cancel').hidden = !a;
    aForm.scrollIntoView({ behavior: 'smooth' });
  }
  $('af-cancel').onclick = function () { editAddress(null); };
  aForm.addEventListener('submit', function (e) {
    e.preventDefault(); F.clear(aForm);
    var v = F.values(aForm), id = v.id;
    v.is_default = aForm.elements.is_default.checked;
    v.is_default_billing = aForm.elements.is_default_billing.checked;
    delete v.id;
    api('/account/addresses' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: v }).then(function () {
      editAddress(null); F.status(aForm, 'Address saved.', 'ok'); loadAddresses();
    }).catch(function (err) { F.fail(aForm, err); });
  });

  // ---------------------------------------------------------------- profile
  function profile() {
    var pf = $('profile-form');
    $('pf-name').value = me.name; $('pf-email').value = me.email; $('pf-phone').value = me.phone || '';
    $('pf-email-hint').textContent = me.email_verified ? 'Confirmed. To change it, email us.' : 'Not confirmed yet: open the link we emailed you. You need a confirmed email to place an order.';
    $('pf-email-pill').textContent = me.email_verified ? 'Confirmed' : 'Not confirmed';
    $('pf-email-pill').className = 'pill ' + (me.email_verified ? 'delivered' : 'warn');
    $('pf-verify-row').hidden = Boolean(me.email_verified);
    $('pf-verify').onclick = function () {
      var b = this; b.disabled = true;
      api('/auth/resend-verification', { method: 'POST' })
        .then(function (d) { $('pf-email-hint').textContent = 'Sent to ' + (d.sent_to || me.email) + '. Check your inbox and spam folder, then open the link.'; })
        .catch(function (e) { $('pf-email-hint').textContent = e.message; })
        .then(function () { setTimeout(function () { b.disabled = false; }, 15000); });
    };
    pf.onsubmit = function (e) {
      e.preventDefault(); F.clear(pf);
      api('/account/profile', { method: 'PATCH', body: F.values(pf) }).then(function () { F.status(pf, 'Saved.', 'ok'); }).catch(function (err) { F.fail(pf, err); });
    };
    var pw = $('password-form');
    if (!me.has_password) { $('pw-h').textContent = 'Set a password'; $('pw-current').hidden = true; }
    pw.onsubmit = function (e) {
      e.preventDefault(); F.clear(pw);
      if ($('pw-new').value !== $('pw-new2').value) { F.errors(pw, { new_password_confirm: 'The two passwords do not match.' }); return; }
      api('/account/password', { method: 'POST', body: F.values(pw) }).then(function () {
        pw.reset(); me.has_password = true; $('pw-h').textContent = 'Change password'; $('pw-current').hidden = false;
        F.status(pw, 'Password saved. Other devices have been signed out.', 'ok'); googleState();
      }).catch(function (err) { F.fail(pw, err); });
    };
    googleState();
    $('g-unlink').onclick = function () {
      api('/account/google/unlink', { method: 'POST' }).then(function () { me.google_linked = false; googleState(); })
        .catch(function (e) { $('side-status').textContent = e.message; });
    };
    $('signout').onclick = $('signout-top').onclick = function () { window.WargSignOut(); };
    $('signout-all').onclick = function () { api('/auth/logout-all', { method: 'POST' }).then(function () { location.href = '/login'; }); };
  }
  function googleState() {
    $('g-state').textContent = me.google_linked ? 'You can sign in with Google.' : 'Link a Google account to sign in with one click.';
    $('g-link').hidden = me.google_linked;
    $('g-unlink').hidden = !me.google_linked;
    $('g-unlink').disabled = !me.has_password;
    $('g-unlink').title = me.has_password ? '' : 'Set a password first';
  }
})();
