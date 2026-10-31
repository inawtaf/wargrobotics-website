// Stand-in for Razorpay, Zoho Books and Resend, for local end-to-end tests.
// Start: node test/mock-services.mjs 8899   (used by test/e2e.mjs)
import http from 'node:http';

const port = Number(process.argv[2] || 8899);
const state = { calls: [], orders: {}, failZohoInvoices: false, invoices: [], nextInvoice: 1, contacts: [], failResend: null };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
    const p = url.pathname;
    if (!p.startsWith('/__')) {
      const logged = body && body.attachments ? { ...body, attachments: body.attachments.map(a => ({ filename: a.filename, bytes: a.content.length })) } : body;
      state.calls.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), headers: { auth: req.headers.authorization, idem: req.headers['idempotency-key'] }, body: logged });
    }

    // test control
    if (p === '/__calls') return send(res, 200, state.calls);
    if (p === '/__fail-resend') { state.failResend = url.searchParams.get('msg') || null; return send(res, 200, { ok: true }); }
    if (p === '/__contacts') return send(res, 200, state.contacts);
    if (p === '/__fail-zoho') { state.failZohoInvoices = url.searchParams.get('on') === '1'; return send(res, 200, { ok: true }); }

    // Razorpay
    if (p === '/rzp/orders' && req.method === 'POST') {
      const id = 'order_' + Math.random().toString(36).slice(2, 10);
      state.orders[id] = body.amount;
      return send(res, 200, { id, amount: body.amount, currency: 'INR', receipt: body.receipt, status: 'created' });
    }
    if (p === '/rzp/orders' && req.method === 'GET') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('rzp_test_local:rzp_test_secret').toString('base64')) return send(res, 401, { error: { description: 'Authentication failed' } });
      return send(res, 200, { count: 0, items: [] });
    }
    if (p.startsWith('/rzp/payments/')) {
      const id = p.split('/').pop();
      const [, orderId] = id.split('__');          // test encodes pay_x__order_y
      return send(res, 200, { id, order_id: orderId, amount: state.orders[orderId], status: 'captured' });
    }

    // Zoho
    if (p === '/zaccounts/oauth/v2/token') return send(res, 200, { access_token: 'zoho_tok', expires_in: 3600 });
    if (p.startsWith('/zoho/') && req.headers.authorization !== 'Zoho-oauthtoken zoho_tok') return send(res, 401, { code: 57, message: 'bad token' });
    if (p === '/zoho/contacts' && req.method === 'GET') {
      return send(res, 200, { code: 0, contacts: state.contacts.filter(c => c.email === url.searchParams.get('email')) });
    }
    if (p === '/zoho/contacts' && req.method === 'POST') {
      if (state.contacts.some(c => c.contact_name === body.contact_name)) return send(res, 400, { code: 3062, message: 'The contact name already exists. Please specify a different name.' });
      const c = { contact_id: 'c_' + (state.contacts.length + 1), contact_name: body.contact_name, email: body.contact_persons?.[0]?.email, gst_no: body.gst_no || '', company_name: body.company_name || '', gst_treatment: body.gst_treatment, billing_address: body.billing_address, shipping_address: body.shipping_address };
      state.contacts.push(c);
      return send(res, 201, { code: 0, contact: { contact_id: c.contact_id } });
    }
    if (/^\/zoho\/contacts\/[^/]+$/.test(p) && req.method === 'PUT') {
      const c = state.contacts.find(x => x.contact_id === p.split('/').pop());
      if (!c) return send(res, 404, { code: 1002, message: 'Contact does not exist.' });
      if (!body.contact_name) return send(res, 400, { code: 4, message: 'contact_name is mandatory' });
      Object.assign(c, { billing_address: body.billing_address, shipping_address: body.shipping_address });
      return send(res, 200, { code: 0, contact: c });
    }
    if (p === '/zoho/settings/taxes') return send(res, 200, { code: 0, taxes: [{ tax_id: 'tax_intra' }, { tax_id: 'tax_inter' }] });
    if (p === '/zoho/items' && req.method === 'GET') return send(res, 200, { code: 0, items: [{ item_id: 'item_ghost' }, { item_id: 'item_greywind' }] });
    if (p === '/zoho/invoices' && req.method === 'GET') {
      return send(res, 200, { code: 0, invoices: state.invoices.filter(i => i.reference_number === url.searchParams.get('reference_number')) });
    }
    if (p === '/zoho/invoices' && req.method === 'POST') {
      if (state.failZohoInvoices) return send(res, 400, { code: 1001, message: 'Simulated Zoho outage' });
      // Like Zoho: per line, (rate × qty − discount amount) + 18% tax, rounded to paise.
      const total = body.line_items.reduce((t, li) => {
        const net = Math.round((li.rate * li.quantity - (Number(li.discount) || 0)) * 100);
        return t + net + Math.round(net * 0.18);
      }, 0) / 100;
      const inv = { invoice_id: 'inv_' + state.nextInvoice, invoice_number: 'INV-' + String(state.nextInvoice++).padStart(6, '0'), reference_number: body.reference_number, total, status: 'draft' };
      state.invoices.push(inv);
      return send(res, 201, { code: 0, invoice: inv });
    }
    if (/^\/zoho\/invoices\/[^/]+\/status\/sent$/.test(p)) return send(res, 200, { code: 0 });
    if (p === '/zoho/customerpayments') return send(res, 201, { code: 0, payment: { payment_id: 'p1' } });
    if (/^\/zoho\/invoices\/[^/]+$/.test(p) && url.searchParams.get('accept') === 'pdf') return send(res, 200, '%PDF-1.4 fake invoice', 'application/pdf');

    // Google: the test passes the claims it wants back, base64url-encoded, as the "code".
    if (p === '/google/token' && req.method === 'POST') {
      const form = new URLSearchParams(raw);
      if (form.get('client_secret') !== 'google-secret') return send(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
      if (!form.get('code_verifier')) return send(res, 400, { error: 'invalid_grant' });
      let claims;
      try { claims = JSON.parse(Buffer.from(form.get('code'), 'base64url').toString()); } catch { return send(res, 400, { error: 'invalid_grant' }); }
      const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      return send(res, 200, { access_token: 'x', id_token: `${b({ alg: 'RS256' })}.${b(claims)}.sig`, expires_in: 3600 });
    }

    // Resend
    if (p === '/resend/emails') {
      if (state.failResend) return send(res, 403, { name: 'validation_error', message: state.failResend });
      return send(res, 200, { id: 'em_' + state.calls.length });
    }
    if (p === '/resend/domains') return send(res, 200, { data: [{ name: 'wargrobotics.com', status: 'verified' }] });

    send(res, 404, { error: 'mock: no route ' + req.method + ' ' + p });
  });
}).listen(port, '127.0.0.1', () => console.log('mock services on', port));
