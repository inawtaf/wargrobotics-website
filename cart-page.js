/* Cart page: works signed in (server cart) or signed out (this browser). */
(function () {
  var cart = window.WargCart, api = window.WargApi;
  var MAX = 9;
  var lines = document.getElementById('cart-lines');
  var summary = document.getElementById('cart-summary');
  var banner = document.getElementById('cart-banner');
  var live = document.getElementById('cart-live');
  var foot = document.getElementById('cart-foot');
  var bar = document.getElementById('cart-bar');
  var items = [];

  // The product cards double as cart thumbnails: all three are pre-composed
  // onto a common transparent 4:3 canvas, so they sit in one slot uncropped.
  var IMG = {
    ghost: 'img/card-ghost.webp',
    greywind: 'img/card-greywind.webp',
    raven: 'img/card-raven.webp'
  };

  function $(id) { return document.getElementById(id); }
  function note(msg) { banner.hidden = !msg; banner.textContent = msg || ''; }
  // One short sentence per change. The list itself is not a live region —
  // its contents are replaced wholesale, which read the whole cart back.
  function say(msg) { if (live) live.textContent = msg || ''; }

  function arrow(glyph, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'car-arr';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    return b;
  }

  function lineEl(l, total) {
    var el = document.createElement('div');
    el.className = 'card cart-line';

    if (IMG[l.sku]) {
      var img = document.createElement('img');
      img.className = 'cart-thumb';
      img.src = IMG[l.sku];
      img.alt = '';                 // the name is right beside it
      // Not lazy: a cart holds at most nine small images and every one of
      // them is at the top of the page.
      img.width = 76; img.height = 57; img.decoding = 'async';
      el.appendChild(img);
    }

    var id = document.createElement('div');
    id.className = 'cart-id';
    var name = document.createElement('p');
    name.className = 'cart-name';
    name.textContent = l.productName;
    id.appendChild(name);
    if (l.line) {
      var cfg = document.createElement('p');
      cfg.className = 'cart-unit';
      cfg.textContent = l.line;
      id.appendChild(cfg);
    }
    // Say the unit price, so a quantity above one does not need dividing.
    var unit = l.unitPricePaise || Math.round(l.subtotalPaise / Math.max(1, l.quantity));
    var each = document.createElement('p');
    each.className = 'cart-unit';
    each.textContent = window.inr(unit) + ' each';
    id.appendChild(each);
    if (l.discountLabel) {
      var off = document.createElement('p');
      off.className = 'cart-off';
      off.textContent = l.discountLabel;
      id.appendChild(off);
    }
    el.appendChild(id);

    // Quantity: the carousel's own square control, not a native number input.
    // Every accessible name carries the product, because two lines otherwise
    // give a screen reader two identical "One more" buttons.
    var qty = document.createElement('div');
    qty.className = 'qty';
    var minus = arrow('−', 'One fewer ' + l.productName);
    var out = document.createElement('output');
    out.textContent = l.quantity;
    out.setAttribute('aria-label', l.productName + ', quantity');
    var plus = arrow('+', 'One more ' + l.productName);
    plus.disabled = total >= MAX;
    if (plus.disabled) plus.title = 'Orders are limited to ' + MAX + ' units';
    minus.onclick = function () { change(l, -1); };
    plus.onclick = function () { change(l, +1); };
    qty.appendChild(minus); qty.appendChild(out); qty.appendChild(plus);
    el.appendChild(qty);

    var right = document.createElement('div');
    right.className = 'cart-right';
    var price = document.createElement('p');
    price.className = 'cart-price';
    if (l.discountPaise) {
      var s = document.createElement('s');
      s.textContent = window.inr(l.listSubtotalPaise);
      price.appendChild(s);
    }
    price.appendChild(document.createTextNode(window.inr(l.subtotalPaise)));
    right.appendChild(price);
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'link-more';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', 'Remove ' + l.productName + ' from cart');
    rm.onclick = function () { change(l, -l.quantity); };
    right.appendChild(rm);
    el.appendChild(right);

    return el;
  }

  /* The combo is a real saving the buyer has not taken. Offer it only when it
     applies, in the hairline stack, and without naming a figure the quote has
     not given us. */
  function suggestEl(q, total) {
    if (q.comboPairs || total >= MAX) return null;
    var have = {};
    q.lines.forEach(function (l) { have[l.sku] = true; });
    var sku = have.ghost && !have.greywind ? 'greywind'
            : have.greywind && !have.ghost ? 'ghost' : null;
    if (!sku) return null;

    var el = document.createElement('div');
    el.className = 'cart-suggest';
    var p = document.createElement('p');
    p.textContent = 'Ghost and Greywind cost less bought together.';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-line';
    b.textContent = sku === 'ghost' ? 'Add a Ghost' : 'Add a Greywind';
    b.onclick = function () { add(sku); };
    el.appendChild(p); el.appendChild(b);
    return el;
  }

  function renderEmpty() {
    lines.className = '';   // no hairline frame around a single panel
    lines.innerHTML = '<div class="empty">' +
      '<p class="empty-h">Your cart is empty</p>' +
      '<p>Ghost and Greywind are on sale now.</p>' +
      '<a class="btn btn-solid" href="/#products">See the cameras</a>' +
      '</div>';
    summary.hidden = true;
    if (foot) foot.hidden = true;
    if (bar) bar.hidden = true;
  }

  function render(data) {
    items = data.items || [];
    var q = data.quote;
    lines.innerHTML = '';
    if (data.error) note(data.error);
    if (!items.length || !q) return renderEmpty();

    lines.className = 'cards';
    var total = items.reduce(function (s, i) { return s + i.quantity; }, 0);
    q.lines.forEach(function (l) { lines.appendChild(lineEl(l, total)); });
    var sug = suggestEl(q, total);
    if (sug) lines.appendChild(sug);

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
        ? 'Combo price applied. (It beats the ' + coupon.code + ' coupon, so the coupon isn’t needed.)'
        : 'Coupon ' + coupon.code + ': ' + coupon.percent + '% off, valid until ' + coupon.valid_until_text + '. Apply it at checkout.';
    } else hint.hidden = true;
    $('c-gst').textContent = window.inr(q.gstPaise);
    $('c-round').hidden = !q.roundOffPaise;
    $('c-round-v').textContent = window.inr(q.roundOffPaise || 0);
    $('c-total').textContent = window.inr(q.totalPaise);
    summary.hidden = false;
    if (foot) foot.hidden = false;
    if (bar) { bar.hidden = false; $('cart-bar-total').textContent = window.inr(q.totalPaise); }
  }

  function change(l, delta) {
    var left = l.quantity + delta;
    var next = items.map(function (i) { return { sku: i.sku, quantity: i.sku === l.sku ? i.quantity + delta : i.quantity }; })
      .filter(function (i) { return i.quantity > 0; });
    cart.set(next).then(load).then(function () {
      say(left > 0 ? l.productName + ', quantity ' + left + '.' : l.productName + ' removed from your cart.');
    }).catch(function (e) { note(e.message); });
  }

  function load() { return cart.get().then(render); }

  // Checkout needs an account; signed-out visitors sign in first (cart is kept).
  // Both the summary button and the phone bar run through here, and both say
  // they are working — the account check is a round trip.
  Array.prototype.forEach.call(document.querySelectorAll('[data-checkout]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (a.getAttribute('aria-busy') === 'true') return;
      var was = a.textContent;
      a.setAttribute('aria-busy', 'true');
      a.textContent = 'One moment…';
      window.WargMe().then(function (d) {
        location.href = d.user ? '/checkout' : '/login?next=%2Fcheckout';
      }).catch(function () {
        a.removeAttribute('aria-busy');
        a.textContent = was;
        note('Could not reach the server. Try again in a moment.');
      });
    });
  });

  // Coupon details for the hint under the summary.
  var coupon = null;
  api('/products').then(function (p) { coupon = p.coupon; if (items.length) load(); }).catch(function () {});

  function add(sku) {
    if (sku === 'combo') return cart.add('ghost', 1).then(function () { return add('greywind'); });
    return cart.add(sku, 1).then(function (r) {
      note(r && r.trimmed ? 'Orders are limited to ' + MAX + ' units, so not everything was added.' : 'Added to your cart.');
      if (window.wargTrack) window.wargTrack('add_to_cart', { items: [{ item_id: sku, quantity: 1 }] });
      return load();
    }).catch(function (e) { note(e.message); });
  }

  // /cart?add=ghost (the "Buy" buttons on product pages)
  var addSku = new URLSearchParams(location.search).get('add');
  if (addSku) { history.replaceState(null, '', '/cart'); add(addSku); } else load();
})();
