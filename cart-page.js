/* Cart page: works signed in (server cart) or signed out (this browser). */
(function () {
  var cart = window.WargCart;
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
      card.querySelector('.card-meta').textContent = l.line + (l.priceType === 'offer' ? ' · offer price' : '');
      card.querySelector('.qty span').textContent = l.quantity;
      var price = card.querySelector('.cart-price');
      if (l.priceType === 'offer') { var s = document.createElement('s'); s.textContent = window.inr(l.listPricePaise * l.quantity); price.appendChild(s); }
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
    $('c-subtotal').textContent = window.inr(q.subtotalPaise);
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

  function add(sku) {
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
