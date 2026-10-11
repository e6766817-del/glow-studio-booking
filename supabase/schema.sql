-- Esthetician booking system - database schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists pgcrypto;

-- ── services ────────────────────────────────────────────────────────────────
create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price numeric(10,2),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ── appointments ───────────────────────────────────────────────────────────
create table appointments (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_phone text not null,
  service_id uuid not null references services(id) on delete restrict,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'done')),
  notes text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index appointments_date_idx on appointments (appointment_date, start_time) where status <> 'cancelled';

-- ── business_hours ─────────────────────────────────────────────────────────
create table business_hours (
  day_of_week int primary key check (day_of_week between 0 and 6), -- 0 = Sunday .. 6 = Saturday
  is_open boolean not null default true,
  open_time time not null default '09:00',
  close_time time not null default '19:00'
);

insert into business_hours (day_of_week, is_open, open_time, close_time) values
  (0, true,  '09:00', '19:00'), -- Sunday
  (1, true,  '09:00', '19:00'), -- Monday
  (2, true,  '09:00', '19:00'), -- Tuesday
  (3, true,  '09:00', '19:00'), -- Wednesday
  (4, true,  '09:00', '19:00'), -- Thursday
  (5, true,  '09:00', '14:00'), -- Friday
  (6, false, '09:00', '14:00'); -- Saturday - closed

-- ── business_settings (single row) ────────────────────────────────────────
create table business_settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Glow Studio',
  owner_email text not null,
  timezone text not null default 'Asia/Jerusalem',
  daily_email_hour int not null default 7 check (daily_email_hour between 0 and 23)
);

insert into business_settings (id, business_name, owner_email) values
  (1, 'Glow Studio', 'e6766817@gmail.com');

-- ── seed services ──────────────────────────────────────────────────────────
insert into services (name, duration_minutes, price, sort_order) values
  ('עיצוב גבות', 15, 40, 1),
  ('עיצוב גבות + צבע', 25, 60, 2),
  ('הסרת שיער בשעווה - פנים', 20, 50, 3),
  ('הסרת שיער בשעווה - גוף חלקי', 30, 90, 4),
  ('הסרת שיער בשעווה - גוף מלא', 60, 160, 5),
  ('הרמת ריסים', 45, 140, 6),
  ('הרמת ריסים + צבע', 60, 170, 7),
  ('מניקור', 45, 90, 8),
  ('פדיקור', 60, 120, 9),
  ('טיפול פנים בסיסי', 45, 180, 10),
  ('ניקוי פנים עמוק', 60, 220, 11),
  ('טיפול פנים מתקדם / אנטי אייג׳ינג', 75, 280, 12);

-- ── row level security ─────────────────────────────────────────────────────
-- Single-admin app: any authenticated user (the esthetician's own login) may
-- read/write everything. No anonymous access anywhere - clients never touch
-- this app directly, they call and the esthetician enters the booking.
alter table services enable row level security;
alter table appointments enable row level security;
alter table business_hours enable row level security;
alter table business_settings enable row level security;

create policy "authenticated full access" on services
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on appointments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on business_hours
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on business_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
