# Accounts and orders backend

Customer accounts and online orders for Ghost and Greywind. Customers sign in
with Google or with an email and password, fill a cart, and pay with Razorpay.
Each order is saved, a GST invoice is created in Zoho Books, and the customer
gets emails at each step. In their account they can track orders, download
invoices, reorder, keep saved addresses and raise service requests.

**An account with a confirmed email is required to buy.** Signed-out visitors
can browse and fill a cart (kept in their browser), and it moves into their
account when they sign in.

```
cart.html ─► login.html (Google or email) ─► checkout.html
                                                  │
checkout.html ─► POST /api/orders (cart + address) ─► D1 (order saved) ─► Razorpay order
      │
      └─► Razorpay Checkout (UPI / card / netbanking)
              │
              ├─► POST /api/orders/:n/confirm   (browser, signature checked)
              └─► POST /api/webhooks/razorpay   (Razorpay, the source of truth)
                        │
                        ▼  order marked paid, exactly once
                  Zoho Books: contact ─► invoice ─► sent ─► payment recorded
                        │
                        ▼
                  Resend: confirmation + invoice PDF to buyer, copy to team
                        │
Order portal (/admin) ─► Start processing ─► Ship ─► Delivered   (each step emails the customer)
```

### Which emails go out, and what triggers them

| Email | Sent when | Triggered by |
|---|---|---|
| Order confirmed (GST invoice PDF attached) | Payment is captured | Razorpay webhook or the checkout callback, automatically |
| Invoice (on its own) | The invoice was created after the confirmation went out (Zoho was down) | 15-minute retry job, automatically |
| New order (to the team) | Payment is captured | Automatically, to `ORDER_NOTIFY_EMAIL` |
| We're preparing your order | Staff press **Mark as processing** | Order portal |
| Shipped: tracking, expected date, delivery instructions | Staff press **Mark as shipped**, or save new tracking | Order portal |
| Delivered: report damage within 48 h, get help | Staff press **Mark as delivered** | Order portal |
| Order cancelled: refund on its way | Staff cancel a paid order | Order portal |
| Service request received / updated | Customer opens a request / staff save an update | Account page / order portal |
| Confirm email, reset password, password changed | Sign-up, *Forgot password*, a password change | Automatically |

Every portal action has an **Email the customer** box (ticked by default) and
an optional message that goes into the email. Every step, email and staff note
goes on the order's timeline. The customer sees the status steps and messages
in their account; staff notes stay internal.

The portal can't know when the courier delivers, so staff mark that by hand.
Courier tracking can be connected later (for example Shiprocket webhooks) to
make *Shipped → Delivered* automatic.

If Zoho or Resend fails, the buyer is still confirmed. A cron job retries
every 15 minutes and sends the invoice on its own once it exists.

| Piece | Where |
|---|---|
| Worker code | `src/` (`worker.js` routes; `auth.js` sessions and passwords; `google.js` Google sign-in; `account.js` account API; `orders.js` orders) |
| Database schema | `migrations/0001_orders.sql`, `migrations/0002_accounts.sql` |
| Prices, offer limit, GST rate, states | `src/config.js` |
| Email wording | `src/email.js` |
| Pages | `login.html`, `reset.html`, `cart.html`, `checkout.html`, `order.html`, `account.html`, `admin.html` (order portal: `portal.js`, `portal.css`) |
| Order steps and their emails | `src/fulfilment.js`; portal API in `src/admin.js` |
| Page scripts | `site.js` (header links, cart; on every page), `auth-page.js`, `cart-page.js`, `checkout.js`, `account-page.js` |
| Settings and bindings | `wrangler.jsonc` |

**How sign-in is protected**
- Passwords are hashed with PBKDF2-SHA256, 100,000 rounds (the most Workers
  allows) and a random salt, plus a secret pepper (`AUTH_PEPPER`), so a copy of
  the database alone is not enough to start guessing.
- A session is a random token in an HttpOnly, Secure, SameSite=Lax cookie that
  lasts 30 days. Only its hash is stored.
- Wrong passwords are throttled (10 per email and 50 per network per 15
  minutes). A wrong email and a wrong password get the same message, and
  "forgot password" never reveals whether an account exists.
- Requests that change anything must come from the site itself (an Origin
  check), which blocks other sites submitting forms as a signed-in customer.
- Google sign-in uses the authorisation-code flow with PKCE, state and nonce.
  If Google signs in someone whose email matches an account that was never
  confirmed, that account's password is removed. This stops anyone from
  registering someone else's email in advance and keeping access.
- Changing or resetting a password signs out the account's other devices and
  emails the customer.

Prices exclude GST; 18% is added at checkout. CGST + SGST applies within
Karnataka (`SELLER_STATE`), IGST elsewhere. Delivery is free.

---

## One-time setup

Do these in order. Use Razorpay **test mode** first; switch to live keys only
after a test order has gone through end to end.

### 1. Database (Cloudflare D1)

1. In the Cloudflare dashboard, in the account that has the `wargrobotics-website`
   Worker, go to **Storage & Databases → D1 → Create** and make
   `wargrobotics-orders` and `wargrobotics-orders-preview`.
2. Paste their IDs into `wrangler.jsonc`: the top `database_id`, and the one
   inside `"previews"`.

That's all. **The Worker creates its own tables**: on the first `/api` request
after a deploy, `src/schema.js` applies any migration in `migrations/` that
hasn't run yet. It records them in `d1_migrations` exactly as
`wrangler d1 migrations apply` does, so both methods stay compatible. A branch
preview sets up the preview database the same way.

To change the database later, add `migrations/0003_….sql` **and** list it in
`MIGRATIONS` in `src/schema.js`; the next deploy applies it.

The terminal commands still work if Wrangler is logged in to the same account as
the Worker: `npm run db:whoami`, `npm run db:migrate`, `npm run db:migrate:preview`.

### 2. Razorpay

1. Sign up at razorpay.com and complete KYC. Activation checks that the site has
   Terms, Refund/Cancellation, Shipping, Privacy and Contact pages, so publish
   those first.
2. **Settings → API Keys**: generate test keys. Put the Key ID in `wrangler.jsonc`
   as `RAZORPAY_KEY_ID`; the Key Secret is a secret (step 6).
3. **Settings → Webhooks → Add**:
   - URL: `https://wargrobotics.com/api/webhooks/razorpay`
   - Secret: any long random string, also saved as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `order.paid`, `payment.failed`
4. **Settings → Payment capture**: leave on automatic capture.

### 3. Zoho Books (India)

1. Sign up at zoho.com/in/books (free plan under ₹25 lakh turnover), with your
   GSTIN and Karnataka as the business state.
2. **Items → New**: create **Warg Ghost** and **Warg Greywind** as Goods with
   the HSN code your CA gives you, rate 19999 / 24999, intra-state tax GST18
   and inter-state tax IGST18.
3. API access: go to **api-console.zoho.in → Add Client → Self Client**. Under
   *Generate Code*, use scope `ZohoBooks.fullaccess.all` and 10 minutes, then run:
   ```bash
   node scripts/zoho-setup.mjs token <client_id> <client_secret> <code>
   ```
   This prints `ZOHO_REFRESH_TOKEN` (a secret).
4. Find the IDs for `wrangler.jsonc`:
   ```bash
   node scripts/zoho-setup.mjs ids <client_id> <client_secret> <refresh_token>
   ```
   Copy `ZOHO_ORG_ID`, `ZOHO_TAX_ID_INTRA` (the GST18 group), `ZOHO_TAX_ID_INTER`
   (IGST18), `ZOHO_ITEM_ID_GHOST` and `ZOHO_ITEM_ID_GREYWIND`.
5. Optional: set `ZOHO_DEPOSIT_ACCOUNT_ID` to the bank account Razorpay settles
   into, so payments land in the right ledger. Payments are recorded with the
   payment mode "Bank Transfer"; to use another mode that exists in your Zoho
   Books (for example one called "Razorpay"), set `ZOHO_PAYMENT_MODE`.

### 4. Resend (email)

1. Sign up at resend.com. Under **Domains → Add**, enter `wargrobotics.com`.
2. Add the DNS records it shows in **Cloudflare → DNS** with proxy **off**. Don't
   touch the existing Google MX records.
3. Once verified, create an API key with Sending access: `RESEND_API_KEY`.

Emails come from `orders@wargrobotics.com`, and replies go to
`hello@wargrobotics.com`. Change these with `EMAIL_FROM` and `EMAIL_REPLY_TO`.

### 5. Google sign-in

1. Go to console.cloud.google.com and create a project, for example "Warg website".
2. Open **Google Auth Platform → Branding** (older consoles call it the *OAuth
   consent screen*). Enter the app name "Warg Robotics", your support email,
   the logo, and links to your privacy policy and terms. Under **Audience**,
   choose External and publish the app (no Google review is needed for basic
   sign-in).
3. Open **Clients → Create client → Web application** and add:
   - Authorised JavaScript origins: `https://wargrobotics.com`
   - Authorised redirect URIs: `https://wargrobotics.com/api/auth/google/callback`
4. Copy the Client ID into `wrangler.jsonc` as `GOOGLE_CLIENT_ID`. The Client
   Secret is a secret (step 7).

Sign-in only works on the address in the redirect URI, so make
`wargrobotics.com` the main address (redirect `www` to it, as recommended
earlier).

### 6. Settings in wrangler.jsonc

Replace every `REPLACE` value. The `previews` block uses the Razorpay **test**
key and the preview database, so pull-request builds can never take real money.

### 7. Secrets

Set these for production in **Workers & Pages → wargrobotics-website →
Settings → Variables and Secrets** (type: Secret), or with
`npx wrangler secret put NAME`:

| Secret | What |
|---|---|
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | the webhook secret from step 2 |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | Self Client credentials |
| `ZOHO_REFRESH_TOKEN` | from `zoho-setup.mjs token` |
| `RESEND_API_KEY` | Resend API key |
| `ORDER_LINK_SECRET` | random string, at least 32 characters; signs buyers' order-page links (changing it breaks old links) |
| `ADMIN_TOKEN` | optional: random string, at least 24 characters, for scripts calling the portal API with `Authorization: Bearer`. People don't need it; they sign in. |
| `GOOGLE_CLIENT_SECRET` | from step 5 |
| `AUTH_PEPPER` | random string, at least 32 characters, mixed into every password hash. **Never change it once accounts exist, or every password stops working.** |

Generate random values with `openssl rand -hex 32`.

For previews, set at least `RAZORPAY_KEY_SECRET` (test), `ORDER_LINK_SECRET`
and `AUTH_PEPPER` with `npx wrangler preview secret put NAME`.
Google sign-in won't work on preview addresses, because they aren't in
Google's redirect list; use email sign-in there.

**Staff access to the order portal:** put the staff email addresses in
`ADMIN_EMAILS` in `wrangler.jsonc` (comma-separated; it starts as
`hello@wargrobotics.com`). Each person signs in at `/login` with that address,
by Google or by password, and opens `/admin`. The email must be confirmed.
To remove someone, take them off the list and deploy.

### 8. Deploy and test

Push to `main`. Then, with Razorpay still in test mode:

1. Create an account at `/login`, confirm the email, and sign out and in again,
   both with the password and with Google.
2. Add a Ghost to the cart and buy it at `/checkout` with a Razorpay test card
   or UPI ID.
3. Check that the order page says *Thank you*, the invoice appears in Zoho
   Books as paid, and the confirmation email arrives with the PDF attached.
4. Open `/account`: the order, its invoice download and *Buy again* should all
   work. Raise a service request.
5. Sign in as a staff address and open `/admin`. Work the order through
   *processing → shipped → delivered*, and update the service request. Check
   that each email arrives.
6. Switch to live: put the live Key ID in `wrangler.jsonc`, update
   `RAZORPAY_KEY_SECRET`, add the webhook again in live mode, and redeploy.
   Delete or void the test invoices in Zoho.

---

## Running the business

Day to day, everything happens in the **order portal** at `/admin`. Staff also
see a *Portal* link in the site header.

- **The top tiles** show how many orders are *To process* (paid, not started),
  *Processing*, *Shipped* and *Needs attention* (invoice or email failed), plus
  open service requests and this month's revenue. *To process* flags orders
  waiting over 2 days, and *Shipped* flags orders past their expected delivery
  date. Click a tile to filter the list.
- **New order:** it appears under *To process*, and you also get a "New order"
  email. Open it: you see the items, the address (*Copy shipping address* for the
  courier booking), the payment, the invoice and the timeline.
- **Start packing:** *Mark as processing*, with an optional note such as "testing
  your unit today". The customer gets the "We're preparing your order" email.
- **Ship it:** choose the courier, enter the AWB, the tracking link and the
  expected delivery date, then *Mark as shipped*. The customer gets the tracking
  and delivery-instructions email. If the tracking changes, edit it and *Save
  tracking*; the customer is emailed again.
- **Delivered:** *Mark as delivered* when the courier shows it delivered. The
  customer gets the "Delivered" email, with how to report damage and get help.
- **Cancel:** under *Cancel order*, with a reason the customer sees. This does
  **not** refund the money: refund it in the Razorpay dashboard and add a credit
  note in Zoho Books. The timeline keeps a reminder.
- **Customer didn't get an email:** use *Resend an email…*.
- **Invoice or email failed:** the order shows under *Needs attention* with the
  error. Fix the cause (for example a Zoho ID), then click *Retry invoice and
  emails*. The cron also retries every 15 minutes, up to 20 attempts.
- **Notes:** *Add note* records internal notes (calls, packing details) on the
  timeline. Customers never see these.
- **Find an order:** search by order number, name, business, GSTIN, email,
  phone, city, pincode, invoice or AWB, and filter by date.
- **Records:** *Export CSV* downloads the current list (all fields, GST split,
  timestamps) for accounts or a courier upload. It opens in Excel or Google Sheets.
- **Service request:** you get a "Service SR-…" email at `ORDER_NOTIFY_EMAIL`.
  In `/admin`, under *Service requests*, set the status, write a note and save.
  The customer is emailed and sees the note in their account. If the customer
  replies with photos, the reply goes to `hello@wargrobotics.com`.
- **Customer can't sign in:** they can use *Forgot password* on `/login`. To
  change someone's email address, edit the `users` row in the D1 console
  (Workers & Pages → D1 → wargrobotics-orders → Console).
- **Refund without cancelling** (for example a partial refund): issue it in
  Razorpay and Zoho, then *Add note* on the order so the timeline records it.
- **Change a price or the offer:** edit `src/config.js` and the item rate in
  Zoho, then deploy.

## Testing locally

```bash
npm install
npm test                 # unit tests
bash test/run-e2e.sh     # 36 end-to-end checks: accounts, Google, cart, checkout,
                         # invoices, emails, order portal, service requests. Uses stand-ins for
                         # Razorpay, Zoho, Resend and Google, on a fresh local database.
```

To click around locally, run `cp .dev.vars.example .dev.vars`,
`node test/mock-services.mjs 8899 &` and `npx wrangler dev`, then open
`http://localhost:8787`. Use `localhost`, not `127.0.0.1`, or the browser won't
keep the sign-in cookie. Confirmation and reset emails don't really get sent
locally; read them from `http://127.0.0.1:8899/__calls`.
