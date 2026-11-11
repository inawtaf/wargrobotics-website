/* ---- Google Analytics 4 ------------------------------------------------
   One file, loaded in the <head> of every page, so the ID lives in one place.

   What it sends:
     page_view     automatic, once per page load (from gtag 'config')
     button_click  every <button>, every a.btn, anything with role="button"
     email_click   every mailto: link
     generate_lead a contact / support / pre-book form that passed validation
                   (fired from warg.js, see wargTrack below)

   Nothing typed into a form (names, emails, messages) is ever sent to Google;
   GA's terms forbid personal data and we have no reason to collect it.

   Add ?ga_debug=1 to any URL to see events live in GA > Admin > DebugView.

   ---- Cloudflare Web Analytics ------------------------------------------
   The second, cookieless page-view counter. It has NO code here on purpose:
   with Web Analytics "automatic setup" on for the wargrobotics.com zone,
   Cloudflare's edge adds its beacon (static.cloudflareinsights.com) to every
   HTML page it serves. Set up in Cloudflare: Analytics & Logs > Web Analytics
   > Add a site > pick the wargrobotics.com domain.
   Don't also paste Cloudflare's manual snippet into the pages: Cloudflare
   allows only one beacon per page. Compare its visitor count with GA's to
   see roughly how much GA loses to ad blockers (some blockers drop both). */
(function(){
  /* GA4 needs the web stream's MEASUREMENT ID (starts with "G-"), not the
     account or property number. GA > Admin > Data streams > your site. */
  var GA_ID = 'G-F3VKP1R1E3';

  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ dataLayer.push(arguments); };

  /* Safe for warg.js to call whether or not GA is configured. */
  window.wargTrack = function(name, params){
    try { gtag('event', name, params || {}); } catch(e){}
  };

  if(!/^G-[A-Z0-9]+$/.test(GA_ID) || GA_ID === 'G-XXXXXXXXXX'){
    if(window.console) console.warn('analytics.js: set GA_ID to your G- measurement ID');
    return;
  }

  /* ---- consent --------------------------------------------------------
     GA4 sets cookies, so nothing of it loads until the visitor says yes, and
     a no is remembered. Cloudflare Web Analytics keeps counting either way:
     it is cookieless and added at the edge, so basic traffic numbers never
     depend on this answer. The choice lives in localStorage, not a cookie,
     so declining sets nothing at all. */
  var KEY = 'warg_analytics_consent';
  function consent(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } }
  function remember(v){ try { localStorage.setItem(KEY, v); } catch(e){} }

  /* Saying no has to undo as well as prevent: anyone who visited before this
     gate existed already carries _ga cookies, and leaving them would make the
     refusal cosmetic. Cleared on every load while the answer is no. */
  function clearGa(){
    var host = location.hostname;
    document.cookie.split(';').map(function(c){ return c.split('=')[0].trim(); })
      .filter(function(n){ return n === '_ga' || n === '_gid' || n.indexOf('_ga_') === 0; })
      .forEach(function(n){
        ['', '; domain=' + host, '; domain=.' + host].forEach(function(d){
          document.cookie = n + '=; Max-Age=0; path=/' + d;
        });
      });
  }

  function banner(){
    var box = document.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Analytics consent');
    var p = document.createElement('p');
    p.className = 'consent-text';
    p.innerHTML = 'We would like to use Google Analytics to see which pages get used. ' +
      'It sets cookies. We count visitors without cookies either way, so you lose nothing by saying no. ' +
      '<a href="/privacy">Privacy policy</a>.';
    var row = document.createElement('div');
    row.className = 'consent-row';
    var yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'btn btn-solid'; yes.textContent = 'Accept';
    var no = document.createElement('button');
    no.type = 'button'; no.className = 'btn btn-line'; no.textContent = 'No thanks';
    yes.onclick = function(){ remember('yes'); box.remove(); start(); };
    no.onclick = function(){ remember('no'); box.remove(); clearGa(); };
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(p); box.appendChild(row);
    document.body.appendChild(box);
  }

  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  if(consent() === 'yes') start();
  else if(consent() === 'no') clearGa();
  else ready(banner);
  return;

  function start(){

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);

  gtag('js', new Date());
  var cfg = {};
  if(/[?&]ga_debug=1\b/.test(location.search)) cfg.debug_mode = true;
  gtag('config', GA_ID, cfg);

  function labelOf(el){
    var t = el.getAttribute('aria-label') || el.textContent || el.value || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  function sectionOf(el){
    var sec = el.closest('section[id], nav, header, footer, dialog, [role="dialog"], form[id]');
    if(!sec) return '';
    return sec.id || sec.tagName.toLowerCase();
  }

  /* Capture phase: runs before warg.js handlers, so a preventDefault or
     stopPropagation there can never hide a click from analytics. */
  document.addEventListener('click', function(e){
    var el = e.target.closest && e.target.closest('a, button, [role="button"], input[type="submit"], input[type="button"]');
    if(!el) return;

    var href = el.tagName === 'A' ? (el.getAttribute('href') || '') : '';

    if(/^mailto:/i.test(href)){
      wargTrack('email_click', {
        email_address: href.replace(/^mailto:/i, '').split('?')[0],
        page_section: sectionOf(el)
      });
      return;
    }

    var isButton = el.tagName !== 'A' || el.classList.contains('btn') || el.getAttribute('role') === 'button';
    if(!isButton) return;

    wargTrack('button_click', {
      button_text: labelOf(el),
      button_id: el.id || '',
      button_target: href || el.getAttribute('aria-controls') || el.type || '',
      page_section: sectionOf(el)
    });
  }, true);

  }   /* end start() — nothing above runs until consent is given */
})();
