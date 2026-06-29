// Contact form handler — sends enquiry email via Resend
// Env vars required: RESEND_API_KEY
// To address: info@si-sa.co.za
// From address: noreply@solaire-intelligence.co.za (must be verified in Resend)

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Email service not configured." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  const { name, email, type, message } = body;

  if (!name || !email || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields." }) };
  }

  // Simple email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid email address." }) };
  }

  const html = `
    <div style="font-family:sans-serif;max-width:600px;color:#111;">
      <h2 style="margin-bottom:4px;">New SI Enquiry</h2>
      <p style="color:#666;font-size:14px;margin-top:0;">${type || "General enquiry"}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px;">
        <tr><td style="padding:8px 0;color:#666;width:100px;">Name</td><td style="padding:8px 0;font-weight:600;">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td style="padding:8px 0;color:#666;">Type</td><td style="padding:8px 0;">${type || "—"}</td></tr>
      </table>
      <div style="margin-top:20px;padding:16px;background:#f5f5f5;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${message}</div>
      <p style="font-size:12px;color:#999;margin-top:24px;">Sent from solaire-intelligence.co.za contact form</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:     "Solaire Intelligence <noreply@solaire-intelligence.co.za>",
        to:       ["info@si-sa.co.za"],
        reply_to: email,
        subject:  `SI Enquiry — ${type || "General"} (${name})`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to send. Please email us directly at info@si-sa.co.za" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("Contact function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Unexpected error. Please email us directly at info@si-sa.co.za" }) };
  }
}
