const { createClient } = require('@supabase/supabase-js');
const { ConfigError } = require('../middleware/errors');

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
    const missing = [];
    if (!url) missing.push('SUPABASE_URL');
    if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

    // Intentionally throw so requests fail loudly with actionable info,
    // but keep it structured so middleware can turn it into a 503.
    throw new ConfigError(
      'Backend is missing required Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      { missing_env: missing }
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
