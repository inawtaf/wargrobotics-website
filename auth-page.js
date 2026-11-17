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
      if ($('rs-password').value !== $('rs-password2').value) { F.errors(resetForm, { password_confirm: 'The two passwords do not match.' }); return; }
      api('/auth/reset', { method: 'POST', body: { token: token, password: $('rs-password').value, password_confirm: $('rs-password2').value } })
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

  var tablist = document.querySelector('.auth-tabs');
  var rule = document.querySelector('.or-rule');
  var google = $('google-btn');
  var tabs = [$('tab-signin'), $('tab-register')];
  var googleOff = false;

  google.href = '/api/auth/google?next=' + encodeURIComponent(next);
  // Hide Google where it isn't set up (e.g. branch previews) instead of failing after the click.
  api('/products').then(function (p) {
    if (p.google_enabled === false) { googleOff = true; google.hidden = true; rule.hidden = true; }
  }).catch(function () {});
  if (q.get('error')) show(q.get('error'));
  if (q.get('verify') === 'done') show('Your email is confirmed. Sign in to continue.', true);
  if (q.get('verify') === 'expired') show('That confirmation link has expired. Sign in, and send a new one from your account page.');
  if (/^\/order\?/.test(next)) show('Sign in to see your order. Use the account the order email was sent to.', true);
  if (next === '/checkout') show('Sign in or create an account to place your order. Your cart is kept.', true);

  /* Forgot is not a third tab — it replaces the chooser entirely. A two-tab
     list cannot honestly describe three panels, and this one used to report
     "Sign in" as selected while the Forgot form was the one on screen. */
  function tab(which, keepFocus) {
    var isReg = which === 'register', isForgot = which === 'forgot';
    tabs[0].setAttribute('aria-selected', String(!isReg));
    tabs[1].setAttribute('aria-selected', String(isReg));
    tabs.forEach(function (t) { t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });
    tablist.hidden = isForgot;
    if (!googleOff) { google.hidden = isForgot; rule.hidden = isForgot; }
    signin.hidden = isReg || isForgot;
    register.hidden = !isReg;
    forgot.hidden = !isForgot;
    if (keepFocus) return;
    var first = (isForgot ? forgot : isReg ? register : signin).querySelector('input');
    if (first) first.focus();
  }
  tabs[0].onclick = function () { tab('signin'); };
  tabs[1].onclick = function () { tab('register'); };
  // Real tabs are a single tab stop with arrow keys between them.
  tablist.addEventListener('keydown', function (e) {
    var i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
          : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    n = (n + tabs.length) % tabs.length;
    tab(n === 1 ? 'register' : 'signin', true);
    tabs[n].focus();
  });
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
    e.preventDefault(); F.clear(register);
    if ($('re-password').value !== $('re-password2').value) { F.errors(register, { password_confirm: 'The two passwords do not match.' }); return; }
    busy(register, true);
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
