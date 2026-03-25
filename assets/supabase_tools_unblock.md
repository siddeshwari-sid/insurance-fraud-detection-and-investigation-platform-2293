# SupabaseTools unblock instructions (Kavia)

## Symptom
Supabase tool calls like `list_tables` / `run_sql` fail with:

- `PGRST202 Could not find the function public.run_sql(query) in the schema cache`

## Cause
Kavia SupabaseTools execute SQL via an RPC named `public.run_sql`. If the function does not exist in your Supabase project, the tools cannot introspect or migrate the database.

## Fix (run in Supabase SQL editor)
```sql
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

## After the fix
1. Wait ~30–60 seconds for the schema cache to refresh (or reload the Supabase dashboard).
2. Re-run the automation step to:
   - list existing tables
   - create any missing tables
   - apply RLS policies, triggers, indexes, and views

## Backend env vars to set
From `insurance-fraud-detection-and-investigation-platform-2293/express_backend/.env.example`:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
