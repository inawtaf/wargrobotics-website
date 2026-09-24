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

   Add ?ga_debug=1 to any URL to see events live in GA > Admin > DebugView. */
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
})();
