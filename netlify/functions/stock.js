// Stock management — backed by Upstash Redis REST API
// Env vars required: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

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

// ── Upstash helpers ───────────────────────────────────────────────────────────
async function kvGet(key) {
  const url  = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const { result } = await res.json();
  return result ? JSON.parse(result) : null;
}

async function kvSet(key, value) {
  const url  = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash env vars not configured');

  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(JSON.stringify(value)), // Upstash expects the value as a JSON string
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash error ${res.status}: ${text}`);
  }
  const { result } = await res.json();
  if (result !== 'OK') throw new Error(`Upstash SET returned: ${result}`);
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async function (event) {

  // ── GET: return current stock (public) ──────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const result = {};
    for (const product of PRODUCTS) {
      let entry = { ...DEFAULTS[product] };
      try {
        const stored = await kvGet(`stock:${product}`);
        if (stored) entry = stored;
      } catch { /* fall back to defaults */ }
      result[product] = { ...entry, status: getStatus(entry) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(result),
    };
  }

  // ── POST: update stock (admin only) ─────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || body.password !== adminPassword) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Wrong password' }) };
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

    try {
      await kvSet(`stock:${product}`, entry);
    } catch (err) {
      console.error('kvSet error:', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, product, ...entry, status: getStatus(entry) }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
