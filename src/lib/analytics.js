// Thin wrapper around gtag.js. The gtag.js script itself is loaded in index.html.
// Safe to call even if analytics hasn't loaded (e.g. blocked by an ad blocker).

export function trackPageView(path, title) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: window.location.href,
  });
}

export function trackEvent(name, params = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}
