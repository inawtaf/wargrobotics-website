Warg Robotics website — design pass returned
============================================
9 November 2026. Based on the bundle you sent on 3 November.

Same file names and the same class names your scripts hook into, as asked. The
commerce JS (site.js, cart-page.js, checkout.js, auth-page.js, account-page.js)
is still yours — changes to it are listed below and are small and deliberate.


THREE THINGS TO DECIDE BEFORE THIS GOES LIVE
--------------------------------------------
1. The home page has a "What owners say" section whose four cards are
   PLACEHOLDER COPY, marked as such on each card in amber. They are briefs for
   reviews that still need collecting, not reviews. Replace them with real,
   attributable quotes and delete the .review-tag line on each card, or delete
   the section. It must not go live as it stands.

2. "Range up to 5 km" appears on four pages with no caveat anywhere on the site
   that 500 m is the DGCA limit for this class of operation in India. The
   caveat used to travel with the figure and was lost when the notes blocks
   were removed. Your call, but it should be a deliberate one.

3. The coupon is hardcoded in the markup — WARG20 and "20% off" appear in six
   places across three pages, while the cart and checkout read the live coupon
   from /api/products. When the promotion changes or lapses, those pages will
   be wrong. Worth driving them from the API too.


WHAT CHANGED
------------
New pages
  web-app.html     The ground station web app. Its content was previously
                   duplicated byte-for-byte on both product pages.
  robots.txt       Crawlers kept out of cart, checkout, account, order, login,
                   reset, admin and /api.
  sitemap.xml      The ten indexable pages.

Home page
  Section order is now hero, key specs, products, features, web app, reviews,
  contact. "Meet our Wargs" moved up to sit under the key specs.
  Removed "Where the sixty milliseconds goes" and "What can it do", with the
  nav and footer links to them.
  Product cards: pricing cut from five pieces to three (the coupon line and the
  combo cross-sell went; the combo is still in the comparison table and the
  cart). Each card now has two actions, Buy now and Learn more — previously the
  only link went straight to the cart, so neither product page was reachable
  from the listing.
  The hero wordmark is now artwork (img/wordmark.svg) rather than Space
  Grotesk, matching the rounded letterforms in the updated logo.
  Gradients removed: the key specs section was a nine-stop ramp with ~290px of
  empty padding, and the hero had a tall fade at its foot.

Product pages (both, ~30 KB down to ~23 KB)
  The web app and on-screen display sections moved to web-app.html; a short
  section with a link replaces them.
  "Product information" (MRP, origin, manufacturer, warranty, returns) is
  closed by default. It was open, which pushed the hero 588px past the fold.
  The at-a-glance spec dropped air unit weight and FOV — identical on both
  units, and both still in the full specification below.
  The three buttons under the comparison did three different things: one
  linked to the page you were already on, one navigated away, one added to the
  cart. All three now add to the cart; the link to the other unit is a text
  link beneath them.

Cart, checkout, login, reset, account
  Cart: product thumbnails, unit prices, a combo suggestion that appears only
  when it applies, a composed empty state, and a sticky total on phones.
  Checkout: a 1-2-3 step indicator, the duplicate totals table at the review
  step removed, and a sticky total on phones (the summary sat after about
  fifteen address fields).
  Login: real tab semantics, and "Forgot password" no longer leaves the tab
  strip claiming "Sign in" is selected.
  Account: "Delete your account" separated into its own block — it was a
  fourth identical outlined button beside "Sign out".
  Status pills moved onto the brand palette; they had six hardcoded hex values.

Site-wide
  All 19 pages now have a doctype and <html lang>. Ten had no <html>, <head> or
  <body> at all and were rendering in quirks mode.
  One ?v= cache string across every page.
  One URL convention: root-relative and extensionless, as your commerce pages
  already used.
  No inline style attributes on any page.
  Google Analytics is now behind a consent banner. It loads nothing until the
  visitor accepts, a decline is remembered, and declining clears any _ga
  cookies already set. Cloudflare Web Analytics is cookieless and unaffected.
  The banner wording has not been through legal.
  og:image is absolute, and every indexable page has a canonical and og:url.

Changes to your JavaScript
  site.js         window.inr prints whole rupees without ".00"; amounts that
                  are not whole still show both places. Affects cart,
                  checkout, order, account and the portal.
                  The nav cart link's accessible name now includes the count —
                  a fixed aria-label="Cart" was hiding it from screen readers.
  cart-page.js    Rewritten line rendering: thumbnails, unit price, and
                  accessible names that carry the product ("Remove Ghost from
                  cart"). The list is no longer an aria-live region; a short
                  status line announces changes instead.
  checkout.js     Step state, summary line prices, and the review's per-line
                  figures. ASK US ABOUT THIS ONE: the review paired
                  unitPricePaise with listSubtotalPaise, printing
                  "Ghost x 2 @ Rs 19,999" against Rs 45,998. We now derive the
                  unit price from the amount in the same row so it always
                  agrees — but which value unitPricePaise is meant to be, list
                  or post-discount, is your call.
  account-page.js Order cards, the address business-invoice disclosure, and a
                  shared state-name lookup — renderOrder was printing the bare
                  GST state code, so an address read "Panaji, 30 403001".
  warg.js         The detail-popup binder now selects .car-more[aria-controls]
                  rather than every .car-more. It was calling preventDefault on
                  anything wearing the class, which silently stopped plain
                  links navigating.

Not touched
  admin.html, portal.css and portal.js are exactly as you sent them.


LOOKING AT IT LOCALLY
---------------------
The pages link root-relative, extensionless URLs (/cart, /support, /ghost), the
same as your live site. A plain static server will 404 those — your server
already rewrites them, so this only affects local preview. python3 -m
http.server will not resolve them.

The commerce pages talk to /api, so without your backend they will draw their
layout and then sit empty or report an error. Screenshots from wargrobotics.com
remain the best reference for those.

img/bw.png — the dark wordmark used on light grounds — has NOT had the rounded
letterform update, so it does not yet match the nav logo. It is also still a
quarter-scale export.
