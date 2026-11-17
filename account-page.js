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

  // A labelled field for the order header: the label above, the value below.
  function field(label, value, cls) {
    var d = el('div', 'order-field' + (cls ? ' ' + cls : ''));
    d.appendChild(el('p', 'order-k', label));
    d.appendChild(el('p', 'order-v', value));
    return d;
  }
  var ORDER_IMG = { ghost: 'img/card-ghost.webp', greywind: 'img/card-greywind.webp', raven: 'img/card-raven.webp' };
  // What is actually in the order. The list endpoint may only carry `summary`,
  // so fall back to it rather than assuming `items` is there.
  function orderItems(o, withPrice) {
    var box = el('div', 'order-items');
    if (!o.items || !o.items.length) { box.appendChild(el('p', 'order-item-n', o.summary || '')); return box; }
    o.items.forEach(function (i) {
      var row = el('div', 'order-item');
      var sku = (i.sku || String(i.product_name || '').toLowerCase());
      if (ORDER_IMG[sku]) {
        var img = document.createElement('img');
        img.className = 'order-thumb'; img.src = ORDER_IMG[sku]; img.alt = '';
        img.width = 56; img.height = 42; img.decoding = 'async';
        row.appendChild(img);
      }
      var nameBox = el('div', '');
      nameBox.appendChild(el('p', 'order-item-n', i.product_name + ' × ' + i.quantity));
      if (withPrice && i.discount_label) nameBox.appendChild(el('p', 'ord-item-sub', i.discount_label));
      else if (withPrice && i.price_type === 'offer') nameBox.appendChild(el('p', 'ord-item-sub', 'offer price'));
      row.appendChild(nameBox);
      if (withPrice && i.unit_price_paise != null) row.appendChild(el('p', 'ord-item-p', inr(i.unit_price_paise * i.quantity)));
      box.appendChild(row);
    });
    return box;
  }
  // State names, for both account.html and order.html. renderOrder printed the
  // bare GST code, so an address read "Panaji, 30 403001".
  var states = {};
  var statesReady = api('/products').then(function (p) {
    (p.states || []).forEach(function (s) { states[s.code] = s.name; });
  }).catch(function () {});
  function stateName(code) { return states[code] || code; }

  // ---------------------------------------------------------------- one order (shared)
  /* The order page was one flat column: a status trail, then a run of
     headings with bare paragraphs under them. Nothing grouped, nothing to
     scan. Each group is now a card that names what it holds, the two columns
     split "where is it" from "what did I pay", and the address is set on its
     own lines instead of a comma run-on. */
  function renderOrder(box, o, opts) {
    opts = opts || {};
    box.innerHTML = '';

    // Where the order has got to, across the top and alone: it is the thing
    // every visit to this page is asking.
    var top = el('div', 'ord-card ord-status');
    if (o.status === 'cancelled') {
      top.appendChild(el('p', 'banner', 'This order was cancelled' + (o.cancel_reason ? ': ' + o.cancel_reason : '.') + ' A full refund goes back to the account you paid from.'));
    } else {
      var steps = el('ol', 'order-steps');
      var reached = ['paid', 'processing', 'shipped', 'delivered'].indexOf(o.status);
      ['Paid', 'Processing', 'Shipped', 'Delivered'].forEach(function (s, i) {
        var li = el('li', i < reached ? 'done' : i === reached ? 'done now' : '', s);
        if (i === reached) li.setAttribute('aria-current', 'step');
        steps.appendChild(li);
      });
      top.appendChild(steps);
    }
    box.appendChild(top);

    var wrap = el('div', 'checkout');
    var left = el('div', 'ord-stack');

    // ---- what is in it
    var itemsCard = el('div', 'ord-card');
    itemsCard.appendChild(el('h2', 'field-legend', (o.items || []).length === 1 ? 'Your item' : 'Your items'));
    itemsCard.appendChild(orderItems(o, true));
    left.appendChild(itemsCard);

    // ---- where it is, once there is anything to say about it
    if (o.tracking_number) {
      var ship = el('div', 'ord-card');
      ship.appendChild(el('h2', 'field-legend', 'Shipment'));
      var sp = el('div', 'ord-pairs');
      if (o.courier) sp.appendChild(field('Courier', o.courier));
      sp.appendChild(field('Tracking number', o.tracking_number, 'order-num'));
      if (o.expected_delivery && o.status === 'shipped') {
        sp.appendChild(field('Expected by', new Date(o.expected_delivery + 'T00:00:00+05:30')
          .toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })));
      }
      ship.appendChild(sp);
      if (o.tracking_url) {
        var ta = el('div', 'card-actions');
        var a = el('a', 'btn btn-line', 'Track your parcel');
        a.href = o.tracking_url; a.target = '_blank'; a.rel = 'noopener';
        ta.appendChild(a); ship.appendChild(ta);
      }
      left.appendChild(ship);
    }

    // ---- who it is going to, and who it is billed to
    if (o.address_line1) {
      var addr = el('div', 'ord-card');
      addr.appendChild(el('h2', 'field-legend', 'Delivery and billing'));
      var ap = el('div', 'ord-pairs');

      var d = el('div', 'order-field');
      d.appendChild(el('p', 'order-k', 'Delivering to'));
      d.appendChild(el('p', 'ord-addr', [o.customer_name, o.address_line1, o.address_line2,
        o.city + ', ' + stateName(o.state_code) + ' ' + o.pincode, o.phone].filter(Boolean).join('\n')));
      ap.appendChild(d);

      var b = o.billing;
      var bl = el('div', 'order-field');
      bl.appendChild(el('p', 'order-k', 'Billed to'));
      bl.appendChild(el('p', 'ord-addr', (b && !b.same
        ? [o.business_name, b.name, b.address_line1, b.address_line2,
           b.city + ', ' + stateName(b.state_code) + ' ' + b.pincode]
        : [o.business_name, 'Same as the delivery address'])
        .concat([o.gstin && 'GSTIN ' + o.gstin]).filter(Boolean).join('\n')));
      ap.appendChild(bl);

      addr.appendChild(ap);
      left.appendChild(addr);
    }

    // ---- the dated history. The trail above says which stage; this says
    //      when, and carries any note the team added, so it earns its place
    //      only when it holds more than a restatement of the stage.
    var tl = (o.timeline || []).filter(Boolean);
    if (tl.length > 1 || tl.some(function (e) { return e.message; })) {
      var up = el('div', 'ord-card');
      up.appendChild(el('h2', 'field-legend', 'Updates'));
      var ol = el('ol', 'order-timeline');
      tl.slice().reverse().forEach(function (e) {
        var li = el('li');
        li.appendChild(el('time', '', new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
        li.appendChild(el('span', '', e.message || STATUS[e.status] || ''));
        ol.appendChild(li);
      });
      up.appendChild(ol);
      left.appendChild(up);
    }

    // ---- anything raised against this order
    if (opts.service && opts.service.length) {
      var sv = el('div', 'ord-card');
      sv.appendChild(el('h2', 'field-legend', opts.service.length === 1 ? 'Service request' : 'Service requests'));
      opts.service.forEach(function (r) {
        var row = el('div', 'card-head');
        var t = el('p', 'card-title', r.subject);
        row.appendChild(t); row.appendChild(pill(r.status));
        sv.appendChild(row);
        sv.appendChild(el('p', 'card-meta', r.request_number));
      });
      left.appendChild(sv);
    }

    // ---- what it cost, and what you can do about it
    var aside = el('aside', 'summary');
    aside.appendChild(el('h2', 'field-legend', 'Payment'));
    var meta = el('div', 'ord-pairs');
    meta.appendChild(field('Order number', o.order_number, 'order-num'));
    meta.appendChild(field('Order placed', date(o.paid_at || o.created_at)));
    aside.appendChild(meta);

    var dl = el('dl', 'summary-lines');
    function row(k, v, cls) { var d = el('div', cls); d.appendChild(el('dt', '', k)); d.appendChild(el('dd', '', v)); dl.appendChild(d); }
    if (o.combo_discount_paise) row('Ghost + Greywind combo', '− ' + inr(o.combo_discount_paise));
    if (o.coupon_discount_paise) row('Coupon ' + o.coupon_code, '− ' + inr(o.coupon_discount_paise));
    row(o.combo_discount_paise || o.coupon_discount_paise ? 'Subtotal after discounts' : 'Subtotal', inr(o.subtotal_paise));
    row(o.tax_kind === 'intra' ? 'CGST 9% + SGST 9%' : 'IGST 18%', inr(o.gst_paise));
    if (o.total_paise - o.subtotal_paise - o.gst_paise) row('Round off', inr(o.total_paise - o.subtotal_paise - o.gst_paise));
    row(o.status === 'created' ? 'Total' : 'Total paid', inr(o.total_paise), 'summary-total');
    aside.appendChild(dl);
    if (o.invoice_number) aside.appendChild(el('p', 'hint', 'Invoice ' + o.invoice_number));

    var actions = el('div', 'card-actions');
    if (opts.signedIn && o.invoice_available) {
      var inv = el('a', 'btn btn-line', 'Download invoice');
      inv.href = '/api/account/orders/' + encodeURIComponent(o.order_number) + '/invoice';
      actions.appendChild(inv);
    }
    if (opts.signedIn && o.status !== 'created') {
      var re = el('button', 'btn btn-line', 'Buy again'); re.type = 'button';
      re.onclick = function () { api('/account/orders/' + encodeURIComponent(o.order_number) + '/reorder', { method: 'POST' }).then(function () { location.href = '/cart'; }); };
      actions.appendChild(re);
      var sr = el('a', 'btn btn-line', 'Request service');
      sr.href = '/account?order=' + encodeURIComponent(o.order_number) + '#service';
      actions.appendChild(sr);
    }
    if (!opts.signedIn) {
      var lg = el('a', 'btn btn-line', 'Sign in to see invoices and service');
      lg.href = '/login?next=' + encodeURIComponent('/account#orders');
      actions.appendChild(lg);
    }
    if (actions.childNodes.length) aside.appendChild(actions);

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
    statesReady.then(load);
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
    // A confirmed email is the normal case and needs no remark; only an
    // unconfirmed one is worth the reader's attention.
    $('acct-lede').textContent = me.email + (me.email_verified ? '' : ' · not confirmed yet');
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
        var c = el('div', 'card order-card');
        // Every figure says what it is. An order number, a date and a total
        // are indistinguishable otherwise, which is what the old single line
        // "WR-2026-0184 - Rs 73,157" left the reader to work out.
        var head = el('div', 'order-head');
        head.appendChild(field('Order placed', date(o.paid_at || o.created_at)));
        head.appendChild(field('Total', inr(o.total_paise), 'order-num'));
        head.appendChild(field('Order number', o.order_number, 'order-num'));
        var st = field('Status', '');
        st.lastChild.appendChild(pill(o.status));
        head.appendChild(st);
        c.appendChild(head);
        c.appendChild(orderItems(o));
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
      var back = el('button', 'link-btn ord-back', '← All orders'); back.type = 'button';
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
        if (s.team_note) { c.appendChild(el('p', 't-body card-note', 'Our update: ' + s.team_note)); }
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
  api('/products').then(function (p) {
    var sel = $('af-state');
    p.states.forEach(function (s) { var o = el('option', '', s.name); o.value = s.code; sel.appendChild(o); });
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
        // These mark a choice, not an order status — they borrowed `paid` and
        // `processing` only for their colours.
        // One idea, not two. Separate delivery and billing defaults read as a
        // puzzle on an address book this size.
        if (a.is_default) head.appendChild(el('span', 'pill pill-mark', 'Default'));
        c.appendChild(head);
        c.appendChild(el('p', 'card-meta', [a.business_name, a.address_line1, a.address_line2, a.city + ', ' + (states[a.state_code] || a.state_code) + ' ' + a.pincode, a.phone, a.gstin && 'GSTIN ' + a.gstin + (a.gstin_verified_at ? ' \u2713' : '')].filter(Boolean).join(', ')));
        var acts = el('div', 'card-actions');
        var ed = el('button', 'btn btn-line', 'Edit'); ed.type = 'button'; ed.onclick = function () { editAddress(a); };
        acts.appendChild(ed);
        if (!a.is_default) {
          var df = el('button', 'btn btn-line', 'Make default'); df.type = 'button';
          // Sets both ends of it, so "default" means one thing to the reader.
          df.onclick = function () {
            api('/account/addresses/' + a.id + '/default', { method: 'POST' })
              .then(function () { return api('/account/addresses/' + a.id + '/default?for=billing', { method: 'POST' }); })
              .then(loadAddresses);
          };
          acts.appendChild(df);
        }
        var rm = el('button', 'btn btn-line', 'Delete'); rm.type = 'button';
        rm.onclick = function () { if (confirm('Delete this address?')) api('/account/addresses/' + a.id, { method: 'DELETE' }).then(loadAddresses); };
        acts.appendChild(rm);
        c.appendChild(acts);
        box.appendChild(c);
      });
    });
  }
  var gstCheck = window.WargGstin($('af-gstin'), $('af-biz'), function () { return aForm.elements.state_code.value; });
  function editAddress(a) {
    F.clear(aForm); gstCheck.reset();
    ['id', 'label', 'name', 'phone', 'address_line1', 'address_line2', 'city', 'pincode', 'state_code', 'business_name', 'gstin'].forEach(function (k) {
      aForm.elements[k].value = a ? (a[k] || '') : '';
    });
    if (a && a.gstin) $('af-biz').readOnly = true;   // a saved GSTIN carries its verified legal name
    // Open the business section only when this address actually uses it.
    $('af-business').open = Boolean(a && (a.gstin || a.business_name));
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
    // Confirmed is the ordinary state, so it is not announced; the pill and
    // the resend button appear only when something needs doing.
    $('pf-email-hint').textContent = me.email_verified ? 'To change it, email us.' : 'Not confirmed yet: open the link we emailed you. You need a confirmed email to place an order.';
    $('pf-email-pill').textContent = 'Not confirmed';
    $('pf-email-pill').hidden = Boolean(me.email_verified);
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
    // Password lives in a dialog. <dialog> gives focus handling and Esc for
    // nothing; the panel only carries the button that opens it.
    var pw = $('password-form'), dlg = $('pw-dialog'), setting = !me.has_password;
    function pwLabels() {
      setting = !me.has_password;
      $('pw-h').textContent = setting ? 'Set a password' : 'Change password';
      $('pw-open').textContent = setting ? 'Set a password' : 'Change password';
      $('pw-open-p').textContent = setting
        ? 'You sign in with Google. Set a password to sign in with your email too.'
        : 'Changing it signs you out on your other devices.';
      $('pw-current').hidden = setting;
    }
    pwLabels();
    $('pw-open').onclick = function () { F.clear(pw); dlg.showModal(); };
    $('pw-close').onclick = function () { dlg.close(); };
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    pw.onsubmit = function (e) {
      e.preventDefault(); F.clear(pw);
      if ($('pw-new').value !== $('pw-new2').value) { F.errors(pw, { new_password_confirm: 'The two passwords do not match.' }); return; }
      api('/account/password', { method: 'POST', body: F.values(pw) }).then(function () {
        pw.reset(); me.has_password = true; pwLabels(); dlg.close();
        note('Password saved. Your other devices have been signed out.', true);
      }).catch(function (err) { F.fail(pw, err); });
    };
    googleState();
    $('signout').onclick = function () { window.WargSignOut(); };
    $('delete-acct').href = 'mailto:hello@wargrobotics.com?subject=' + encodeURIComponent('Delete my Warg account') +
      '&body=' + encodeURIComponent('Please delete my Warg Robotics account and personal data.\n\nAccount email: ' + me.email);
  }
  function googleState() {
    $('g-state').textContent = me.google_linked ? 'You can sign in with Google.' : 'Link a Google account to sign in with one click.';
    $('g-link').hidden = me.google_linked;
  }
})();
