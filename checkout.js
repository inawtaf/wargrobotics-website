/* Checkout: signed-in only. Cart from the account, address from the address
   book (or a new one), price quote from the server, then Razorpay Checkout.
   The server sets every price; nothing the browser sends can change it. */
(function () {
  var form = document.getElementById('checkout-form');
  if (!form) return;
  var api = window.WargApi, F = window.WargForm;
  var btn = document.getElementById('pay-btn');
  var addresses = [], user = null, quote = null, busy = false;
  function $(id) { return document.getElementById(id); }
  function track(n, p) { if (window.wargTrack) window.wargTrack(n, p); }

  window.WargMe().then(function (d) {
    if (!d.user) { location.href = '/login?next=%2Fcheckout'; return; }
    user = d.user;
    if (!user.email_verified) { $('verify-banner').hidden = false; $('vb-email').textContent = user.email; }
    return Promise.all([api('/products'), api('/account/addresses')]).then(function (r) {
      var sel = $('state_code');
      r[0].states.forEach(function (s) { var o = document.createElement('option'); o.value = s.code; o.textContent = s.name; sel.appendChild(o); });
      addresses = r[1].addresses;
      if (user.name) $('name').value = user.name;
      if (user.phone) $('phone').value = user.phone;
      renderAddresses();
      refresh();
    });
  }).catch(function () { F.status(form, 'Could not load checkout. Please refresh.', 'bad'); });

  $('vb-resend').onclick = function () {
    api('/auth/resend-verification', { method: 'POST' })
      .then(function () { F.status(form, 'Sent. Check your inbox (and spam), then come back and refresh this page.', 'ok'); })
      .catch(function (e) { F.status(form, e.message, 'bad'); });
  };

  // ---------------------------------------------------------------- addresses
  function addrText(a) {
    return [a.business_name, a.address_line1, a.address_line2, a.city + ' ' + a.pincode, a.phone].filter(Boolean).join(', ');
  }
  function renderAddresses() {
    var box = $('addr-list');
    box.innerHTML = '';
    addresses.forEach(function (a, i) {
      var l = document.createElement('label');
      l.innerHTML = '<input type="radio" name="address_choice"><span><b></b><br><span class="t-small"></span></span>';
      var r = l.querySelector('input'); r.value = a.id; r.checked = Boolean(a.is_default) || i === 0;
      l.querySelector('b').textContent = (a.label ? a.label + ' · ' : '') + a.name;
      l.querySelector('.t-small').textContent = addrText(a);
      box.appendChild(l);
    });
    var n = document.createElement('label');
    n.innerHTML = '<input type="radio" name="address_choice" value="new"><span><b>Deliver to a new address</b></span>';
    if (!addresses.length) n.querySelector('input').checked = true;
    box.appendChild(n);
    syncNew();
  }
  function choice() { var c = form.querySelector('input[name="address_choice"]:checked'); return c ? c.value : 'new'; }
  function syncNew() { $('new-address').hidden = choice() !== 'new'; }
  function stateCode() {
    var c = choice();
    if (c === 'new') return $('state_code').value;
    var a = addresses.find(function (x) { return String(x.id) === c; });
    return a ? a.state_code : '';
  }
  form.addEventListener('change', function (e) {
    if (e.target.name === 'address_choice') { syncNew(); refresh(); }
    if (e.target.id === 'state_code') refresh();
    if (e.target.id === 'is-business') form.querySelector('[data-addon="business"]').hidden = !e.target.checked;
  });

  // ---------------------------------------------------------------- summary
  function refresh() {
    var sc = stateCode();
    api('/cart' + (sc ? '?state_code=' + sc : '')).then(function (c) {
      if (!c.items.length) { location.href = '/cart'; return; }
      quote = c.quote;
      var box = $('sum-items'); box.innerHTML = '';
      quote.lines.forEach(function (l) {
        var p = document.createElement('p'); p.className = 'summary-item';
        p.textContent = l.productName + ' × ' + l.quantity;
        var s = document.createElement('p'); s.className = 'summary-offer';
        s.textContent = window.inr(l.subtotalPaise) + (l.priceType === 'offer' ? ' · offer price' : '');
        box.appendChild(p); box.appendChild(s);
      });
      $('sum-subtotal').textContent = window.inr(quote.subtotalPaise);
      var total = document.querySelector('.summary-total');
      Array.prototype.forEach.call(document.querySelectorAll('.summary-lines .tax-row'), function (el) { el.remove(); });
      (sc ? quote.taxLines : [{ label: 'GST 18%', paise: quote.gstPaise }]).forEach(function (l) {
        var row = document.createElement('div'); row.className = 'tax-row';
        var dt = document.createElement('dt'); dt.textContent = l.label;
        var dd = document.createElement('dd'); dd.textContent = window.inr(l.paise);
        row.appendChild(dt); row.appendChild(dd); total.parentNode.insertBefore(row, total);
      });
      $('sum-total').textContent = window.inr(quote.totalPaise);
      if (!busy) setBusy(false);
    });
  }

  function setBusy(on, label) {
    busy = on;
    btn.disabled = on || !user || !user.email_verified;
    btn.textContent = label || (quote ? 'Pay ' + window.inr(quote.totalPaise) : 'Pay');
  }

  // ---------------------------------------------------------------- pay
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clear(form);
    if (typeof window.Razorpay !== 'function') {
      F.status(form, 'The payment window could not load. Check your connection or ad blocker, then try again.', 'bad');
      return;
    }
    var body = { hp_trap: $('hp-trap').value };
    if (choice() === 'new') {
      var v = F.values(form);
      body.address = { name: v.name, phone: v.phone, address_line1: v.address_line1, address_line2: v.address_line2, city: v.city, state_code: v.state_code, pincode: v.pincode };
      if ($('is-business').checked) { body.address.gstin = v.gstin; body.address.business_name = v.business_name; }
      body.save_address = $('save-address').checked;
    } else {
      body.address_id = Number(choice());
    }
    setBusy(true, 'Creating your order…');
    api('/orders', { method: 'POST', body: body }).then(openRazorpay).catch(function (err) {
      setBusy(false);
      F.fail(form, err);
      if (err.data && err.data.fields && err.data.fields.address_id) F.status(form, err.data.fields.address_id, 'bad');
    });
  });

  function openRazorpay(o) {
    track('begin_checkout', { currency: 'INR', value: o.amount_paise / 100, items: o.quote.lines.map(function (l) { return { item_id: l.sku, item_name: l.productName, quantity: l.quantity }; }) });
    var rzp = new window.Razorpay({
      key: o.razorpay_key_id,
      order_id: o.razorpay_order_id,
      amount: o.amount_paise,
      currency: 'INR',
      name: 'Warg Robotics',
      description: o.quote.summary + ' · ' + o.order_number,
      prefill: o.prefill,
      notes: { order_number: o.order_number },
      theme: { color: '#2B00FF' },
      handler: function (resp) { confirmPayment(o, resp); },
      modal: { ondismiss: function () { setBusy(false); F.status(form, 'Payment window closed. Nothing has been charged; you can try again.', 'bad'); } }
    });
    rzp.on('payment.failed', function (resp) {
      F.status(form, 'Payment failed: ' + ((resp.error && resp.error.description) || 'please try another method') + '.', 'bad');
    });
    setBusy(true, 'Waiting for payment…');
    rzp.open();
  }

  function confirmPayment(o, resp) {
    setBusy(true, 'Confirming payment…');
    var go = function () { location.href = '/order?n=' + encodeURIComponent(o.order_number) + '&t=' + o.token; };
    api('/orders/' + encodeURIComponent(o.order_number) + '/confirm', { method: 'POST', body: {
      razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature
    } }).then(function () {
      track('purchase', { transaction_id: o.order_number, currency: 'INR', value: o.amount_paise / 100, tax: o.quote.gstPaise / 100,
        items: o.quote.lines.map(function (l) { return { item_id: l.sku, item_name: l.productName, quantity: l.quantity, price: l.unitPricePaise / 100 }; }) });
      go();
    }).catch(go);   // the webhook still records the payment; the order page will show it
  }
})();
