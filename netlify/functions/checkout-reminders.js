// Scheduled: nudges checkouts that were started but never paid.
// Schedule lives in netlify.toml ([functions."checkout-reminders"] schedule = "@hourly").
//
// Rules: one email per checkout, ever. Nothing younger than 2 hours (they may still be
// paying). Nothing older than 14 days (stale, reads as spam). Marked before sending, so a
// crash mid-run can never double-send.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY

import { pendingReminders, markReminded } from "./lib/db.js";
import { pendingPaymentEmail } from "./lib/order-email.js";

const OLDER_THAN_MINUTES = 120;
const WITHIN_DAYS        = 14;

const rands = (cents) =>
  "R" + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export async function handler() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not set — skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  let rows;
  try {
    rows = await pendingReminders({ olderThanMinutes: OLDER_THAN_MINUTES, withinDays: WITHIN_DAYS });
  } catch (err) {
    console.error("Could not read pending checkouts:", err.message);
    return { statusCode: 500, body: "db error" };
  }

  if (!rows.length) return { statusCode: 200, body: "nothing pending" };

  let sent = 0;
  for (const row of rows) {
    // Stamp first. A double-send is worse than a missed send.
    try {
      await markReminded(row.id);
    } catch (err) {
      console.error("Could not stamp checkout %s, skipping:", row.id, err.message);
      continue;
    }

    const { subject, html } = pendingPaymentEmail({
      name:      row.customer_name,
      items:     row.items,
      total:     rands(row.amount_cents),
      resumeUrl: row.resume_url || "https://solaire-intelligence.co.za/cart",
    });

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from:     "Solaire Intelligence <noreply@solaire-intelligence.co.za>",
          to:       [row.email],
          reply_to: "sales@solairesa.co.za",
          bcc:      ["sales@solairesa.co.za"],
          subject,
          html,
        }),
      });
      if (!res.ok) console.error("Resend rejected nudge for %s:", row.email, await res.text());
      else sent++;
    } catch (err) {
      console.error("Nudge to %s failed:", row.email, err.message);
    }
  }

  console.log("checkout-reminders: %d pending, %d sent", rows.length, sent);
  return { statusCode: 200, body: `sent ${sent}/${rows.length}` };
}
