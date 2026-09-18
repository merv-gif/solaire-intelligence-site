// Yoco webhook receiver — the ONLY notification that means money actually arrived.
//
// Env vars required:
//   YOCO_WEBHOOK_SECRET  whsec_... (returned when you register the webhook with Yoco)
//   RESEND_API_KEY       same key the contact form uses
//
// To register (once, per Yoco docs):
//   POST https://payments.yoco.com/api/webhooks  { name, url }  with the secret key.
//
// Yoco signs with the Standard Webhooks scheme:
//   signedContent = "<webhook-id>.<webhook-timestamp>.<raw body>"
//   signature     = base64( HMAC-SHA256( base64decode(secret minus "whsec_"), signedContent ) )
//   the webhook-signature header is a space-separated list of "v1,<sig>"

import crypto from "node:crypto";
import { markPaid, markPaidByEmail } from "./lib/db.js";

const TOLERANCE_SECONDS = 3 * 60;

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verify(rawBody, headers, secret) {
  const id        = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const sigHeader = headers["webhook-signature"];
  if (!id || !timestamp || !sigHeader) return "missing signature headers";

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return "timestamp outside tolerance";

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  const provided = sigHeader.split(" ").map(p => p.split(",")[1]).filter(Boolean);
  return provided.some(sig => timingSafeEqual(sig, expected)) ? null : "signature mismatch";
}


export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secret = process.env.YOCO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("YOCO_WEBHOOK_SECRET not set");
    return { statusCode: 500, body: "Not configured" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  // Netlify lowercases header names.
  const failure = verify(rawBody, event.headers, secret);
  if (failure) {
    console.warn("Rejected Yoco webhook:", failure);
    return { statusCode: 401, body: "Invalid signature" };
  }

  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Acknowledge anything we don't act on, so Yoco stops retrying it.
  if (evt.type !== "payment.succeeded") {
    return { statusCode: 200, body: "ignored" };
  }

  const p    = evt.payload || {};
  const m    = p.metadata || {};
  const rand = (p.amount ?? 0) / 100;
  const cart = m.items || [m.product, m.variant && `(${m.variant})`].filter(Boolean).join(" ") || "—";

  const row = (label, value) =>
    `<tr><td style="padding:7px 0;color:#666;width:120px;vertical-align:top;">${label}</td>` +
    `<td style="padding:7px 0;font-weight:600;">${value || "—"}</td></tr>`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;color:#111;">
      <div style="background:#0a7d32;color:#fff;padding:14px 18px;border-radius:8px;font-size:18px;font-weight:700;">
        PAID — R${rand.toFixed(2)}
      </div>
      <p style="color:#666;font-size:13px;">Yoco confirmed this payment. Ship it.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;">
        ${row("Items", cart)}
        ${row("Amount", `R${rand.toFixed(2)} ${p.currency || "ZAR"}`)}
        ${row("Name", m.name)}
        ${row("Email", m.email ? `<a href="mailto:${m.email}">${m.email}</a>` : "")}
        ${row("Phone", m.phone)}
        ${row("Address", [m.address, m.city, m.province, m.postal_code].filter(Boolean).join("<br>"))}
        ${row("Payment ID", p.id)}
        ${row("Mode", p.mode === "live" ? "LIVE" : (p.mode || "—"))}
      </table>
      <p style="font-size:12px;color:#999;margin-top:22px;">
        Yoco webhook · event ${evt.id || "—"} · solaire-intelligence.co.za
      </p>
    </div>
  `;

  // Close the order record out before mailing, so a mail failure can't lose the fact of payment.
  const checkoutId = m.checkoutId || p.checkoutId || evt.payload?.checkoutId || null;
  const marked = checkoutId
    ? await markPaid({ checkoutId, paymentId: p.id })
    : await markPaidByEmail({ email: m.email, paymentId: p.id });
  if (!marked) {
    console.warn("Payment %s could not be matched to a web_checkouts row", p.id);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not set — payment %s confirmed but no mail sent", p.id);
    return { statusCode: 200, body: "ok (no mailer)" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:     "Solaire Intelligence <noreply@solaire-intelligence.co.za>",
        to:       ["sales@solairesa.co.za"],
        reply_to: m.email || undefined,
        subject:  `PAID R${rand.toFixed(2)} — ${cart} — ${m.name || "unknown"}`,
        html,
      }),
    });
    if (!res.ok) console.error("Resend error on paid order:", await res.text());
  } catch (err) {
    console.error("Paid-order mail failed:", err.message);
  }

  // Always 200 once the signature checked out — a mail failure must not make Yoco retry.
  return { statusCode: 200, body: "ok" };
}
