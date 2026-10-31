/* Sign in, create account, forgot password (login.html) and reset (reset.html). */
(function () {
  var F = window.WargForm, api = window.WargApi;
  var q = new URLSearchParams(location.search);
  var next = q.get('next') || '/account';
  if (!/^\/(?!\/)/.test(next)) next = '/account';
  function $(id) { return document.getElementById(id); }
  function go() { location.href = next; }

  // ---------------------------------------------------------------- reset.html
  var resetForm = $('reset-form');
  if (resetForm) {
    var token = q.get('token');
    if (!token) { F.status(resetForm, 'This link is incomplete. Use the link in your email, or ask for a new one.', 'bad'); }
    resetForm.addEventListener('submit', function (e) {
      e.preventDefault(); F.clear(resetForm);
      api('/auth/reset', { method: 'POST', body: { token: token, password: $('rs-password').value } })
        .then(function () { location.href = '/account?reset=done'; })
        .catch(function (err) { F.fail(resetForm, err); });
    });
    return;
  }

  // ---------------------------------------------------------------- login.html
  var signin = $('signin-form'), register = $('register-form'), forgot = $('forgot-form');
  var banner = $('auth-banner');
  function show(msg, ok) { banner.hidden = !msg; banner.textContent = msg || ''; banner.className = 'banner' + (ok ? ' ok' : ''); }

  // Already signed in? Skip the page.
  window.WargMe().then(function (d) { if (d.user) go(); });

  $('google-btn').href = '/api/auth/google?next=' + encodeURIComponent(next);
  // Hide Google where it isn't set up (e.g. branch previews) instead of failing after the click.
  api('/products').then(function (p) {
    if (p.google_enabled === false) { $('google-btn').hidden = true; document.querySelector('.or-rule').hidden = true; }
  }).catch(function () {});
  if (q.get('error')) show(q.get('error'));
  if (next === '/checkout') show('Sign in or create an account to place your order. Your cart is kept.', true);

  function tab(which) {
    var isReg = which === 'register';
    $('tab-signin').setAttribute('aria-selected', String(!isReg));
    $('tab-register').setAttribute('aria-selected', String(isReg));
    signin.hidden = isReg || which === 'forgot';
    register.hidden = !isReg;
    forgot.hidden = which !== 'forgot';
    var first = (isReg ? register : which === 'forgot' ? forgot : signin).querySelector('input');
    if (first) first.focus();
  }
  $('tab-signin').onclick = function () { tab('signin'); };
  $('tab-register').onclick = function () { tab('register'); };
  $('show-forgot').onclick = function () { $('fo-email').value = $('si-email').value; tab('forgot'); };
  $('back-signin').onclick = function () { tab('signin'); };
  if (location.hash === '#register') tab('register');
  if (location.hash === '#forgot') tab('forgot');

  function busy(form, on) { var b = form.querySelector('button[type="submit"]'); b.disabled = on; }

  signin.addEventListener('submit', function (e) {
    e.preventDefault(); F.clear(signin); busy(signin, true);
    api('/auth/login', { method: 'POST', body: F.values(signin) })
      .then(go)
      .catch(function (err) { busy(signin, false); F.fail(signin, err); });
  });

  register.addEventListener('submit', function (e) {
    e.preventDefault(); F.clear(register); busy(register, true);
    api('/auth/register', { method: 'POST', body: F.values(register) })
      .then(function (d) {
        if (window.wargTrack) window.wargTrack('sign_up', { method: 'email' });
        // Stay on this page and ask them to confirm the email before going on.
        var panel = $('verify-panel');
        register.hidden = true; signin.hidden = true; forgot.hidden = true;
        document.querySelector('.auth-tabs').hidden = true;
        $('google-btn').hidden = true; document.querySelector('.or-rule').hidden = true;
        panel.hidden = false;
        $('vp-text').textContent = d.verification_sent === false ? '' : 'We have sent a confirmation link to ' + d.user.email + '. It can take a minute; check spam too.';
        if (d.verification_sent === false) F.status(panel, d.verification_error, 'bad');
        $('vp-continue').href = next + (next.indexOf('?') < 0 ? '?' : '&') + 'welcome=1';
      })
      .catch(function (err) { busy(register, false); F.fail(register, err); });
  });

  $('vp-resend').onclick = function () {
    var panel = $('verify-panel');
    api('/auth/resend-verification', { method: 'POST' })
      .then(function (d) { F.status(panel, 'Sent again to ' + (d.sent_to || 'your email') + '. Check your inbox and spam folder.', 'ok'); })
      .catch(function (err) { F.status(panel, err.message, 'bad'); });
  };

  forgot.addEventListener('submit', function (e) {
    e.preventDefault(); F.clear(forgot); busy(forgot, true);
    api('/auth/forgot', { method: 'POST', body: F.values(forgot) })
      .then(function (d) { busy(forgot, false); F.status(forgot, d.message, 'ok'); })
      .catch(function (err) { busy(forgot, false); F.fail(forgot, err); });
  });
})();
