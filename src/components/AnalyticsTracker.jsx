import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '@/lib/analytics';

// gtag.js only fires a page_view automatically on the very first load.
// Since this is a single-page app, every route change after that needs
// an explicit page_view event, or subsequent pages never show up in GA.
export default function AnalyticsTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    trackPageView(pathname + search, document.title);
  }, [pathname, search]);

  return null;
}
