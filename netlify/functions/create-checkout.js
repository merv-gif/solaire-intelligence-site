import { recordCheckout, resumeUrlFor } from "./lib/db.js";

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // `netlify dev` posts to the production origin, so a local test would mail a real
  // order notification and write a real checkout row. Keep test runs out of both.
  const IS_LOCAL = process.env.NETLIFY_DEV === 'true';

  if (!process.env.YOCO_SECRET_KEY) {
    // Without this we'd send "Bearer undefined" and get an opaque 403 back from Yoco.
    console.error('YOCO_SECRET_KEY not set — run `netlify link` so dev pulls the site env, or set it in Netlify.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Payments are not configured. Please email sales@solairesa.co.za.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Price list (cents) — single source of truth server-side
  const PRICES = {
    'SI Gateway': 185000,
    'SI Switch':  135000,
    'SI Water':   465000,
    'SI Pool':    720000,
  };

  // Delivery, in cents, per product. SI Gateway ships free (launch promo).
  // A mixed cart pays the highest single shipping charge, not the sum.
  const SHIPPING_BY_PRODUCT = {
    'SI Gateway': 0,
    'SI Switch':  16000,
    'SI Water':   16000,
    'SI Pool':    16000,
  };
  const DEFAULT_SHIPPING = 16000;

  const { name, email, phone, address, city, province, postal_code } = body;

  // ─── Cart path: items array ──────────────────────────────────────────────
  if (body.items && Array.isArray(body.items)) {
    const items = body.items;

    // Validate and calculate total
    for (const item of items) {
      if (!PRICES[item.product]) {
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown product: ${item.product}` }) };
      }
      if (!Number.isInteger(item.qty) || item.qty < 1) {
        return { statusCode: 400, body: JSON.stringify({ error: `Invalid qty for ${item.product}` }) };
      }
    }
    const SHIPPING = items.reduce(
      (m, i) => Math.max(m, SHIPPING_BY_PRODUCT[i.product] ?? DEFAULT_SHIPPING), 0);
    const amount = items.reduce((s, i) => s + PRICES[i.product] * i.qty, 0) + SHIPPING;
    const itemSummary = items.map(i => {
      const variantStr = i.variant ? ` (${i.variant})` : '';
      return `${i.product}${variantStr} ×${i.qty}`;
    }).join(', ');

    const origin = 'https://solaire-intelligence.co.za';

    // Submit to Netlify Forms (non-fatal)
    try {
      if (IS_LOCAL) throw new Error('local run — order mail skipped');
      await fetch(`${origin}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'form-name': 'si-cart-order',
          status: 'CHECKOUT STARTED — payment NOT confirmed. A paid order arrives separately from the Yoco webhook.',
          items: itemSummary,
          total: `R${(amount / 100).toFixed(2)}`,
          name, email, phone, address, city, province, postal_code,
        }).toString(),
      });
    } catch (formErr) {
      console.warn('Netlify Forms submission failed (non-fatal):', formErr.message);
    }

    try {
      const response = await fetch('https://payments.yoco.com/api/checkouts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.YOCO_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `${Date.now()}-${email}`,
        },
        body: JSON.stringify({
          amount,
          currency: 'ZAR',
          successUrl: `${origin}/thank-you?v=${amount}`,
          cancelUrl:  `${origin}/cart`,
          metadata: { items: itemSummary, name, email, phone, address, city, province, postal_code },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Yoco error:', data);
        return { statusCode: response.status, body: JSON.stringify({ error: data.message || 'Yoco error' }) };
      }

      // Order record + the basis for the unpaid-cart nudge. Never blocks the customer.
      if (!IS_LOCAL) await recordCheckout({
        checkout_id: data.id, items: itemSummary, amount_cents: amount,
        customer_name: name, email, phone, address, city, province, postal_code,
        resume_url: resumeUrlFor(itemSummary),
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUrl: data.redirectUrl }),
      };
    } catch (err) {
      console.error('Function error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
    }
  }

  // ─── Single-product path (product pages buy-direct) ──────────────────────
  const { product, variant } = body;
  const productPrice = PRICES[product];
  if (!productPrice) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product' }) };
  }
  const amount = productPrice + (SHIPPING_BY_PRODUCT[product] ?? DEFAULT_SHIPPING);

  const origin = 'https://solaire-intelligence.co.za';
  const formName =
    product === 'SI Gateway' ? 'si-gateway-order' :
    product === 'SI Switch'  ? 'si-switch-order'  :
    product === 'SI Water'   ? 'si-water-order'   : 'si-pool-order';

  // Submit to Netlify Forms (non-fatal)
  try {
    if (IS_LOCAL) throw new Error('local run — order mail skipped');
    await fetch(`${origin}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'form-name': formName,
        status: 'CHECKOUT STARTED — payment NOT confirmed. A paid order arrives separately from the Yoco webhook.',
        product, variant: variant || '', name, email, phone, address, city, province, postal_code,
      }).toString(),
    });
  } catch (formErr) {
    console.warn('Netlify Forms submission failed (non-fatal):', formErr.message);
  }

  try {
    const response = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.YOCO_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${Date.now()}-${email}`,
      },
      body: JSON.stringify({
        amount,
        currency: 'ZAR',
        successUrl: `${origin}/thank-you?v=${amount}`,
        cancelUrl: {
          'SI Gateway': `${origin}/si-gateway#buy`,
          'SI Switch':  `${origin}/si-switch#buy`,
          'SI Water':   `${origin}/si-water#buy`,
          'SI Pool':    `${origin}/si-pool#buy`,
        }[product] || `${origin}/`,
        metadata: { product, variant: variant || '', name, email, phone, address, city, province, postal_code },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Yoco error:', data);
      return { statusCode: response.status, body: JSON.stringify({ error: data.message || 'Yoco error' }) };
    }

    const itemSummary = `${product}${variant ? ` (${variant})` : ''} ×1`;
    if (!IS_LOCAL) await recordCheckout({
      checkout_id: data.id, items: itemSummary, amount_cents: amount,
      customer_name: name, email, phone, address, city, province, postal_code,
      resume_url: resumeUrlFor(product),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUrl: data.redirectUrl }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
}
