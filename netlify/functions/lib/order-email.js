// Customer-facing order emails, in the site's brand.
// Sent through Resend from noreply@solaire-intelligence.co.za, same as the contact form.

const BRAND = {
  bg:      "#0b1220",
  panel:   "#111a2e",
  panel2:  "#162241",
  line:    "#1f2d51",
  text:    "#e6edf7",
  muted:   "#8ea1c2",
  accent:  "#2fb5ff",
  accent2: "#3ce0c3",
  warn:    "#ffb547",
};

const SITE     = "https://solaire-intelligence.co.za";
const SALES    = "sales@solairesa.co.za";
const WHATSAPP = "073 894 8248";
const WA_LINK  = "https://wa.me/27738948248";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function shell({ preheader, badge, badgeColour, heading, body }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;">

    <tr><td style="padding:22px 28px;border-bottom:1px solid ${BRAND.line};">
      <span style="font-size:17px;font-weight:700;color:${BRAND.text};letter-spacing:-0.2px;">Solaire <span style="color:${BRAND.accent};">Intelligence</span></span>
    </td></tr>

    <tr><td style="padding:30px 28px 8px;">
      <span style="display:inline-block;background:${badgeColour};color:#0b1220;font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;padding:5px 10px;border-radius:999px;">${esc(badge)}</span>
      <h1 style="margin:16px 0 0;font-size:25px;line-height:1.25;color:${BRAND.text};font-weight:700;letter-spacing:-0.4px;">${esc(heading)}</h1>
    </td></tr>

    <tr><td style="padding:14px 28px 30px;">${body}</td></tr>

    <tr><td style="padding:20px 28px;background:${BRAND.panel2};border-top:1px solid ${BRAND.line};">
      <p style="margin:0 0 6px;font-size:13px;color:${BRAND.muted};line-height:1.6;">
        Questions? <a href="mailto:${SALES}" style="color:${BRAND.accent};text-decoration:none;">${SALES}</a>
        &nbsp;·&nbsp; WhatsApp <a href="${WA_LINK}" style="color:${BRAND.accent};text-decoration:none;">${WHATSAPP}</a>
      </p>
      <p style="margin:0;font-size:11px;color:#5d7098;">
        Solaire Intelligence · <a href="${SITE}" style="color:#5d7098;text-decoration:none;">solaire-intelligence.co.za</a>
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

const p = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.text};">${t}</p>`;

function summary({ items, total }) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.panel2};border:1px solid ${BRAND.line};border-radius:10px;margin:4px 0 22px;">
    <tr><td style="padding:16px 18px;">
      <div style="font-size:11px;letter-spacing:0.8px;text-transform:uppercase;color:${BRAND.muted};font-weight:700;margin-bottom:8px;">Your order</div>
      <div style="font-size:15px;color:${BRAND.text};font-weight:600;line-height:1.5;">${esc(items)}</div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid ${BRAND.line};font-size:15px;color:${BRAND.text};">
        <span style="color:${BRAND.muted};">Total</span>
        <span style="float:right;font-weight:700;">${esc(total)}</span>
      </div>
    </td></tr>
  </table>`;
}

function button(href, label) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr><td style="background:${BRAND.accent};border-radius:10px;">
      <a href="${href}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#06121f;text-decoration:none;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/**
 * "You're almost there" — checkout started, payment never completed.
 */
export function pendingPaymentEmail({ name, items, total, resumeUrl = `${SITE}/cart` }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  // Subject uses a short product label: "SI Gateway (Sunsynk/Deye 16kW) \u00d71" -> "SI Gateway"
  const short = String(items || "order").split(/\s*[(\u00d7,]/)[0].trim() || "order";
  // Free delivery is the SI Gateway launch promo only — Switch, Water and Pool pay R160.
  const freeDelivery = /SI Gateway/i.test(items || "") && !/SI (Switch|Water|Pool)/i.test(items || "");

  const body = [
    p(`Hi ${esc(first)},`),
    p(`You started an order with us but the payment didn't go through, so nothing has been charged and nothing has shipped. Your order is held here, ready to go.`),
    summary({ items, total }),
    button(resumeUrl, "Complete your payment →"),
    p(`<span style="color:${BRAND.muted};font-size:14px;">${freeDelivery ? "Free delivery anywhere in South Africa · " : ""}12-month warranty · most orders ship within 1–2 business days.</span>`),
    p(`If the payment page gave you trouble, or you'd rather pay by EFT, just reply to this email and we'll sort it out.`),
    p(`<span style="color:${BRAND.muted};font-size:14px;">Merv<br>Solaire Intelligence</span>`),
  ].join("");

  return {
    subject: `You're almost there — your ${short} order is pending payment`,
    html: shell({
      preheader: "Your order is held and ready — the payment just didn't complete.",
      badge: "Payment pending",
      badgeColour: BRAND.warn,
      heading: "You're almost there",
      body,
    }),
  };
}

export { BRAND, SITE, SALES };
