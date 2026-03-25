# Supabase Schema (MVP) — Insurance Fraud Detection & Investigation Platform

This document defines the Supabase Postgres schema needed for:
- Claims ingest (CSV uploads)
- Fraud scoring signals
- Queue/case management (assignment + status)
- Outcomes tracking
- Summary reporting for dashboards

It is designed to be:
- **Service-role friendly** (Express backend can use service role to bypass RLS)
- **MVP safe** for authenticated investigator users (basic RLS enabled, permissive enough for internal tool usage)

> Note: When executing SQL in the Supabase SQL editor, run in order.  
> All UUIDs use `gen_random_uuid()` which requires `pgcrypto`.

---

## Status: Tool-based SQL execution (Kavia SupabaseTools)

### Current verification result
As of the latest verification, SupabaseTools calls (`list_tables`, `create_table`, `run_sql`) are **still failing** with:

- `PGRST202 Could not find the function public.run_sql(query) in the schema cache`

This means **PostgREST (the Supabase REST API layer) is not advertising** `public.run_sql(query text)` yet (either it doesn’t exist, exists under a different signature, or the schema cache hasn’t refreshed).

### Fix: Create/replace `public.run_sql` exactly as expected (admin-only)
Run this in **Supabase SQL Editor** (requires project owner/admin):

```sql
-- Enables Kavia automation to execute SQL via an RPC.
-- Security note: this function is intentionally locked down to service_role.
create or replace function public.run_sql(query text)
returns void
language plpgsql
security definer
as $$
begin
  execute query;
end;
$$;

revoke all on function public.run_sql(text) from public;
grant execute on function public.run_sql(text) to service_role;
```

### Verify the function exists (in SQL editor)
Run:

```sql
select
  n.nspname as schema,
  p.proname as name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'run_sql';
```

Expected: one row with args exactly `query text`.

### Make PostgREST pick up changes
After creating it:

- Wait ~30–60 seconds for the API schema cache to refresh, OR
- In Supabase Dashboard: **Settings → API → “Reload schema”** (or similar “refresh” action, depending on dashboard version)

Then re-run automation; SupabaseTools should be able to:
- list tables
- create missing tables
- apply triggers/indexes/views/RLS via SQL

If it still fails after refresh, double-check there isn’t another `run_sql` function in a different schema and that the signature is **exactly** `(query text)`.

---

## Required Supabase environment variables (Express backend)

The Express backend Supabase client is implemented in:

- `insurance-fraud-detection-and-investigation-platform-2293/express_backend/src/db/supabase.js`

It expects **exactly** these server-side environment variables:

- `SUPABASE_URL` — Supabase project URL (e.g. `https://<ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — **Service Role key** (server-side only)

### Important: these are currently missing in this runtime/container
The current container environment only includes `REACT_APP_*` variables (frontend-style).  
For end-to-end backend verification to work, you must add the following to:

- `insurance-fraud-detection-and-investigation-platform-2293/express_backend/.env`

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Without these, the Express backend cannot connect to Supabase.

These names are also reflected in:

- `insurance-fraud-detection-and-investigation-platform-2293/express_backend/.env.example`

### Important: anon key vs service role key
- The backend **does not** use `SUPABASE_KEY`.
- `SUPABASE_KEY` is typically the **anon** public key and is safe for frontend usage, but **not sufficient** for backend operations that need to bypass RLS.
- Do **not** set `SUPABASE_SERVICE_ROLE_KEY` to the anon key value.

### Where to find the values in Supabase
In Supabase Dashboard:
- **Project Settings → API**
  - `Project URL` → use as `SUPABASE_URL`
  - `service_role` key → use as `SUPABASE_SERVICE_ROLE_KEY`
  - `anon` key → frontend only (if you add a frontend Supabase client)

### Local dev
Create/update:

- `insurance-fraud-detection-and-investigation-platform-2293/express_backend/.env`

with:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## 1) Extensions

```sql
create extension if not exists pgcrypto;
```

---

## 2) Schema objects

### 2.1 enums

```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'case_status') then
    create type public.case_status as enum ('new', 'triage', 'investigating', 'resolved', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'outcome_status') then
    create type public.outcome_status as enum ('fraud_confirmed', 'fraud_suspected', 'legit', 'needs_more_info', 'no_action');
  end if;

  if not exists (select 1 from pg_type where typname = 'assignment_role') then
    create type public.assignment_role as enum ('owner', 'collaborator', 'viewer');
  end if;
end $$;
```

---

### 2.2 tables

#### claims
One row per claim ingested from CSV.

```sql
create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),

  -- Business identifier from source system (if provided)
  claim_number text,

  -- Claim party & policy context (MVP: flexible)
  policy_number text,
  claimant_name text,
  claimant_email text,
  claimant_phone text,

  -- Event/financial details
  incident_date date,
  report_date date,
  claim_amount numeric(14,2),
  currency text default 'USD',

  -- Location or context fields
  incident_state text,
  incident_city text,

  -- Ingest metadata
  source_file_name text,
  source_row_number integer,

  -- Scoring fields (computed by backend)
  risk_score numeric(6,3) not null default 0,
  risk_band text not null default 'low', -- 'low'|'medium'|'high' (MVP as text)

  -- Operational status
  status text not null default 'open', -- 'open'|'in_review'|'closed' etc. (MVP as text)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### fraud_signals
Normalized signals/explanations for each claim. Multiple signals per claim.

```sql
create table if not exists public.fraud_signals (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,

  signal_code text not null,            -- e.g. 'HIGH_CLAIM_AMOUNT'
  signal_name text not null,            -- human readable
  severity integer not null default 1,   -- 1-5
  weight numeric(8,3) not null default 0,

  -- Rich explanation / evidence
  description text,
  evidence jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);
```

#### cases
A case is the investigative wrapper around a claim. Typically 1:1 with claim (MVP),
but allows future expansion to multi-claim cases by decoupling.

```sql
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),

  claim_id uuid not null unique references public.claims(id) on delete cascade,

  status public.case_status not null default 'new',

  -- Priority used for queue ordering; higher = more important
  priority integer not null default 0,

  -- Denormalized snapshot for fast queue queries (optional but helpful)
  risk_score_snapshot numeric(6,3),
  risk_band_snapshot text,

  -- Audit / notes
  title text,
  description text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### case_assignments
Assignments of investigators to cases (supports many-to-many).
Uses `auth.users.id` uuid as user_id.

```sql
create table if not exists public.case_assignments (
  id uuid primary key default gen_random_uuid(),

  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null, -- references auth.users(id) (cannot FK across schema reliably in all setups)

  role public.assignment_role not null default 'owner',

  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

-- Prevent duplicate active assignments for same case/user
create unique index if not exists case_assignments_unique_active
on public.case_assignments(case_id, user_id)
where unassigned_at is null;
```

#### outcomes
Investigator outcome decisions; allow multiple outcomes over time but only one "current" (MVP uses latest by created_at).

```sql
create table if not exists public.outcomes (
  id uuid primary key default gen_random_uuid(),

  claim_id uuid not null references public.claims(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,

  outcome public.outcome_status not null,
  notes text,

  decided_by uuid, -- auth.users(id)
  decided_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);
```

---

## 3) Triggers for updated_at

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_claims_updated_at on public.claims;
create trigger set_claims_updated_at
before update on public.claims
for each row execute function public.set_updated_at();

drop trigger if exists set_cases_updated_at on public.cases;
create trigger set_cases_updated_at
before update on public.cases
for each row execute function public.set_updated_at();
```

---

## 4) Indexes (queue + reporting)

### claims indexes
```sql
create index if not exists claims_created_at_idx on public.claims(created_at desc);
create index if not exists claims_risk_score_idx on public.claims(risk_score desc);
create index if not exists claims_risk_band_idx on public.claims(risk_band);
create index if not exists claims_status_idx on public.claims(status);
create index if not exists claims_claim_number_idx on public.claims(claim_number);
```

### fraud_signals indexes
```sql
create index if not exists fraud_signals_claim_id_idx on public.fraud_signals(claim_id);
create index if not exists fraud_signals_code_idx on public.fraud_signals(signal_code);
create index if not exists fraud_signals_severity_idx on public.fraud_signals(severity desc);
```

### cases indexes
```sql
create index if not exists cases_status_idx on public.cases(status);
create index if not exists cases_priority_idx on public.cases(priority desc);
create index if not exists cases_updated_at_idx on public.cases(updated_at desc);

-- queue ordering helper (common sort: status -> priority -> risk_score_snapshot -> updated_at)
create index if not exists cases_queue_sort_idx
on public.cases(status, priority desc, risk_score_snapshot desc nulls last, updated_at desc);
```

### outcomes indexes
```sql
create index if not exists outcomes_claim_id_idx on public.outcomes(claim_id);
create index if not exists outcomes_case_id_idx on public.outcomes(case_id);
create index if not exists outcomes_decided_at_idx on public.outcomes(decided_at desc);
create index if not exists outcomes_outcome_idx on public.outcomes(outcome);
```

---

## 5) Reporting Views (MVP)

### 5.1 Latest outcome per claim
```sql
create or replace view public.v_claim_latest_outcome as
select distinct on (o.claim_id)
  o.claim_id,
  o.outcome,
  o.notes,
  o.decided_by,
  o.decided_at,
  o.created_at
from public.outcomes o
order by o.claim_id, o.decided_at desc, o.created_at desc;
```

### 5.2 Queue view (claims + case + latest outcome)
```sql
create or replace view public.v_queue as
select
  c.id as case_id,
  cl.id as claim_id,
  cl.claim_number,
  cl.policy_number,
  cl.claimant_name,
  cl.incident_date,
  cl.report_date,
  cl.claim_amount,
  cl.currency,
  cl.risk_score,
  cl.risk_band,
  cl.status as claim_status,
  c.status as case_status,
  c.priority,
  c.updated_at as case_updated_at,
  lo.outcome as latest_outcome,
  lo.decided_at as latest_outcome_at
from public.cases c
join public.claims cl on cl.id = c.claim_id
left join public.v_claim_latest_outcome lo on lo.claim_id = cl.id;
```

### 5.3 Summary counts for dashboard
```sql
create or replace view public.v_reports_summary as
select
  now() as generated_at,

  count(*) as total_claims,
  count(*) filter (where risk_band = 'high') as high_risk_claims,
  count(*) filter (where risk_band = 'medium') as medium_risk_claims,
  count(*) filter (where risk_band = 'low') as low_risk_claims,

  count(*) filter (where status = 'open') as open_claims,

  -- Outcomes (latest only)
  count(*) filter (where lo.outcome = 'fraud_confirmed') as fraud_confirmed,
  count(*) filter (where lo.outcome = 'fraud_suspected') as fraud_suspected,
  count(*) filter (where lo.outcome = 'legit') as legit,
  count(*) filter (where lo.outcome = 'needs_more_info') as needs_more_info,
  count(*) filter (where lo.outcome = 'no_action') as no_action
from public.claims cl
left join public.v_claim_latest_outcome lo on lo.claim_id = cl.id;
```

---

## 6) RLS (Minimal, MVP)

### Philosophy
- **Backend (Express) should use Supabase Service Role** for ingest/scoring/writes. Service role bypasses RLS.
- For authenticated investigator users (Supabase Auth):
  - Allow read of queue/claims/signals/cases/outcomes
  - Allow update of cases (status/priority/title/description) if assigned
  - Allow insert outcomes if assigned

> If you want truly open internal-tool access for any authenticated user, you can simplify policies further (e.g., allow all authenticated on all tables). Below is a reasonable minimum.

### Enable RLS
```sql
alter table public.claims enable row level security;
alter table public.fraud_signals enable row level security;
alter table public.cases enable row level security;
alter table public.case_assignments enable row level security;
alter table public.outcomes enable row level security;
```

### Claims policies
```sql
drop policy if exists "claims_read_authenticated" on public.claims;
create policy "claims_read_authenticated"
on public.claims
for select
to authenticated
using (true);
```

### Fraud signals policies
```sql
drop policy if exists "signals_read_authenticated" on public.fraud_signals;
create policy "signals_read_authenticated"
on public.fraud_signals
for select
to authenticated
using (true);
```

### Cases policies
Read allowed for authenticated.

```sql
drop policy if exists "cases_read_authenticated" on public.cases;
create policy "cases_read_authenticated"
on public.cases
for select
to authenticated
using (true);
```

Update allowed only if user is actively assigned to the case.

```sql
drop policy if exists "cases_update_assigned" on public.cases;
create policy "cases_update_assigned"
on public.cases
for update
to authenticated
using (
  exists (
    select 1 from public.case_assignments ca
    where ca.case_id = cases.id
      and ca.user_id = auth.uid()
      and ca.unassigned_at is null
  )
)
with check (
  exists (
    select 1 from public.case_assignments ca
    where ca.case_id = cases.id
      and ca.user_id = auth.uid()
      and ca.unassigned_at is null
  )
);
```

### Case assignments policies
Allow authenticated to read assignments (MVP).

```sql
drop policy if exists "case_assignments_read_authenticated" on public.case_assignments;
create policy "case_assignments_read_authenticated"
on public.case_assignments
for select
to authenticated
using (true);
```

> Inserts/updates of assignments should be done by backend service role for MVP (no policy).

### Outcomes policies
Read allowed for authenticated.

```sql
drop policy if exists "outcomes_read_authenticated" on public.outcomes;
create policy "outcomes_read_authenticated"
on public.outcomes
for select
to authenticated
using (true);
```

Insert allowed only if user is actively assigned to the case (or claim’s case).

```sql
drop policy if exists "outcomes_insert_assigned" on public.outcomes;
create policy "outcomes_insert_assigned"
on public.outcomes
for insert
to authenticated
with check (
  -- If case_id is provided, require assignment to that case
  (case_id is not null and exists (
    select 1 from public.case_assignments ca
    where ca.case_id = outcomes.case_id
      and ca.user_id = auth.uid()
      and ca.unassigned_at is null
  ))
  OR
  -- If only claim_id, require assignment to the case linked to the claim
  (case_id is null and exists (
    select 1
    from public.cases cs
    join public.case_assignments ca on ca.case_id = cs.id
    where cs.claim_id = outcomes.claim_id
      and ca.user_id = auth.uid()
      and ca.unassigned_at is null
  ))
);
```

---

## 7) Notes / expected backend usage

- Ingest flow (service role):
  1) Insert claim into `claims`
  2) Upsert/insert `cases` row for claim (keep 1:1 via `cases.claim_id unique`)
  3) Insert many `fraud_signals` for claim
  4) Optionally set `cases.risk_score_snapshot` / `risk_band_snapshot` to match claim

- Queue endpoint:
  - Query `v_queue` ordered by `case_status`, `priority desc`, `risk_score desc`, `case_updated_at desc`

- Reporting endpoint:
  - Query `v_reports_summary`

---

## 8) Optional hardening for later
- Move `risk_band` to enum
- Add `organizations` / multi-tenancy & RLS constraints
- Add generated columns for derived fields
- Add `case_events` audit log table
- Partition large `fraud_signals` tables by month if volume grows
