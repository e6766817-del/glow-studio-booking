// Supabase Edge Function - runs every morning via pg_cron.
// Emails the esthetician the day's full schedule.
//
// Deploy:   supabase functions deploy daily-schedule-email
// Secrets:  supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM="Glow Studio <onboarding@resend.dev>"
// Schedule: see supabase/schedule-cron.sql (pg_cron -> net.http_post against this function, 07:00 Asia/Jerusalem)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Glow Studio <onboarding@resend.dev>";

const WEEKDAY_HE = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];

function todayInTimezone(timezone: string): string {
  // en-CA gives YYYY-MM-DD directly
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function formatTime(t: string): string {
  return t.slice(0, 5);
}

function buildEmailHtml(opts: {
  businessName: string;
  dateLabel: string;
  appointments: Array<{
    start_time: string;
    end_time: string;
    client_name: string;
    client_phone: string;
    notes: string | null;
    service_name: string;
  }>;
}): string {
  const { businessName, dateLabel, appointments } = opts;

  const rows = appointments
    .map(
      (a) => `
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #f0e4e4;font-weight:600;color:#3a2e2e;white-space:nowrap;">
          ${formatTime(a.start_time)}–${formatTime(a.end_time)}
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #f0e4e4;color:#3a2e2e;">
          ${a.client_name}<br/>
          <span style="color:#9a8a8a;font-size:12px;">${a.client_phone}</span>
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #f0e4e4;color:#6b5656;">${a.service_name}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #f0e4e4;color:#9a8a8a;font-size:12px;">${a.notes ?? ""}</td>
      </tr>`
    )
    .join("");

  const body = appointments.length
    ? `<table dir="rtl" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
         <thead>
           <tr style="background:#fdf2f2;">
             <th style="padding:10px 14px;text-align:right;font-size:12px;color:#9a6b6b;">שעה</th>
             <th style="padding:10px 14px;text-align:right;font-size:12px;color:#9a6b6b;">לקוחה</th>
             <th style="padding:10px 14px;text-align:right;font-size:12px;color:#9a6b6b;">טיפול</th>
             <th style="padding:10px 14px;text-align:right;font-size:12px;color:#9a6b6b;">הערות</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>`
    : `<p dir="rtl" style="font-family:Arial,sans-serif;color:#9a8a8a;">אין תורים קבועים להיום.</p>`;

  return `
  <div dir="rtl" style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#fffaf9;padding:24px;border-radius:12px;">
    <h2 style="color:#b5467a;margin:0 0 4px;">${businessName}</h2>
    <p style="color:#6b5656;margin:0 0 20px;">לוח התורים שלך ל${dateLabel} (${appointments.length} תורים)</p>
    ${body}
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

Deno.serve(async (req) => {
  const role = callerRole(req.headers.get("Authorization"));
  if (role !== "authenticated" && role !== "service_role") {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: settings, error: settingsError } = await supabase
      .from("business_settings")
      .select("business_name, owner_email, timezone")
      .eq("id", 1)
      .single();
    if (settingsError || !settings) throw settingsError ?? new Error("business_settings missing");

    const today = todayInTimezone(settings.timezone);
    const weekday = WEEKDAY_HE[new Date(today + "T00:00:00").getUTCDay()];
    const dateLabel = `${weekday}, ${today}`;

    const { data: appointments, error: apptError } = await supabase
      .from("appointments")
      .select("start_time, end_time, client_name, client_phone, notes, services(name)")
      .eq("appointment_date", today)
      .neq("status", "cancelled")
      .order("start_time", { ascending: true });
    if (apptError) throw apptError;

    const rows = (appointments ?? []).map((a: any) => ({
      start_time: a.start_time,
      end_time: a.end_time,
      client_name: a.client_name,
      client_phone: a.client_phone,
      notes: a.notes,
      service_name: a.services?.name ?? "",
    }));

    const html = buildEmailHtml({ businessName: settings.business_name, dateLabel, appointments: rows });

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [settings.owner_email],
        subject: `לוח התורים שלך ל${today} (${rows.length} תורים)`,
        html,
      }),
    });

    if (!resendResp.ok) {
      const text = await resendResp.text();
      throw new Error(`Resend API error ${resendResp.status}: ${text}`);
    }

    return new Response(JSON.stringify({ ok: true, date: today, count: rows.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
