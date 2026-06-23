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

  const { product, name, email, phone, address, city, province, postal_code } = body;

  // Amount in cents
  const amounts = {
    'SI Gateway': 165000,
    'SI Switch':  135000,
  };
  const amount = amounts[product];
  if (!amount) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product' }) };
  }

  const origin = 'https://solaire-intelligence.co.za';
  const key = process.env.YOCO_SECRET_KEY;
  console.log('Key present:', !!key, '| Key prefix:', key ? key.substring(0, 10) : 'MISSING');

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
        cancelUrl:  product === 'SI Gateway'
          ? `${origin}/si-gateway#buy`
          : `${origin}/si-switch#buy`,
        metadata: { product, name, email, phone, address, city, province, postal_code },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Yoco error:', data);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.message || 'Yoco error' }),
      };
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
