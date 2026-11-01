/* Cart page: works signed in (server cart) or signed out (this browser). */
(function () {
  var cart = window.WargCart, api = window.WargApi;
  var MAX = 9;
  var lines = document.getElementById('cart-lines');
  var summary = document.getElementById('cart-summary');
  var banner = document.getElementById('cart-banner');
  var items = [];
  function $(id) { return document.getElementById(id); }
  function note(msg) { banner.hidden = !msg; banner.textContent = msg || ''; }

  function render(data) {
    items = data.items || [];
    var q = data.quote;
    lines.innerHTML = '';
    if (data.error) note(data.error);
    if (!items.length || !q) {
      lines.innerHTML = '<div class="empty">Your cart is empty. <a href="/#products">See the cameras</a>.</div>';
      summary.hidden = true;
      return;
    }
    var total = items.reduce(function (s, i) { return s + i.quantity; }, 0);
    q.lines.forEach(function (l) {
      var card = document.createElement('div');
      card.className = 'card cart-line';
      card.innerHTML = '<div><p class="card-title"></p><p class="card-meta"></p></div>' +
        '<div class="qty"><button type="button" aria-label="One fewer">−</button><span></span><button type="button" aria-label="One more">+</button></div>' +
        '<div class="cart-price"></div>';
      card.querySelector('.card-title').textContent = l.productName;
      card.querySelector('.card-meta').textContent = l.line + (l.discountLabel ? ' · ' + l.discountLabel : '');
      card.querySelector('.qty span').textContent = l.quantity;
      var price = card.querySelector('.cart-price');
      if (l.discountPaise) { var s = document.createElement('s'); s.textContent = window.inr(l.listSubtotalPaise); price.appendChild(s); }
      price.appendChild(document.createTextNode(window.inr(l.subtotalPaise)));
      var btns = card.querySelectorAll('.qty button');
      btns[1].disabled = total >= MAX;
      btns[0].onclick = function () { change(l.sku, -1); };
      btns[1].onclick = function () { change(l.sku, +1); };
      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'link-btn'; rm.textContent = 'Remove';
      rm.onclick = function () { change(l.sku, -l.quantity); };
      card.firstChild.appendChild(rm);
      lines.appendChild(card);
    });
    $('c-subtotal').textContent = window.inr(q.listSubtotalPaise);
    // Discount rows (combo now; the coupon is applied at checkout)
    Array.prototype.forEach.call(document.querySelectorAll('.disc-row'), function (el) { el.remove(); });
    var anchor = $('c-disc-anchor');
    q.discounts.forEach(function (d) {
      var row = document.createElement('div'); row.className = 'disc-row';
      var dt = document.createElement('dt'); dt.textContent = d.label;
      var dd = document.createElement('dd'); dd.textContent = '− ' + window.inr(d.paise);
      row.appendChild(dt); row.appendChild(dd); anchor.parentNode.insertBefore(row, anchor);
    });
    var hint = $('c-coupon');
    if (coupon && coupon.active) {
      hint.hidden = false;
      hint.textContent = (q.comboPairs && q.lines.every(function (l) { return l.quantity === q.comboPairs; }))
        ? 'Combo price applied. (It beats the ' + coupon.code + ' coupon, so the coupon isn\u2019t needed.)'
        : 'Coupon ' + coupon.code + ': ' + coupon.percent + '% off, valid until ' + coupon.valid_until_text + '. Apply it at checkout.';
    } else hint.hidden = true;
    $('c-gst').textContent = window.inr(q.gstPaise);
    $('c-total').textContent = window.inr(q.totalPaise);
    summary.hidden = false;
  }

  function change(sku, delta) {
    var next = items.map(function (i) { return { sku: i.sku, quantity: i.sku === sku ? i.quantity + delta : i.quantity }; })
      .filter(function (i) { return i.quantity > 0; });
    cart.set(next).then(load).catch(function (e) { note(e.message); });
  }

  function load() { return cart.get().then(render); }

  // Checkout needs an account; signed-out visitors sign in first (cart is kept).
  $('to-checkout').addEventListener('click', function (e) {
    e.preventDefault();
    window.WargMe().then(function (d) { location.href = d.user ? '/checkout' : '/login?next=%2Fcheckout'; });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-add]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); add(a.getAttribute('data-add')); });
  });

  // Coupon details for the hint under the summary.
  var coupon = null;
  api('/products').then(function (p) { coupon = p.coupon; if (items.length) load(); }).catch(function () {});

  function add(sku) {
    if (sku === 'combo') return cart.add('ghost', 1).then(function () { return add('greywind'); });
    return cart.add(sku, 1).then(function (r) {
      note(r && r.trimmed ? 'Orders are limited to 9 units, so not everything was added.' : 'Added to your cart.');
      if (window.wargTrack) window.wargTrack('add_to_cart', { items: [{ item_id: sku, quantity: 1 }] });
      return load();
    }).catch(function (e) { note(e.message); });
  }

  // /cart?add=ghost (the "Buy" buttons on product pages)
  var addSku = new URLSearchParams(location.search).get('add');
  if (addSku) { history.replaceState(null, '', '/cart'); add(addSku); } else load();
})();
