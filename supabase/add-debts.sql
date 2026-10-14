-- Adds the debts screen's table to an EXISTING project.
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- A debt is money a client still owes after a treatment. Reminders go out by
-- email (Resend), so client_email is what decides whether a debt can be
-- chased automatically -- see supabase/functions/debt-reminders.

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_phone text not null,
  client_email text,                       -- no email => no automatic reminders
  appointment_id uuid references appointments(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  treatment_date date not null default current_date,
  notes text,
  status text not null default 'open' check (status in ('open', 'paid')),
  paid_at timestamptz,
  reminders_sent int not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now()
);

-- the reminder sweep's working set: open debts, oldest reminder first
create index if not exists debts_open_idx on debts (last_reminder_at) where status = 'open';

alter table debts enable row level security;

drop policy if exists "authenticated full access" on debts;
create policy "authenticated full access" on debts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
