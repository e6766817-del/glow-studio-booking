// Supabase Edge Function - chases unpaid treatments by email.
//
// Two ways in:
//   * the app, right after a debt is entered -> body {"debt_id": "..."} sends
//     that one debt its first reminder immediately;
//   * pg_cron, once a day with an empty body -> sweeps every open debt whose
//     last reminder is REMINDER_INTERVAL_DAYS or more old and reminds again.
//
// A debt with no client_email is never emailed; it comes back as
// skipped_no_email so the app can say so out loud.
//
// Deploy:   supabase functions deploy debt-reminders
// Secrets:  shares RESEND_API_KEY / RESEND_FROM with daily-schedule-email
// Schedule: see supabase/schedule-cron.sql

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Glow Studio <onboarding@resend.dev>";

// "and after each week it will send again"
const REMINDER_INTERVAL_DAYS = 7;

const DEBT_FIELDS =
  "id, client_name, client_phone, client_email, amount, treatment_date, notes, status, reminders_sent, last_reminder_at, services(name)";

type Debt = {
  id: string;
  client_name: string;
  client_phone: string;
  client_email: string | null;
  amount: number;
  treatment_date: string;
  notes: string | null;
  status: string;
  reminders_sent: number;
  last_reminder_at: string | null;
  services: { name: string } | null;
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

function formatAmount(amount: number): string {
  const n = Number(amount);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function buildEmailHtml(opts: {
  businessName: string;
  ownerEmail: string;
  debt: Debt;
  isFirst: boolean;
}): string {
  const { businessName, ownerEmail, debt, isFirst } = opts;

  const serviceLine = debt.services?.name
    ? `<tr><td style="padding:4px 0;color:#9a8a8a;width:90px;">הטיפול</td><td style="padding:4px 0;color:#3a2e2e;font-weight:600;">${debt.services.name}</td></tr>`
    : "";

  const opening = isFirst
    ? "תודה שבאת! נשאר תשלום פתוח על הטיפול האחרון."
    : "רק תזכורת עדינה - התשלום על הטיפול האחרון עדיין פתוח.";

  return `
  <div dir="rtl" style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#fffaf9;padding:24px;border-radius:12px;">
    <h2 style="color:#b5467a;margin:0 0 4px;">${businessName}</h2>
    <p style="color:#6b5656;margin:0 0 18px;">${debt.client_name} שלום,</p>
    <p style="color:#3a2e2e;margin:0 0 18px;line-height:1.7;">${opening}</p>

    <div style="background:#fdf2f2;border-radius:10px;padding:16px 18px;margin-bottom:18px;">
      <div style="font-size:13px;color:#9a6b6b;margin-bottom:2px;">סכום לתשלום</div>
      <div style="font-size:26px;font-weight:700;color:#b5467a;">${formatAmount(debt.amount)} &#8362;</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
        ${serviceLine}
        <tr><td style="padding:4px 0;color:#9a8a8a;width:90px;">תאריך הטיפול</td><td style="padding:4px 0;color:#3a2e2e;font-weight:600;">${formatDate(debt.treatment_date)}</td></tr>
      </table>
    </div>

    <p style="color:#6b5656;margin:0 0 6px;line-height:1.7;">
      אפשר להסדיר את התשלום בטיפול הבא או מול ${businessName} ישירות.
      אם התשלום כבר בוצע - אפשר להתעלם מהמייל הזה.
    </p>
    <p style="color:#9a8a8a;font-size:12px;margin:18px 0 0;">
      לשאלות אפשר להשיב למייל הזה (${ownerEmail}).
    </p>
  </div>`;
}

// Accepts calls from pg_cron (service_role key) and from the logged-in
// esthetician (her own user JWT, sent automatically by supabase-js). Rejects
// everything else, so the public anon key alone can't trigger an email send.
function callerRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const parts = authHeader.slice(7).split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  // The browser's preflight carries no Authorization header, so it has to be
  // answered before the auth check below.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const role = callerRole(req.headers.get("Authorization"));
  if (role !== "authenticated" && role !== "service_role") {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const debtId: string | undefined = body?.debt_id;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: settings, error: settingsError } = await supabase
      .from("business_settings")
      .select("business_name, owner_email")
      .eq("id", 1)
      .single();
    if (settingsError || !settings) throw settingsError ?? new Error("business_settings missing");

    // One debt on request (the send that follows entering it), otherwise every
    // open debt that is due for its next weekly nudge.
    let debts: Debt[];
    if (debtId) {
      const { data, error } = await supabase
        .from("debts")
        .select(DEBT_FIELDS)
        .eq("id", debtId)
        .eq("status", "open")
        .limit(1);
      if (error) throw error;
      debts = (data ?? []) as unknown as Debt[];
    } else {
      // A studio carries a handful of open debts at a time, so they all come
      // down and the weekly gate is applied here - no filter string to get
      // subtly wrong against a timestamp.
      const { data, error } = await supabase
        .from("debts")
        .select(DEBT_FIELDS)
        .eq("status", "open")
        .order("treatment_date", { ascending: true });
      if (error) throw error;
      const dueBefore = Date.now() - REMINDER_INTERVAL_DAYS * 86400000;
      debts = ((data ?? []) as unknown as Debt[]).filter(
        (d) => !d.last_reminder_at || new Date(d.last_reminder_at).getTime() <= dueBefore
      );
    }

    let sent = 0;
    let skippedNoEmail = 0;
    const failed: Array<{ id: string; error: string }> = [];

    for (const debt of debts) {
      if (!debt.client_email) {
        skippedNoEmail++;
        continue;
      }
      try {
        const isFirst = debt.reminders_sent === 0;
        const resendResp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [debt.client_email],
            reply_to: settings.owner_email,
            subject: isFirst
              ? `תשלום פתוח על הטיפול ב${settings.business_name}`
              : `תזכורת: תשלום פתוח ב${settings.business_name}`,
            html: buildEmailHtml({
              businessName: settings.business_name,
              ownerEmail: settings.owner_email,
              debt,
              isFirst,
            }),
          }),
        });

        if (!resendResp.ok) {
          const text = await resendResp.text();
          throw new Error(`Resend API error ${resendResp.status}: ${text}`);
        }

        // The reminder is only counted once Resend accepted it, so a failure
        // leaves the debt due and the next sweep retries it.
        const { error: updateError } = await supabase
          .from("debts")
          .update({
            reminders_sent: debt.reminders_sent + 1,
            last_reminder_at: new Date().toISOString(),
          })
          .eq("id", debt.id);
        if (updateError) throw updateError;

        sent++;
      } catch (err) {
        console.error(`debt ${debt.id}:`, err);
        failed.push({ id: debt.id, error: String(err) });
      }
    }

    return new Response(
      JSON.stringify({
        ok: failed.length === 0,
        due: debts.length,
        sent,
        skipped_no_email: skippedNoEmail,
        failed,
      }),
      { headers: JSON_HEADERS }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
