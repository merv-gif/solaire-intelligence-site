#!/usr/bin/env node
// One-off "you're almost there" nudge for a checkout that never got paid.
//
//   RESEND_API_KEY=re_... node scripts/send-pending-payment.mjs \
//     --to someone@example.com --name "Minentle" \
//     --items "SI Gateway (Sunsynk/Deye 16kW single phase) ×1" \
//     --total "R1,850.00" --url "https://solaire-intelligence.co.za/si-gateway#buy"
//
// Add --dry-run to print the subject and write the HTML to /tmp instead of sending.

import { pendingPaymentEmail } from "../netlify/functions/lib/order-email.js";
import { writeFileSync } from "node:fs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (k === "dry-run") args[k] = true;
    else args[k] = process.argv[++i];
  }
}

const required = ["to", "items", "total"];
const missing = required.filter((k) => !args[k]);
if (missing.length) {
  console.error(`Missing required flag(s): ${missing.map((m) => "--" + m).join(", ")}`);
  process.exit(1);
}

const { subject, html } = pendingPaymentEmail({
  name:      args.name,
  items:     args.items,
  total:     args.total,
  resumeUrl: args.url || "https://solaire-intelligence.co.za/cart",
});

if (args["dry-run"]) {
  const out = "/tmp/pending-payment-preview.html";
  writeFileSync(out, html);
  console.log(`DRY RUN — nothing sent.\n  To:      ${args.to}\n  Subject: ${subject}\n  Preview: ${out}`);
  process.exit(0);
}

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error("RESEND_API_KEY not set.  Try:  export RESEND_API_KEY=$(netlify env:get RESEND_API_KEY)");
  process.exit(1);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from:     "Solaire Intelligence <noreply@solaire-intelligence.co.za>",
    to:       [args.to],
    reply_to: "sales@solairesa.co.za",
    bcc:      ["sales@solairesa.co.za"],
    subject,
    html,
  }),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Resend rejected it:", JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log(`Sent to ${args.to}  ·  id ${data.id}`);
