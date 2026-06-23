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
    'SI Water':   465000,
    'SI Pool':    720000,
  };
  const amount = amounts[product];
  if (!amount) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product' }) };
  }

  const origin = 'https://solaire-intelligence.co.za';
  const formName = product === 'SI Gateway' ? 'si-gateway-order' : 'si-switch-order';

  // Submit to Netlify Forms so order details are captured regardless of payment outcome
  try {
    const formData = new URLSearchParams({
      'form-name': formName,
      product, name, email, phone, address, city, province, postal_code,
    });
    await fetch(`${origin}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
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
