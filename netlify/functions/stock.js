let getStore;
try { getStore = require('@netlify/blobs').getStore; } catch { getStore = null; }

const PRODUCTS = ['SI Gateway', 'SI Switch', 'SI Water', 'SI Pool'];

const DEFAULTS = {
  'SI Gateway': { stock: 10, threshold: 3, lead_time: '3–5 business days' },
  'SI Switch':  { stock: 10, threshold: 3, lead_time: '3–5 business days' },
  'SI Water':   { stock: 5,  threshold: 2, lead_time: '5–7 business days' },
  'SI Pool':    { stock: 5,  threshold: 2, lead_time: '5–7 business days' },
};

function getStatus(item) {
  if (item.stock <= 0)              return 'out';
  if (item.stock <= item.threshold) return 'low';
  return 'in';
}

exports.handler = async function (event) {
  const store = getStore ? getStore('stock') : null;

  // ── GET: return current stock (public) ────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const result = {};
    for (const product of PRODUCTS) {
      let entry = { ...DEFAULTS[product] };
      try {
        if (store) {
          const raw = await store.get(product, { type: 'json' });
          if (raw) entry = raw;
        }
      } catch { /* blobs unavailable — use defaults */ }
      result[product] = { ...entry, status: getStatus(entry) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(result),
    };
  }

  // ── POST: update stock (admin only) ───────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || body.password !== adminPassword) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) };
    }

    const { product, stock, threshold, lead_time } = body;
    if (!PRODUCTS.includes(product)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product' }) };
    }

    const entry = {
      stock:     parseInt(stock, 10),
      threshold: parseInt(threshold, 10),
      lead_time: lead_time || '3–5 business days',
    };
    if (!store) return { statusCode: 503, body: JSON.stringify({ error: 'Storage not available yet — try again after next deploy' }) };
    await store.set(product, JSON.stringify(entry));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, product, ...entry, status: getStatus(entry) }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
