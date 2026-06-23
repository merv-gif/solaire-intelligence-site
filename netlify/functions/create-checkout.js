exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Price list (cents) — single source of truth server-side
  const PRICES = {
    'SI Gateway': 165000,
    'SI Switch':  135000,
    'SI Water':   465000,
    'SI Pool':    720000,
  };

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
    const SHIPPING = 16000; // R160 flat shipping
    const amount = items.reduce((s, i) => s + PRICES[i.product] * i.qty, 0) + SHIPPING;
    const itemSummary = items.map(i => `${i.product} ×${i.qty}`).join(', ');

    const origin = 'https://solaire-intelligence.co.za';

    // Submit to Netlify Forms (non-fatal)
    try {
      await fetch(`${origin}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'form-name': 'si-cart-order',
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
          successUrl: `${origin}/thank-you`,
          cancelUrl:  `${origin}/cart`,
          metadata: { items: itemSummary, name, email, phone, address, city, province, postal_code },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Yoco error:', data);
        return { statusCode: response.status, body: JSON.stringify({ error: data.message || 'Yoco error' }) };
      }
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
  const { product } = body;
  const productPrice = PRICES[product];
  if (!productPrice) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product' }) };
  }
  const amount = productPrice + 16000; // + R160 shipping

  const origin = 'https://solaire-intelligence.co.za';
  const formName =
    product === 'SI Gateway' ? 'si-gateway-order' :
    product === 'SI Switch'  ? 'si-switch-order'  :
    product === 'SI Water'   ? 'si-water-order'   : 'si-pool-order';

  // Submit to Netlify Forms (non-fatal)
  try {
    await fetch(`${origin}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'form-name': formName,
        product, name, email, phone, address, city, province, postal_code,
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
        successUrl: `${origin}/thank-you`,
        cancelUrl: {
          'SI Gateway': `${origin}/si-gateway#buy`,
          'SI Switch':  `${origin}/si-switch#buy`,
          'SI Water':   `${origin}/si-water#buy`,
          'SI Pool':    `${origin}/si-pool#buy`,
        }[product] || `${origin}/`,
        metadata: { product, name, email, phone, address, city, province, postal_code },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Yoco error:', data);
      return { statusCode: response.status, body: JSON.stringify({ error: data.message || 'Yoco error' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUrl: data.redirectUrl }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
