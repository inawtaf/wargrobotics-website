/* Checkout: signed-in only. Cart from the account; delivery and billing
   addresses from the address book (or new ones); optional GSTIN, which belongs
   to the billing address; price quote from the server; then Razorpay Checkout.
   The server sets every price; nothing the browser sends can change it. */
(function () {
  var form = document.getElementById('checkout-form');
  if (!form) return;
  var api = window.WargApi, F = window.WargForm;
  var btn = document.getElementById('pay-btn');
  var addresses = [], user = null, quote = null, busy = false, states = {}, reviewing = null, coupon = null, couponInfo = null;
  function $(id) { return document.getElementById(id); }
  function track(n, p) { if (window.wargTrack) window.wargTrack(n, p); }

  window.WargMe().then(function (d) {
    if (!d.user) { location.href = '/login?next=%2Fcheckout'; return; }
    user = d.user;
    if (!user.email_verified) { $('verify-banner').hidden = false; $('vb-email').textContent = user.email; }
    return Promise.all([api('/products'), api('/account/addresses')]).then(function (r) {
      ['state_code', 'b_state_code'].forEach(function (id) {
        var sel = $(id);
        r[0].states.forEach(function (s) { var o = document.createElement('option'); o.value = s.code; o.textContent = s.name; sel.appendChild(o); });
      });
      states = {}; r[0].states.forEach(function (s) { states[s.code] = s.name; });
      setupCoupon(r[0].coupon);
      addresses = r[1].addresses;
      if (user.name) { $('name').value = user.name; $('b_name').value = user.name; }
      if (user.phone) $('phone').value = user.phone;
      renderAddresses();
      // A saved default billing address that isn't the delivery one: bill it.
      var defBill = addresses.find(function (a) { return a.is_default_billing; });
      if (defBill && String(defBill.id) !== choice()) { $('billing-same').checked = false; }
      renderBilling();
      syncGstFromSaved();
      refresh();
    });
  }).catch(function () { F.status(form, 'Could not load checkout. Please refresh.', 'bad'); });

  // Confirmed the email in another tab? Notice when they come back, no refresh needed.
  window.addEventListener('focus', function () {
    if (!user || user.email_verified) return;
    api('/me').then(function (d) {
      if (d.user && d.user.email_verified) { user.email_verified = true; $('verify-banner').hidden = true; F.status(form, ''); setBusy(false); }
    }).catch(function () {});
  });

  $('vb-resend').onclick = function () {
    api('/auth/resend-verification', { method: 'POST' })
      .then(function () { F.status(form, 'Sent. Check your inbox (and spam), then come back and refresh this page.', 'ok'); })
      .catch(function (e) { F.status(form, e.message, 'bad'); });
  };

  // ---------------------------------------------------------------- addresses
  function addrText(a) {
    return [a.business_name, a.address_line1, a.address_line2, a.city + ' ' + a.pincode, a.phone].filter(Boolean).join(', ');
  }
  // One radio list per address kind: delivery (address_choice) and billing (billing_choice).
  function renderPick(box, name, isDefault, newLabel) {
    box.innerHTML = '';
    var anyDefault = addresses.some(isDefault);
    addresses.forEach(function (a, i) {
      var l = document.createElement('label');
      l.innerHTML = '<input type="radio"><span><b></b><br><span class="t-small"></span></span>';
      var r = l.querySelector('input'); r.name = name; r.value = a.id; r.checked = anyDefault ? Boolean(isDefault(a)) : i === 0;
      l.querySelector('b').textContent = (a.label ? a.label + ' · ' : '') + a.name;
      l.querySelector('.t-small').textContent = addrText(a);
      box.appendChild(l);
    });
    var n = document.createElement('label');
    n.innerHTML = '<input type="radio" value="new"><span><b></b></span>';
    n.querySelector('input').name = name;
    n.querySelector('b').textContent = newLabel;
    if (!addresses.length) n.querySelector('input').checked = true;
    box.appendChild(n);
  }
  function renderAddresses() {
    renderPick($('addr-list'), 'address_choice', function (a) { return a.is_default; }, 'Deliver to a new address');
    syncNew();
  }
  function renderBilling() {
    renderPick($('bill-list'), 'billing_choice', function (a) { return a.is_default_billing; }, 'A new billing address');
    syncBilling();
  }
  function picked(name) { var c = form.querySelector('input[name="' + name + '"]:checked'); return c ? c.value : 'new'; }
  function choice() { return picked('address_choice'); }
  function billChoice() { return picked('billing_choice'); }
  function saved(id) { return addresses.find(function (x) { return String(x.id) === String(id); }); }
  function syncNew() { $('new-address').hidden = choice() !== 'new'; }
  function syncBilling() {
    var same = $('billing-same').checked;
    $('billing-box').hidden = same;
    $('new-billing').hidden = same || billChoice() !== 'new';
  }
  function deliveryState() {
    if (choice() === 'new') return $('state_code').value;
    var a = saved(choice()); return a ? a.state_code : '';
  }
  function billingState() {
    if ($('billing-same').checked) return deliveryState();
    if (billChoice() === 'new') return $('b_state_code').value;
    var a = saved(billChoice()); return a ? a.state_code : '';
  }
  function hasGst() { return $('is-business').checked && $('gstin').value.trim().length === 15; }
  // GST place of supply: the GSTIN's (billing) state for a business invoice, else the delivery state.
  function stateCode() { return hasGst() ? billingState() : deliveryState(); }
  // Picking a saved address that carries a GSTIN fills in the GST box.
  function syncGstFromSaved() {
    var id = $('billing-same').checked ? choice() : billChoice();
    var a = saved(id);
    if (a && (a.gstin || a.business_name)) {
      $('is-business').checked = true; $('gstin').value = a.gstin || ''; $('business_name').value = a.business_name || '';
      form.querySelector('[data-addon="business"]').hidden = false;
    }
  }
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'address_choice') { syncNew(); syncGstFromSaved(); refresh(); }
    if (t.name === 'billing_choice' || t.id === 'billing-same') { syncBilling(); syncGstFromSaved(); refresh(); }
    if (t.id === 'state_code' || t.id === 'b_state_code' || t.id === 'gstin') refresh();
    if (t.id === 'is-business') { form.querySelector('[data-addon="business"]').hidden = !t.checked; refresh(); }
  });

  // ---------------------------------------------------------------- summary
  // ---------------------------------------------------------------- coupon
  // The launch code is filled in; the buyer presses Apply. Applied, it is sent
  // with every quote and with the order, and the server decides what it takes off.
  function setupCoupon(info) {
    couponInfo = info;
    if (!info || !info.active) return;
    $('coupon-box').hidden = false;
    $('coupon-code').value = info.code;
    $('coupon-msg').textContent = info.percent + '% off, valid until ' + info.valid_until_text + '. Not combined with the combo price.';
  }
  $('coupon-apply').onclick = function () {
    if (coupon) { coupon = null; refresh(); return; }       // the button says Remove once applied
    var code = $('coupon-code').value.trim().toUpperCase();
    if (!code) { $('coupon-msg').textContent = 'Enter a coupon code.'; return; }
    coupon = code; refresh();
  };
  function showCoupon(q) {
    var msg = $('coupon-msg'), b = $('coupon-apply');
    if (!coupon) { b.textContent = 'Apply'; $('coupon-code').disabled = false; return; }
    var c = q.coupon || {};
    if (c.status === 'invalid' || c.status === 'used_up') { msg.textContent = c.message; coupon = null; b.textContent = 'Apply'; return; }
    b.textContent = 'Remove'; $('coupon-code').disabled = true;
    msg.textContent = c.status === 'applied' ? coupon + ' applied: you save ' + window.inr(c.discountPaise) + ' before GST.' : c.message || '';
  }

  function refresh() {
    var sc = stateCode();
    var qs = [];
    if (sc) qs.push('state_code=' + sc);
    if (coupon) qs.push('coupon=' + encodeURIComponent(coupon));
    api('/cart' + (qs.length ? '?' + qs.join('&') : '')).then(function (c) {
      if (!c.items.length) { location.href = '/cart'; return; }
      quote = c.quote;
      showCoupon(quote);
      var box = $('sum-items'); box.innerHTML = '';
      quote.lines.forEach(function (l) {
        var p = document.createElement('p'); p.className = 'summary-item';
        p.textContent = l.productName + ' × ' + l.quantity;
        var s = document.createElement('p'); s.className = 'summary-offer';
        s.textContent = window.inr(l.listSubtotalPaise) + (l.discountLabel ? ' · ' + l.discountLabel : '');
        box.appendChild(p); box.appendChild(s);
      });
      $('sum-subtotal').textContent = window.inr(quote.listSubtotalPaise);
      Array.prototype.forEach.call(document.querySelectorAll('.summary-lines .disc-row'), function (el) { el.remove(); });
      var anchor = $('sum-disc-anchor');
      quote.discounts.forEach(function (d) {
        var row = document.createElement('div'); row.className = 'disc-row';
        var dt = document.createElement('dt'); dt.textContent = d.label;
        var dd = document.createElement('dd'); dd.textContent = '− ' + window.inr(d.paise);
        row.appendChild(dt); row.appendChild(dd); anchor.parentNode.insertBefore(row, anchor);
      });
      var total = document.querySelector('.summary-total');
      Array.prototype.forEach.call(document.querySelectorAll('.summary-lines .tax-row'), function (el) { el.remove(); });
      (sc ? quote.taxLines : [{ label: 'GST 18%', paise: quote.gstPaise }]).forEach(function (l) {
        var row = document.createElement('div'); row.className = 'tax-row';
        var dt = document.createElement('dt'); dt.textContent = l.label;
        var dd = document.createElement('dd'); dd.textContent = window.inr(l.paise);
        row.appendChild(dt); row.appendChild(dd); total.parentNode.insertBefore(row, total);
      });
      $('sum-total').textContent = window.inr(quote.totalPaise);
      $('tax-note').textContent = sc ? 'GST place of supply: ' + (states[sc] || sc) + (hasGst() ? ' (state of your GSTIN).' : ' (delivery state).') : '';
      if (!busy) setBusy(false);
    });
  }

  function setBusy(on, label) {
    busy = on;
    btn.disabled = on || !user || !user.email_verified;
    var q = reviewing ? reviewing.quote : quote;
    btn.textContent = label || (reviewing ? 'Pay ' + window.inr(q.totalPaise) : 'Review order');
  }

  // ---------------------------------------------------------------- review step
  // Before paying: the server checks everything and prices it (dry run), and
  // the buyer sees exactly what will be ordered, where it goes and who is billed.
  function addrLines(a) {
    return [a.name, a.address_line1, a.address_line2, a.city + ', ' + (states[a.state_code] || a.state_code) + ' ' + a.pincode, a.phone].filter(Boolean);
  }
  function showReview(r) {
    reviewing = r;
    var box = $('review'); box.innerHTML = '';
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function block(title, lines) {
      var d = el('div'); d.appendChild(el('h3', '', title));
      lines.forEach(function (l, i) { if (i) d.appendChild(document.createElement('br')); d.appendChild(document.createTextNode(l)); });
      return d;
    }
    box.appendChild(el('h2', 'field-legend', 'Review your order'));
    var grid = el('div', 'review-grid');
    grid.appendChild(block('Deliver to', addrLines(r.delivery)));
    grid.appendChild(block('Bill to', [r.business_name].filter(Boolean).concat(r.billingSame ? ['Same as delivery address'] : addrLines(r.billing)).concat(r.gstin ? ['GSTIN ' + r.gstin] : [])));
    grid.appendChild(block('Email', [r.email, 'Order confirmation and GST invoice go here.']));
    grid.appendChild(block('GST', ['Place of supply: ' + (states[r.place_of_supply] || r.place_of_supply), r.quote.taxKind === 'intra' ? 'CGST 9% + SGST 9%' : 'IGST 18%']));
    box.appendChild(grid);
    var t = el('table');
    function row(a, b, cls) { var tr = el('tr', cls); tr.appendChild(el('td', '', a)); tr.appendChild(el('td', '', b)); t.appendChild(tr); }
    r.quote.lines.forEach(function (l) { row(l.productName + ' × ' + l.quantity + ' @ ' + window.inr(l.unitPricePaise), window.inr(l.listSubtotalPaise)); });
    r.quote.discounts.forEach(function (d) { row(d.label, '− ' + window.inr(d.paise), 'disc'); });
    row(r.quote.discounts.length ? 'Subtotal after discounts' : 'Subtotal', window.inr(r.quote.subtotalPaise));
    r.quote.taxLines.forEach(function (l) { row(l.label, window.inr(l.paise)); });
    row('Delivery', 'Free');
    row('Total to pay', window.inr(r.quote.totalPaise), 'total');
    box.appendChild(t);
    box.hidden = false;
    $('co-fields').hidden = true;
    $('edit-btn').hidden = false;
    setBusy(false);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function editDetails() {
    reviewing = null;
    $('review').hidden = true; $('co-fields').hidden = false; $('edit-btn').hidden = true;
    F.clear(form); setBusy(false);
  }
  $('edit-btn').onclick = editDetails;

  // ---------------------------------------------------------------- pay
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clear(form);
    var body = { hp_trap: $('hp-trap').value };
    var v = F.values(form);
    if (choice() === 'new') {
      body.delivery_address = { name: v.name, phone: v.phone, address_line1: v.address_line1, address_line2: v.address_line2, city: v.city, state_code: v.state_code, pincode: v.pincode };
      body.save_delivery = $('save-address').checked;
    } else {
      body.delivery_address_id = Number(choice());
    }
    body.billing_same = $('billing-same').checked;
    if (!body.billing_same) {
      if (billChoice() === 'new') {
        body.billing_address = {};
        Array.prototype.forEach.call(form.querySelectorAll('[data-b]'), function (i) { body.billing_address[i.getAttribute('data-b')] = i.value; });
        body.save_billing = $('save-billing').checked;
      } else {
        body.billing_address_id = Number(billChoice());
      }
    }
    if (coupon) body.coupon = coupon;
    body.gstin = $('is-business').checked ? $('gstin').value : '';
    body.business_name = $('is-business').checked ? $('business_name').value : '';

    if (!reviewing) {
      setBusy(true, 'Checking…');
      api('/orders', { method: 'POST', body: Object.assign({ dry_run: true }, body) }).then(function (d) { showReview(d.review); })
        .catch(function (err) { setBusy(false); showErrors(err); });
      return;
    }
    if (typeof window.Razorpay !== 'function') {
      F.status(form, 'The payment window could not load. Check your connection or ad blocker, then try again.', 'bad');
      return;
    }
    setBusy(true, 'Creating your order…');
    api('/orders', { method: 'POST', body: body }).then(openRazorpay).catch(function (err) {
      editDetails();
      showErrors(err);
    });
  });

  function showErrors(err) {
      F.fail(form, err);
      var f = err.data && err.data.fields;
      if (f) {
        // Billing errors come back as billing_<field>; show them next to the b_<field> inputs.
        Object.keys(f).forEach(function (k) {
          if (k.indexOf('billing_') === 0 && k !== 'billing_address_id') {
            var input = $('b_' + k.slice(8));
            if (input) { var p = document.createElement('p'); p.className = 'err'; p.textContent = f[k]; input.setAttribute('aria-invalid', 'true'); input.parentNode.appendChild(p); }
          }
        });
        if (f.coupon) { coupon = null; $('coupon-msg').textContent = f.coupon; refresh(); }
        var top = f.address_id || f.billing_address_id || f.gstin || f.coupon;
        if (top) F.status(form, top, 'bad');
      }
  }

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
