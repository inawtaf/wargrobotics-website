/* Site-wide account helpers, loaded on every page.
   - Adds "Sign in" / "Account" and "Cart (n)" to the header.
   - WargCart: one cart API whether signed in (server cart) or not (this browser,
     moved into the account at sign-in).
   - WargApi: fetch wrapper for /api that sends JSON and reads errors. */
(function () {
  var LOCAL_KEY = 'warg_cart';
  var me = null, mePromise = null;

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch('/api' + path, init).then(function (r) {
      return r.text().then(function (t) {
        var d = {}; try { d = t ? JSON.parse(t) : {}; } catch (e) {}
        if (!r.ok) { var err = new Error(d.error && d.error !== 'validation' ? d.error : 'Please check the highlighted fields.'); err.status = r.status; err.data = d; throw err; }
        return d;
      });
    });
  }

  // ---------------------------------------------------------------- local cart
  function readLocal() {
    try { var v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function writeLocal(items) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); } catch (e) {} }
  function localCount() { return readLocal().reduce(function (s, i) { return s + (i.quantity || 0); }, 0); }

  function whoami() {
    if (!mePromise) {
      mePromise = api('/me').then(function (d) {
        me = d.user;
        // Signed in with things in this browser's cart: move them into the account.
        var local = readLocal();
        if (me && local.length) {
          return api('/cart/add', { method: 'POST', body: { items: local } }).then(function (c) {
            writeLocal([]);
            d.cart_count = (c.items || []).reduce(function (s, i) { return s + i.quantity; }, 0);
            return d;
          }).catch(function () { return d; });
        }
        return d;
      }).catch(function () { return { user: null, cart_count: 0 }; });
    }
    return mePromise;
  }

  var cart = {
    add: function (sku, quantity) {
      quantity = quantity || 1;
      return whoami().then(function (d) {
        if (d.user) return api('/cart/add', { method: 'POST', body: { sku: sku, quantity: quantity } }).then(function (c) { setCount(sumItems(c.items)); return c; });
        var items = readLocal(), found = false;
        var room = 9 - localCount(), take = Math.max(0, Math.min(quantity, room));
        if (take) {
          items.forEach(function (i) { if (i.sku === sku) { i.quantity += take; found = true; } });
          if (!found) items.push({ sku: sku, quantity: take });
          writeLocal(items); setCount(localCount());
        }
        return { items: items, trimmed: take < quantity };
      });
    },
    // Replace the whole cart.
    set: function (items) {
      return whoami().then(function (d) {
        if (d.user) return api('/cart', { method: 'PUT', body: { items: items } }).then(function (c) { setCount(sumItems(c.items)); return c; });
        writeLocal(items); setCount(localCount());
        return { items: items };
      });
    },
    // Items plus a price quote (state_code optional, for the GST split).
    get: function (stateCode) {
      return whoami().then(function (d) {
        if (d.user) return api('/cart' + (stateCode ? '?state_code=' + stateCode : ''));
        var items = readLocal();
        if (!items.length) return { items: [], quote: null };
        return api('/quote', { method: 'POST', body: { items: items, state_code: stateCode || '' } })
          .then(function (q) { return { items: items, quote: q.quote }; })
          .catch(function (e) { return { items: items, quote: null, error: e.message }; });
      });
    }
  };
  function sumItems(items) { return (items || []).reduce(function (s, i) { return s + i.quantity; }, 0); }

  // ---------------------------------------------------------------- header
  var countEl = null;
  function setCount(n) { if (countEl) { countEl.textContent = n; countEl.hidden = !n; } }

  function header() {
    var bar = document.querySelector('.nav .wrap');
    if (!bar || bar.querySelector('.nav-acct')) return;
    var box = document.createElement('div');
    box.className = 'nav-acct';
    var acct = document.createElement('a');
    acct.href = '/login'; acct.textContent = 'Sign in';
    var c = document.createElement('a');
    c.href = '/cart'; c.className = 'nav-cart'; c.setAttribute('aria-label', 'Cart');
    c.innerHTML = 'Cart <span class="nav-cart-n" hidden>0</span>';
    countEl = c.querySelector('.nav-cart-n');
    box.appendChild(acct); box.appendChild(c);
    var buy = bar.querySelector('.nav-buy');
    bar.insertBefore(box, buy || null);
    if (!bar.querySelector('.nav-links')) box.classList.add('push');
    setCount(localCount());
    whoami().then(function (d) {
      if (d.user) {
        acct.href = '/account'; acct.textContent = 'Account'; setCount(d.cart_count || 0);
        if (d.user.is_staff) { var portal = document.createElement('a'); portal.href = '/admin'; portal.textContent = 'Portal'; box.insertBefore(portal, acct); }
      }
      else {
        acct.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
        setCount(localCount());
      }
    });
  }

  // ---------------------------------------------------------------- forms
  var form = {
    clear: function (f) {
      Array.prototype.forEach.call(f.querySelectorAll('.err'), function (el) { el.remove(); });
      Array.prototype.forEach.call(f.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
      form.status(f, '');
    },
    errors: function (f, fields) {
      var first = null;
      Object.keys(fields || {}).forEach(function (name) {
        var input = f.querySelector('[name="' + name + '"]');
        if (!input) return;
        var p = document.createElement('p');
        p.className = 'err'; p.id = f.id + '-err-' + name; p.textContent = fields[name];
        (input.closest('.field') || input.closest('fieldset') || input.parentNode).appendChild(p);
        input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', p.id);
        if (!first) first = input;
      });
      if (first) first.focus();
    },
    status: function (f, msg, cls) {
      var el = f.querySelector('.form-status');
      if (!el) return;
      el.className = 'form-status' + (msg && cls ? ' ' + cls : '');
      el.textContent = msg || '';
    },
    // Shows server errors on a form: field messages if any, else the message.
    fail: function (f, err) {
      if (err.data && err.data.fields) { form.errors(f, err.data.fields); form.status(f, 'Please check the highlighted fields.', 'bad'); }
      else form.status(f, err.message || 'Something went wrong. Please try again.', 'bad');
    },
    values: function (f) {
      var out = {};
      new FormData(f).forEach(function (v, k) { out[k] = typeof v === 'string' ? v : ''; });
      return out;
    }
  };

  window.inr = function (paise) {
    return '\u20b9' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  window.WargForm = form;
  window.WargApi = api;
  window.WargCart = cart;
  window.WargMe = whoami;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', header); else header();
})();
