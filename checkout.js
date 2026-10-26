/* Checkout: prices from /api/products, live quote, then Razorpay Checkout.
   The server sets the price; nothing the browser sends can change it. */
(function () {
  var form = document.getElementById('checkout-form');
  if (!form) return;
  var btn = document.getElementById('pay-btn');
  var statusEl = form.querySelector('.form-status');
  var cfg = null, quote = null, busy = false, quoteTimer = null;

  function inr(paise) {
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function inrWhole(paise) { return '₹' + Math.round(paise / 100).toLocaleString('en-IN'); }
  function $(id) { return document.getElementById(id); }
  function track(name, params) { if (window.wargTrack) window.wargTrack(name, params); }

  function setStatus(msg, cls) {
    statusEl.className = 'form-status' + (cls ? ' ' + cls : '');
    statusEl.textContent = msg || '';
  }

  function chosenSku() {
    var r = form.querySelector('input[name="sku"]:checked');
    return r ? r.value : 'ghost';
  }

  // ?unit=greywind preselects a product.
  var unit = new URLSearchParams(location.search).get('unit');
  if (unit && $('sku-' + unit)) $('sku-' + unit).checked = true;

  // Business GSTIN fields
  var biz = $('is-business'), bizBox = form.querySelector('[data-addon="business"]');
  biz.addEventListener('change', function () { bizBox.hidden = !biz.checked; });

  // ---------------------------------------------------------------- prices
  fetch('/api/products').then(function (r) {
    if (!r.ok) throw new Error('prices unavailable');
    return r.json();
  }).then(function (data) {
    cfg = data;
    var sel = $('state_code');
    data.states.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.code; o.textContent = s.name;
      sel.appendChild(o);
    });
    data.products.forEach(function (p) {
      var el = form.querySelector('[data-price="' + p.sku + '"]');
      if (!el) return;
      var offer = p.offer_units_left > 0;
      el.innerHTML = '';
      if (offer) {
        var was = document.createElement('s'); was.textContent = inrWhole(p.list_price_paise);
        el.appendChild(was); el.appendChild(document.createTextNode(' '));
      }
      var now = document.createElement('b');
      now.textContent = inrWhole(offer ? p.offer_price_paise : p.list_price_paise) + ' + GST';
      el.appendChild(now);
    });
    $('quantity').max = data.max_quantity;
    refreshQuote();
  }).catch(function () {
    btn.textContent = 'Checkout unavailable';
    setStatus('We could not load prices. Please refresh, or email hello@wargrobotics.com to order.', 'bad');
  });

  function refreshQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(function () {
      var qty = parseInt($('quantity').value, 10);
      if (!cfg || !(qty >= 1 && qty <= cfg.max_quantity)) return;
      fetch('/api/quote', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku: chosenSku(), quantity: qty, state_code: $('state_code').value })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.quote) renderQuote(d.quote);
      }).catch(function () {});
    }, 150);
  }

  function renderQuote(q) {
    quote = q;
    $('sum-name').textContent = q.productName;
    $('sum-qty').textContent = q.quantity;
    $('sum-subtotal').textContent = inr(q.subtotalPaise);
    // Replace the tax rows: one IGST row, or CGST + SGST once a state is chosen.
    var total = document.querySelector('.summary-total');
    Array.prototype.forEach.call(document.querySelectorAll('.summary-lines .tax-row'), function (el) { el.remove(); });
    var lines = $('state_code').value ? q.taxLines : [{ label: 'GST 18%', paise: q.gstPaise }];
    lines.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'tax-row';
      var dt = document.createElement('dt'); dt.textContent = l.label;
      var dd = document.createElement('dd'); dd.textContent = inr(l.paise);
      row.appendChild(dt); row.appendChild(dd);
      total.parentNode.insertBefore(row, total);
    });
    $('sum-total').textContent = inr(q.totalPaise);
    var offer = $('sum-offer');
    if (q.priceType === 'offer') {
      offer.hidden = false;
      offer.textContent = 'Offer price – ' + q.offerUnitsLeft + ' of the first 100 left';
    } else {
      offer.hidden = true;
    }
    if (!busy) { btn.disabled = false; btn.textContent = 'Pay ' + inr(q.totalPaise); }
  }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'sku' || e.target.name === 'state_code' || e.target.name === 'quantity') refreshQuote();
  });
  $('quantity').addEventListener('input', refreshQuote);

  // ---------------------------------------------------------------- errors
  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (el) { el.remove(); });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) {
      el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby');
    });
  }
  function showErrors(fields) {
    var first = null;
    Object.keys(fields).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (!input) return;
      if (name === 'gstin' || name === 'business_name') { biz.checked = true; bizBox.hidden = false; }
      var p = document.createElement('p');
      p.className = 'err'; p.id = 'err-' + name; p.textContent = fields[name];
      var field = input.closest('.field') || input.closest('fieldset');
      field.appendChild(p);
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', p.id);
      if (!first) first = input;
    });
    if (first) first.focus();
  }

  // ---------------------------------------------------------------- pay
  function payload() {
    var f = new FormData(form);
    var b = {};
    ['sku', 'quantity', 'name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state_code', 'pincode', 'hp_trap']
      .forEach(function (k) { b[k] = (f.get(k) || '').toString(); });
    b.quantity = parseInt(b.quantity, 10);
    if (biz.checked) { b.gstin = (f.get('gstin') || '').toString(); b.business_name = (f.get('business_name') || '').toString(); }
    return b;
  }

  function setBusy(on, label) {
    busy = on;
    btn.disabled = on;
    btn.textContent = label || (quote ? 'Pay ' + inr(quote.totalPaise) : 'Pay');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    clearErrors(); setStatus('');
    if (typeof window.Razorpay !== 'function') {
      setStatus('The payment window could not load. Check your connection or ad blocker, then try again.', 'bad');
      return;
    }
    setBusy(true, 'Creating your order…');
    fetch('/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload())
    }).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, data: d }; });
    }).then(function (res) {
      if (res.status === 422) {
        setBusy(false); showErrors(res.data.fields || {});
        setStatus('Please check the highlighted fields.', 'bad');
        return;
      }
      if (res.status !== 201) throw new Error(res.data.error || 'order failed');
      openRazorpay(res.data);
    }).catch(function (err) {
      setBusy(false);
      setStatus('We could not create your order: ' + err.message + '. Nothing has been charged.', 'bad');
    });
  });

  function openRazorpay(o) {
    track('begin_checkout', { currency: 'INR', value: o.amount_paise / 100, items: [{ item_id: o.quote.sku, item_name: o.quote.productName, quantity: o.quote.quantity }] });
    var rzp = new window.Razorpay({
      key: o.razorpay_key_id,
      order_id: o.razorpay_order_id,
      amount: o.amount_paise,
      currency: 'INR',
      name: 'Warg Robotics',
      description: o.quote.productName + ' × ' + o.quote.quantity + ' · ' + o.order_number,
      prefill: o.prefill,
      notes: { order_number: o.order_number },
      theme: { color: '#2B00FF' },
      handler: function (resp) { confirmPayment(o, resp); },
      modal: {
        ondismiss: function () {
          setBusy(false);
          setStatus('Payment window closed. Nothing has been charged; you can try again.', 'bad');
        }
      }
    });
    rzp.on('payment.failed', function (resp) {
      setStatus('Payment failed: ' + ((resp.error && resp.error.description) || 'please try another method') + '.', 'bad');
    });
    setBusy(true, 'Waiting for payment…');
    rzp.open();
  }

  function confirmPayment(o, resp) {
    setBusy(true, 'Confirming payment…');
    var go = function () { location.href = '/order?n=' + encodeURIComponent(o.order_number) + '&t=' + o.token; };
    fetch('/api/orders/' + encodeURIComponent(o.order_number) + '/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: o.token,
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      track('purchase', { transaction_id: o.order_number, currency: 'INR', value: o.amount_paise / 100, tax: o.quote.gstPaise / 100,
        items: [{ item_id: o.quote.sku, item_name: o.quote.productName, quantity: o.quote.quantity, price: o.quote.unitPricePaise / 100 }] });
      go();
    }).catch(go);   // the webhook still records the payment; the order page will show it
  }
})();
