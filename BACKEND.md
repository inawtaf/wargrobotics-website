# Orders backend

Online orders for Ghost and Greywind: the buyer pays on the site, the order is
saved, a GST invoice is created in Zoho Books, and the buyer gets emails at
each step.

```
checkout.html ─► POST /api/orders ─► D1 (order saved) ─► Razorpay order
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
admin.html ─► "Mark shipped" ─► dispatch email with tracking and delivery instructions
```

If Zoho or Resend fails, the buyer is still confirmed. A cron job retries
every 15 minutes and sends the invoice on its own once it exists.

| Piece | Where |
|---|---|
| Worker code | `src/` (`worker.js` is the entry point) |
| Database schema | `migrations/0001_orders.sql` |
| Prices, offer limit, GST rate, states | `src/config.js` |
| Email wording | `src/email.js` |
| Checkout / order status / admin pages | `checkout.html` + `checkout.js`, `order.html`, `admin.html` |
| Settings and bindings | `wrangler.jsonc` |

Prices exclude GST; 18% is added at checkout. CGST + SGST applies within
Karnataka (`SELLER_STATE`), IGST elsewhere. Delivery is free.

---

## One-time setup

Do these in order. Use Razorpay **test mode** first; switch to live keys only
after a test order has gone through end to end.

### 1. Database (Cloudflare D1)

```bash
npm install
npx wrangler login
npx wrangler d1 create wargrobotics-orders            # copy database_id into wrangler.jsonc
npx wrangler d1 create wargrobotics-orders-preview    # copy into the "previews" block
npx wrangler d1 migrations apply wargrobotics-orders --remote
npx wrangler d1 migrations apply wargrobotics-orders-preview --remote
```

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

### 5. Settings in wrangler.jsonc

Replace every `REPLACE` value. The `previews` block uses the Razorpay **test**
key and the preview database, so pull-request builds can never take real money.

### 6. Secrets

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
| `ADMIN_TOKEN` | random string, at least 24 characters; your login for `admin.html` |

Generate random values with `openssl rand -hex 32`.

For previews, set at least `RAZORPAY_KEY_SECRET` (test), `ORDER_LINK_SECRET` and
`ADMIN_TOKEN` with `npx wrangler preview secret put NAME`.

### 7. Deploy and test

Push to `main`. Then, with Razorpay still in test mode:

1. Buy a Ghost at `/checkout` using a Razorpay test card or UPI ID.
2. Check that the order page says *Thank you*, the invoice appears in Zoho
   Books as paid, and the confirmation email arrives with the PDF attached.
3. Open `/admin`, paste `ADMIN_TOKEN`, mark the order shipped, and check that
   the dispatch email arrives.
4. Switch to live: put the live Key ID in `wrangler.jsonc`, update
   `RAZORPAY_KEY_SECRET`, add the webhook again in live mode, and redeploy.
   Delete or void the test invoices in Zoho.

---

## Running the business

- **New order:** you get a "New order" email at `ORDER_NOTIFY_EMAIL`. The order
  is also in `/admin`.
- **Ship it:** in `/admin`, open the order and enter the courier, AWB and
  tracking link, then click *Mark shipped*. The buyer gets the dispatch email.
- **Invoice or email failed:** `/admin` shows the error. Fix the cause (for
  example a Zoho ID), then click *Retry*. The cron also retries every 15 minutes,
  up to 20 attempts.
- **Refund:** issue it in the Razorpay dashboard and a credit note in Zoho. The
  order status isn't changed automatically yet.
- **Change a price or the offer:** edit `src/config.js` and the item rate in
  Zoho, then deploy.

## Testing locally

```bash
npm install
npm test                                          # unit tests
cp .dev.vars.example .dev.vars                    # local-only settings
npx wrangler d1 migrations apply wargrobotics-orders --local
node test/mock-services.mjs 8899 &                # stands in for Razorpay, Zoho, Resend
npx wrangler dev --test-scheduled &
node test/e2e.mjs                                 # 16 end-to-end checks
```
