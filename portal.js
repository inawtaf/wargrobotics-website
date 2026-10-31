/* Order portal (/admin): staff sign in with their Warg account (ADMIN_EMAILS). */
(function () {
  var api = window.WargApi, inr = window.inr;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function when(s) {
    if (!s) return '';
    var d = new Date(s);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  var LABEL = { created: 'unpaid', paid: 'to process', processing: 'processing', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled', refunded: 'refunded' };
  function pill(s) { return el('span', 'pill ' + s, LABEL[s] || s); }

  var state = { status: 'open', q: '', from: '', to: '', page: 1, current: null, couriers: [] };

  // ---------------------------------------------------------------- gate
  // Staff account (ADMIN_EMAILS, confirmed email), or an access token (ADMIN_TOKEN)
  // for when no staff account can sign in yet, e.g. while email is being set up.
  function tokenForm(gate) {
    var f = el('form', 'p-token');
    f.innerHTML = '<p class="p-muted">Or open the portal with the access token (the ADMIN_TOKEN secret):</p><input type="password" autocomplete="off" aria-label="Access token" placeholder="Access token"> <button class="btn btn-line" type="submit">Open with token</button><p class="p-muted p-token-msg"></p>';
    f.onsubmit = function (e) {
      e.preventDefault();
      try { sessionStorage.setItem('warg_admin_token', f.querySelector('input').value.trim()); } catch (x) {}
      api('/admin/me').then(function () { location.reload(); }).catch(function () {
        try { sessionStorage.removeItem('warg_admin_token'); } catch (x) {}
        f.querySelector('.p-token-msg').textContent = 'That token was not accepted.';
      });
    };
    gate.appendChild(f);
  }
  function openPortal(label, signOut) {
    $('who').textContent = label;
    var out = el('button', '', 'Sign out');
    out.onclick = signOut;
    $('who').appendChild(out);
    $('app').hidden = false;
    start();
  }
  var hasToken = false;
  try { hasToken = Boolean(sessionStorage.getItem('warg_admin_token')); } catch (x) {}
  (hasToken ? api('/admin/me').then(function (r) { return { token: r.actor === 'api-token' }; }).catch(function () { try { sessionStorage.removeItem('warg_admin_token'); } catch (x) {} return {}; }) : Promise.resolve({}))
    .then(function (t) {
      if (t.token) return openPortal('access token', function () { try { sessionStorage.removeItem('warg_admin_token'); } catch (x) {} location.reload(); });
      return window.WargMe().then(function (d) {
        var gate = $('gate');
        if (!d.user) {
          gate.hidden = false;
          gate.innerHTML = '<h1 class="t-section" style="font-size:26px">Staff sign-in</h1><p class="t-body">Sign in with your Warg Robotics staff account to open the order portal.</p><p><a class="btn btn-solid" href="/login?next=%2Fadmin">Sign in</a></p>';
          tokenForm(gate);
          return;
        }
        if (!d.user.is_staff) {
          gate.hidden = false;
          gate.innerHTML = '<h1 class="t-section" style="font-size:26px">No portal access</h1><p class="t-body"></p><p><a class="btn btn-line" href="/account">Go to your account</a></p>';
          gate.querySelector('.t-body').textContent = d.user.email + ' is not a staff account' + (d.user.email_verified ? '.' : ', and its email is not confirmed yet.') + ' Ask an admin to add it to ADMIN_EMAILS.';
          tokenForm(gate);
          return;
        }
        openPortal(d.user.email, function () { api('/auth/logout', { method: 'POST' }).then(function () { location.href = '/login?next=%2Fadmin'; }); });
      });
    });

  function start() {
    var p = new URLSearchParams(location.search);
    if (p.get('status') !== null) state.status = p.get('status');
    state.q = p.get('q') || '';
    $('q').value = state.q;
    syncChips();
    summary();
    loadOrders();
    if (p.get('order')) openOrder(p.get('order'));
    if (p.get('tab') === 'service') tab('service');
    if (p.get('tab') === 'setup') tab('setup');
    if (p.get('tab') === 'carts') tab('carts');
    setInterval(summary, 60000);   // keep the counts fresh while the page is open
  }

  // ---------------------------------------------------------------- summary
  function summary() {
    return api('/admin/summary').then(function (s) {
      state.couriers = s.couriers;
      $('t-paid').textContent = s.to_process;
      $('t-late').textContent = s.waiting_over_2_days ? s.waiting_over_2_days + ' waiting over 2 days' : '';
      $('t-processing').textContent = s.processing;
      $('t-shipped').textContent = s.shipped;
      $('t-overdue').textContent = s.past_expected_delivery ? s.past_expected_delivery + ' past expected date' : '';
      $('t-attention').textContent = s.needs_attention;
      $('t-service').textContent = s.open_service;
      $('t-carts').textContent = s.open_carts;
      $('t-revenue').textContent = inr(s.this_month.revenue_paise).replace(/\.\d\d$/, '');
      $('t-month').textContent = s.this_month.orders + ' orders, incl. GST';
      $('t-month').style.color = 'var(--ink-3)';
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () { tab('orders'); state.status = b.getAttribute('data-go'); state.page = 1; syncChips(); loadOrders(); };
  });

  // ---------------------------------------------------------------- tabs
  function tab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.p-tabs [data-tab]'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === name)); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    if (name === 'service') loadService();
    if (name === 'setup' && !healthRan) runHealth();
    if (name === 'carts') loadCarts();
    if (name === 'customers') loadCustomers();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.addEventListener('click', function () { tab(b.getAttribute('data-tab')); }); });

  // ---------------------------------------------------------------- order list
  function syncChips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-status]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-status') === state.status)); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-status]'), function (b) {
    b.onclick = function () { state.status = b.getAttribute('data-status'); state.page = 1; syncChips(); loadOrders(); };
  });
  $('search').onsubmit = function (e) {
    e.preventDefault();
    state.q = $('q').value.trim(); state.from = $('from').value; state.to = $('to').value; state.page = 1;
    if (state.q) { state.status = ''; syncChips(); }   // search across all paid orders
    loadOrders();
  };
  function query() {
    var p = new URLSearchParams();
    if (state.status !== null) p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    return p;
  }
  $('csv').onclick = function (e) { e.preventDefault(); location.href = '/api/admin/orders.csv?' + query().toString(); };
  $('more').onclick = function () { state.page++; loadOrders(true); };

  function loadOrders(append) {
    var p = query(); p.set('page', state.page);
    history.replaceState(null, '', '/admin?' + query().toString() + (state.current ? '&order=' + state.current : ''));
    return api('/admin/orders?' + p.toString()).then(function (d) {
      var tb = $('orders').querySelector('tbody');
      if (!append) tb.innerHTML = '';
      d.orders.forEach(function (o) {
        var tr = el('tr');
        tr.dataset.n = o.order_number;
        if (o.order_number === state.current) tr.setAttribute('aria-current', 'true');
        var c1 = el('td'); c1.appendChild(el('b', '', o.order_number));
        if ((o.invoice_error && !o.invoice_number) || o.email_error) c1.appendChild(el('small', 'flag', o.invoice_error && !o.invoice_number ? 'invoice failed' : 'email failed'));
        tr.appendChild(c1);
        var c2 = el('td', '', when(o.paid_at || o.created_at)); tr.appendChild(c2);
        var c3 = el('td', '', o.customer_name); c3.appendChild(el('small', '', o.city + ', ' + o.state_code)); tr.appendChild(c3);
        tr.appendChild(el('td', '', o.summary));
        tr.appendChild(el('td', 'num', inr(o.total_paise)));
        var c6 = el('td'); c6.appendChild(pill(o.status));
        if (o.tracking_number) c6.appendChild(el('small', '', o.courier + ' ' + o.tracking_number));
        tr.appendChild(c6);
        tr.onclick = function () { openOrder(o.order_number); };
        tb.appendChild(tr);
      });
      $('orders-empty').hidden = tb.children.length > 0;
      $('more').hidden = !d.more;
    }).catch(function (e) { flash(e.message, true); });
  }

  // ---------------------------------------------------------------- one order
  function flash(msg, bad) {
    var f = $('flash');
    f.hidden = !msg; f.textContent = msg || ''; f.className = 'p-flash' + (bad ? ' bad' : '');
  }

  function openOrder(n) {
    state.current = n;
    Array.prototype.forEach.call(document.querySelectorAll('#orders tbody tr'), function (tr) { tr.setAttribute('aria-current', String(tr.dataset.n === n)); });
    return api('/admin/orders/' + encodeURIComponent(n)).then(function (d) {
      render(d);
      $('detail').hidden = false;
      document.querySelector('.p-split').classList.add('has-detail');
      history.replaceState(null, '', '/admin?' + query().toString() + '&order=' + n);
    }).catch(function (e) { flash(e.message, true); });
  }
  $('d-close').onclick = function () {
    state.current = null; $('detail').hidden = true; flash('');
    document.querySelector('.p-split').classList.remove('has-detail');
    history.replaceState(null, '', '/admin?' + query().toString());
  };

  function render(d) {
    var o = d.order;
    var h = $('d-number'); h.textContent = o.order_number + ' '; h.appendChild(pill(o.status));
    $('d-sub').textContent = inr(o.total_paise) + ' · placed ' + when(o.paid_at || o.created_at);

    $('d-customer').textContent = [
      o.customer_name + (o.business_name ? ' · ' + o.business_name : ''),
      o.email, o.phone, '',
      'Deliver to:', o.address_line1, o.address_line2, o.city + ', ' + o.state_code + ' ' + o.pincode, '',
      o.billing_line1 ? 'Bill to: ' + o.billing_name : 'Bill to: same as delivery',
      o.billing_line1 ? o.billing_line1 : null, o.billing_line2 || null,
      o.billing_line1 ? o.billing_city + ', ' + o.billing_state_code + ' ' + o.billing_pincode : null,
      o.gstin ? 'GSTIN ' + o.gstin : null,
      'Place of supply: ' + (o.place_of_supply || o.state_code) + (o.tax_kind === 'intra' ? ' (CGST+SGST)' : ' (IGST)')
    ].filter(function (l) { return l !== null && l !== undefined; }).join('\n').replace(/\n{3,}/g, '\n\n');
    $('d-repeat').textContent = (d.account ? 'Account email ' + (d.account.email_verified ? 'confirmed' : 'NOT confirmed') + '. ' : '') +
      (d.customer_other_orders ? 'Repeat customer: ' + d.customer_other_orders + ' other order(s).' : '');
    $('copy-addr').onclick = function () {
      var text = [o.customer_name, o.address_line1, o.address_line2, o.city + ' ' + o.pincode, o.state_code, o.phone].filter(Boolean).join('\n');
      navigator.clipboard.writeText(text).then(function () { flash('Address copied.'); });
    };

    var t = $('d-items'); t.innerHTML = '';
    function row(a, b, cls) { var tr = el('tr', cls); tr.appendChild(el('td', '', a)); tr.appendChild(el('td', '', b)); t.appendChild(tr); }
    o.items.forEach(function (i) {
      row(i.product_name + ' × ' + i.quantity + (i.price_type === 'offer' ? ' (offer)' : ''), inr(i.unit_price_paise * i.quantity));
      if (i.discount_paise) row('   ' + i.discount_label, '− ' + inr(i.discount_paise));
    });
    if (o.coupon_code) row('Coupon used', o.coupon_code);
    row('Subtotal after discounts', inr(o.subtotal_paise));
    row(o.tax_kind === 'intra' ? 'CGST + SGST 18%' : 'IGST 18%', inr(o.gst_paise));
    row('Total', inr(o.total_paise), 't');

    $('d-pay').textContent = [
      o.razorpay_payment_id ? 'Razorpay ' + o.razorpay_payment_id : 'Not paid',
      o.paid_at ? 'Paid ' + when(o.paid_at) : null,
      'Invoice ' + (o.invoice_number || '—'),
      o.confirmation_sent_at ? 'Confirmation emailed ' + when(o.confirmation_sent_at) : 'Confirmation not sent',
      o.tracking_number ? o.courier + ' ' + o.tracking_number + (o.expected_delivery ? ' · expected ' + o.expected_delivery : '') : null,
      o.cancel_reason ? 'Cancelled: ' + o.cancel_reason : null
    ].filter(Boolean).join('\n');
    $('d-warn').textContent = [o.invoice_error && !o.zoho_invoice_id && 'Invoice error: ' + o.invoice_error, o.email_error && 'Email error: ' + o.email_error].filter(Boolean).join(' · ');

    actions(o);

    var tl = $('d-timeline'); tl.innerHTML = '';
    d.timeline.slice().reverse().forEach(function (e) {
      var li = el('li');
      li.appendChild(el('time', '', when(e.created_at)));
      var body = el('div');
      var STEP = { paid: 'Paid', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
      var msg = el('span', e.kind === 'note' ? 'k-note' : '', (e.kind === 'status' && e.status ? (STEP[e.status] || e.status) + ': ' : '') + (e.message || ''));
      body.appendChild(msg);
      if (e.visible) body.appendChild(el('span', 'vis', 'CUSTOMER SEES'));
      body.appendChild(el('div', 'who', e.actor));
      li.appendChild(body);
      tl.appendChild(li);
    });
  }

  // The next steps for this order's stage.
  function actions(o) {
    var box = $('d-actions'); box.innerHTML = '';
    function add(id) { var n = document.importNode($(id).content, true); box.appendChild(n); return box.lastElementChild; }
    if (o.status === 'paid') add('tpl-process');
    if (o.status === 'paid' || o.status === 'processing' || o.status === 'shipped') {
      var f = add('tpl-ship');
      var sel = f.querySelector('[name=courier]');
      state.couriers.forEach(function (c) { var op = el('option', '', c); op.value = c; sel.appendChild(op); });
      if (o.status === 'shipped') {
        f.querySelector('[data-ship-title]').textContent = 'Update tracking';
        f.querySelector('button[type=submit]').textContent = 'Save tracking';
        sel.value = o.courier || ''; f.elements.tracking_number.value = o.tracking_number || '';
        f.elements.tracking_url.value = o.tracking_url || ''; f.elements.expected_delivery.value = o.expected_delivery || '';
      }
    }
    if (o.status === 'shipped') add('tpl-deliver');
    if (o.status !== 'created') add('tpl-tools');
    if (['created', 'paid', 'processing'].indexOf(o.status) >= 0) add('tpl-cancel');

    Array.prototype.forEach.call(box.querySelectorAll('form[data-action]'), function (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var action = form.getAttribute('data-action');
        if (action === 'cancel' && !confirm('Cancel order ' + o.order_number + '? Remember to refund it in Razorpay.')) return;
        var body = {};
        Array.prototype.forEach.call(form.elements, function (x) { if (x.name) body[x.name] = x.type === 'checkbox' ? x.checked : x.value; });
        var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        api('/admin/orders/' + encodeURIComponent(o.order_number) + '/' + action, { method: 'POST', body: body }).then(function (r) {
          var msg = 'Saved: order is now ' + (LABEL[r.status] || r.status) + '.';
          if (r.emailed === true) msg += ' Customer emailed.';
          if (r.emailed === false) msg += ' The email FAILED; see the timeline and use Resend.';
          if (r.refund_needed) msg += ' Now refund it in Razorpay and add a credit note in Zoho.';
          refreshAll(o.order_number, msg, r.emailed === false);
        }).catch(function (err) { btn.disabled = false; flash(err.message, true); });
      };
    });
    var send = box.querySelector('[data-send]');
    if (send) {
      // Offer only the emails that make sense for where the order is now.
      var avail = { confirmation: true, invoice: Boolean(o.zoho_invoice_id), processing: ['processing', 'shipped', 'delivered'].indexOf(o.status) >= 0,
        dispatch: Boolean(o.tracking_number) && o.status !== 'cancelled', delivered: o.status === 'delivered', cancelled: o.status === 'cancelled' };
      Array.prototype.forEach.call(send.elements.which.options, function (op) { op.hidden = op.disabled = !avail[op.value]; });
      var latest = { delivered: 'delivered', shipped: 'dispatch', processing: 'processing', cancelled: 'cancelled' }[o.status] || 'confirmation';
      send.elements.which.value = latest;
      send.querySelector('[data-customer]').textContent = 'Customer: ' + o.email;
      send.elements.to_choice.onchange = function () {
        var other = send.elements.to_choice.value === 'other';
        send.querySelector('[data-other]').hidden = !other;
        if (other) send.elements.to.focus();
      };
      send.onsubmit = function (e) {
        e.preventDefault();
        var which = send.elements.which.value;
        var other = send.elements.to_choice.value === 'other';
        var to = other ? send.elements.to.value.trim() : '';
        if (other && !to) { flash('Enter the email address to send it to.', true); return; }
        var label = send.elements.which.options[send.elements.which.selectedIndex].textContent;
        if (!confirm('Send "' + label + '" to ' + (to || o.email) + '?')) return;
        var b = send.querySelector('button[type=submit]'); b.disabled = true;
        api('/admin/orders/' + encodeURIComponent(o.order_number) + '/resend', { method: 'POST', body: { which: which, to: to || undefined } })
          .then(function (r) { refreshAll(o.order_number, '"' + label + '" sent to ' + r.to + '.'); })
          .catch(function (err) { b.disabled = false; flash(err.message, true); });
      };
    }
    var retry = box.querySelector('[data-retry]');
    if (retry) retry.onclick = function () {
      api('/admin/orders/' + encodeURIComponent(o.order_number) + '/retry', { method: 'POST', body: {} })
        .then(function (r) { refreshAll(o.order_number, 'Retried: ' + JSON.stringify(r.result)); })
        .catch(function (e) { flash(e.message, true); });
    };
  }

  $('note-form').onsubmit = function (e) {
    e.preventDefault();
    var v = $('note').value.trim();
    if (!v || !state.current) return;
    api('/admin/orders/' + encodeURIComponent(state.current) + '/note', { method: 'POST', body: { message: v } })
      .then(function () { $('note').value = ''; refreshAll(state.current, 'Note added.'); })
      .catch(function (err) { flash(err.message, true); });
  };

  function refreshAll(n, msg, bad) {
    return Promise.all([openOrder(n), loadOrders(), summary()]).then(function () { flash(msg, bad); });
  }

  // ---------------------------------------------------------------- service
  var sStatus = '';
  Array.prototype.forEach.call(document.querySelectorAll('[data-sstatus]'), function (b) {
    b.onclick = function () {
      sStatus = b.getAttribute('data-sstatus');
      Array.prototype.forEach.call(document.querySelectorAll('[data-sstatus]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      loadService();
    };
  });
  var KIND = { repair: 'Repair', warranty: 'Warranty claim', return: 'Return', setup: 'Setup help', other: 'Other' };
  function loadService() {
    api('/admin/service' + (sStatus ? '?status=' + sStatus : '')).then(function (d) {
      var box = $('service'); box.innerHTML = '';
      if (!d.service_requests.length) { box.appendChild(el('p', 'p-empty', 'Nothing here.')); return; }
      d.service_requests.forEach(function (s) {
        var card = el('div', 'p-sr');
        var left = el('div');
        var h = el('h4', '', s.subject + ' '); h.appendChild(el('span', 'pill ' + s.status, s.status.replace('_', ' ')));
        left.appendChild(h);
        left.appendChild(el('p', 'p-muted', s.request_number + ' · ' + KIND[s.kind] + ' · ' + when(s.created_at)));
        var who = el('p', '', s.name + ' · ' + s.email + (s.phone ? ' · ' + s.phone : ''));
        left.appendChild(who);
        if (s.order_number) {
          var a = el('a', 'link-btn', 'Order ' + s.order_number); a.href = '#';
          a.onclick = function (e) { e.preventDefault(); tab('orders'); state.status = ''; syncChips(); loadOrders(); openOrder(s.order_number); };
          left.appendChild(a);
        }
        left.appendChild(el('p', '', s.message));
        var form = el('form', 'p-form');
        form.innerHTML = '<h3>Update the customer</h3><select name="status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>' +
          '<textarea name="team_note" rows="3" maxlength="2000" placeholder="Note the customer sees (emailed)"></textarea>' +
          '<label class="check"><input type="checkbox" name="notify" checked> Email the customer</label><button class="btn btn-solid" type="submit">Save</button>';
        form.elements.status.value = s.status;
        form.elements.team_note.value = s.team_note || '';
        form.onsubmit = function (e) {
          e.preventDefault();
          api('/admin/service/' + encodeURIComponent(s.request_number), { method: 'POST', body: { status: form.elements.status.value, team_note: form.elements.team_note.value, notify: form.elements.notify.checked } })
            .then(function () { summary(); loadService(); })
            .catch(function (err) { alert(err.message); });
        };
        card.appendChild(left); card.appendChild(form);
        box.appendChild(card);
      });
    });
  }

  // ---------------------------------------------------------------- setup check
  var healthRan = false;
  var SECTION = { settings: 'Settings and secrets', database: 'Database', google: 'Google sign-in', email: 'Email (Resend)', razorpay: 'Razorpay', zoho: 'Zoho Books' };
  function healthFlash(box, msg, bad) { box.hidden = !msg; box.textContent = msg || ''; box.className = 'p-flash' + (bad ? ' bad' : ''); }
  function runHealth() {
    healthRan = true;
    var box = $('health');
    box.innerHTML = '<p class="p-muted">Checking…</p>';
    api('/admin/health').then(function (h) {
      box.innerHTML = '';
      box.appendChild(el('p', h.ok ? 'p-ok' : 'p-warn', h.ok ? 'Everything checked out.' : 'Some items need fixing: see the rows marked ✗.'));
      Object.keys(h.sections).forEach(function (k) {
        box.appendChild(el('h3', 'p-h', SECTION[k] || k));
        var t = el('table', 'p-mini');
        h.sections[k].forEach(function (r) {
          var tr = el('tr');
          tr.appendChild(el('td', r.ok === false ? 'p-bad' : r.ok ? 'p-good' : 'p-info', r.ok === false ? '✗' : r.ok ? '✓' : 'i'));
          tr.appendChild(el('td', '', r.name));
          tr.appendChild(el('td', '', r.detail));
          t.appendChild(tr);
        });
        box.appendChild(t);
      });
      box.appendChild(el('p', 'p-muted', 'Checked ' + when(h.checked_at)));
    }).catch(function (e) { box.innerHTML = ''; box.appendChild(el('p', 'p-warn', 'Could not run the check: ' + e.message)); });
  }
  $('run-health').onclick = runHealth;
  $('test-email-form').onsubmit = function (e) {
    e.preventDefault();
    healthFlash($('health-flash'), 'Sending…');
    api('/admin/test-email', { method: 'POST', body: { to: $('test-email-to').value } })
      .then(function (r) { healthFlash($('health-flash'), r.message); })
      .catch(function (err) { healthFlash($('health-flash'), 'Not sent. ' + ((err.data && err.data.error) || err.message), true); });
  };

  // ---------------------------------------------------------------- carts
  var cartDays = 0;
  var STAGE = { unverified: 'Email not confirmed', checkout: 'Started checkout, not paid', cart: 'In cart' };
  function ago(s) {
    var m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
    return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  }
  function loadCarts() {
    var tb = $('carts').querySelector('tbody');
    api('/admin/carts' + (cartDays ? '?days=' + cartDays : '')).then(function (d) {
      tb.innerHTML = '';
      var t = d.totals;
      $('carts-sum').textContent = t.carts + ' open carts · ' + t.units + ' units · ' + inr(t.subtotal_paise).replace(/\.\d\d$/, '') + ' before GST — ' +
        t.cart + ' in cart, ' + t.checkout + ' started checkout without paying, ' + t.unverified + ' waiting on email confirmation';
      $('carts-empty').hidden = d.carts.length > 0;
      d.carts.forEach(function (c) {
        var tr = el('tr');
        var who = el('td'); who.appendChild(el('div', '', c.name)); var mail = el('a', 'p-muted', c.email); mail.href = 'mailto:' + c.email; who.appendChild(mail);
        if (c.phone) who.appendChild(el('div', 'p-muted', c.phone));
        tr.appendChild(who);
        tr.appendChild(el('td', '', c.summary));
        tr.appendChild(el('td', '', inr(c.subtotal_paise)));
        var st = el('td'); st.appendChild(el('span', 'p-stage ' + c.stage, STAGE[c.stage] || c.stage)); tr.appendChild(st);
        var la = el('td', '', ago(c.last_activity)); la.title = when(c.last_activity); tr.appendChild(la);
        tr.appendChild(el('td', '', String(c.paid_orders)));
        tb.appendChild(tr);
      });
    }).catch(function (e) { tb.innerHTML = ''; $('carts-sum').textContent = 'Could not load carts: ' + e.message; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-cdays]'), function (b) {
    b.onclick = function () {
      cartDays = Number(b.getAttribute('data-cdays'));
      Array.prototype.forEach.call(document.querySelectorAll('[data-cdays]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      loadCarts();
    };
  });

  // ---------------------------------------------------------------- customers
  var custFilter = '';
  function loadCustomers() {
    var tb = $('customers').querySelector('tbody');
    var qs = [];
    if (custFilter) qs.push('filter=' + custFilter);
    if ($('cust-q').value.trim()) qs.push('q=' + encodeURIComponent($('cust-q').value.trim()));
    api('/admin/customers' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) {
      tb.innerHTML = '';
      $('cust-sum').textContent = d.totals.accounts + ' accounts · ' + d.totals.verified + ' confirmed · ' + d.totals.unverified + ' not confirmed (they cannot pay until they confirm)';
      $('cust-empty').hidden = d.customers.length > 0;
      d.customers.forEach(function (c) {
        var tr = el('tr');
        var who = el('td'); who.appendChild(el('div', '', c.name)); var mail = el('a', 'p-muted', c.email); mail.href = 'mailto:' + c.email; who.appendChild(mail);
        if (c.phone) who.appendChild(el('div', 'p-muted', c.phone));
        tr.appendChild(who);
        var st = el('td'); st.appendChild(el('span', 'p-stage ' + (c.email_verified ? 'cart' : 'unverified'), c.email_verified ? 'Confirmed' : 'Not confirmed'));
        if (!c.email_verified) {
          var b = el('button', 'link-btn', 'Send confirmation email'); b.type = 'button';
          b.onclick = function () {
            b.disabled = true;
            api('/admin/customers/' + c.id + '/send-verification', { method: 'POST' })
              .then(function (r) { healthFlash($('cust-flash'), r.message); })
              .catch(function (e) { healthFlash($('cust-flash'), e.message, true); b.disabled = false; });
          };
          st.appendChild(el('br')); st.appendChild(b);
        }
        tr.appendChild(st);
        tr.appendChild(el('td', '', [c.has_google && 'Google', c.has_password && 'Password'].filter(Boolean).join(' + ') || '—'));
        tr.appendChild(el('td', '', when(c.created_at)));
        tr.appendChild(el('td', '', c.paid_orders ? c.paid_orders + ' · ' + inr(c.spent_paise).replace(/\.\d\d$/, '') : '0'));
        tr.appendChild(el('td', '', c.cart_units ? c.cart_units + ' units' : ''));
        tb.appendChild(tr);
      });
    }).catch(function (e) { tb.innerHTML = ''; $('cust-sum').textContent = 'Could not load customers: ' + e.message; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-cust]'), function (b) {
    b.onclick = function () {
      custFilter = b.getAttribute('data-cust');
      Array.prototype.forEach.call(document.querySelectorAll('[data-cust]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      loadCustomers();
    };
  });
  $('cust-search').onsubmit = function (e) { e.preventDefault(); loadCustomers(); };
})();
