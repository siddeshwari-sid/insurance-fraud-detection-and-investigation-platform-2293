const { createClient } = require('@supabase/supabase-js');

/**
 * Creates a Supabase client using service-role key (recommended for backend writes).
 * Env vars expected:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */
function createSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    // Intentionally throw so startup/requests fail loudly with actionable info.
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. Please set them in the backend .env.'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

module.exports = {
  createSupabaseServiceClient
};
