// Thin PostgREST client for the solaire-portal Supabase project.
// No @supabase/supabase-js dependency — the site ships with zero deps and stays that way.
//
// Env vars required:
//   SUPABASE_URL                 https://zgwwgtkfqmsqklqnujms.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service role — web_checkouts has RLS on with no policies
//
// The service-role key bypasses RLS. It must never reach the browser; these helpers are
// only ever called from inside a Netlify function.

const TABLE = "web_checkouts";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(path, { method = "GET", body, prefer } = {}) {
  const c = config();
  if (!c) throw new Error("Supabase env vars not set");

  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Record a checkout the moment Yoco hands back a redirect URL. Never throws. */
export async function recordCheckout(row) {
  try {
    await rest(TABLE, { method: "POST", body: row, prefer: "return=minimal" });
    return true;
  } catch (err) {
    console.error("recordCheckout failed (non-fatal):", err.message);
    return false;
  }
}

/** Flip a checkout to paid. Matches on the Yoco checkout id. */
export async function markPaid({ checkoutId, paymentId }) {
  if (!checkoutId) return false;
  try {
    await rest(`${TABLE}?checkout_id=eq.${encodeURIComponent(checkoutId)}`, {
      method: "PATCH",
      body: { status: "paid", payment_id: paymentId || null, paid_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    return true;
  } catch (err) {
    console.error("markPaid failed:", err.message);
    return false;
  }
}

/**
 * Fallback when the payment event carries no checkout id: flip the most recent
 * unpaid checkout for that email address.
 */
export async function markPaidByEmail({ email, paymentId }) {
  if (!email) return false;
  try {
    const rows = await rest(
      `${TABLE}?status=eq.started&email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1&select=id`);
    if (!rows || !rows.length) return false;
    await rest(`${TABLE}?id=eq.${rows[0].id}`, {
      method: "PATCH",
      body: { status: "paid", payment_id: paymentId || null, paid_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    return true;
  } catch (err) {
    console.error("markPaidByEmail failed:", err.message);
    return false;
  }
}

/**
 * Checkouts still unpaid, old enough to nudge, never nudged before,
 * and recent enough to be worth nudging.
 */
export async function pendingReminders({ olderThanMinutes = 120, withinDays = 14, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const floor  = new Date(Date.now() - withinDays * 86_400_000).toISOString();
  const q = [
    "status=eq.started",
    "reminded_at=is.null",
    "email=not.is.null",
    `created_at=lt.${cutoff}`,
    `created_at=gt.${floor}`,
    "order=created_at.asc",
    `limit=${limit}`,
    "select=*",
  ].join("&");
  return (await rest(`${TABLE}?${q}`)) || [];
}

/** Stamp a row so it is never nudged twice. */
export async function markReminded(id) {
  return rest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { reminded_at: new Date().toISOString(), reminder_count: 1 },
    prefer: "return=minimal",
  });
}

/** Which page should "Complete your payment" send them back to. */
export function resumeUrlFor(items) {
  const site = "https://solaire-intelligence.co.za";
  const hits = ["SI Gateway", "SI Switch", "SI Water", "SI Pool"].filter((p) =>
    new RegExp(p, "i").test(items || ""));
  if (hits.length !== 1) return `${site}/cart`;
  return `${site}/${hits[0].toLowerCase().replace(/\s+/g, "-")}#buy`;
}
