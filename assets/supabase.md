# Supabase (Removed)

This project previously used Supabase Postgres for persistence.

As of the latest refactor, **Supabase is no longer used**:
- The Express backend stores uploaded claims, fraud signals, cases/queue, outcomes, and reports **only in process memory**.
- Data resets when the backend restarts.
- There are no required Supabase environment variables for the backend anymore.

If you need persistence again in the future, re-introduce a database layer (Supabase/Postgres/SQLite) behind the same store interface in:
- `express_backend/src/services/claimsStore.js`
