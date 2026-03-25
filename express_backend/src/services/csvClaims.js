const { parse } = require('csv-parse/sync');
const { badRequest } = require('../middleware/errors');

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function asText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asDate(v) {
  const s = asText(v);
  if (!s) return null;

  // Accept YYYY-MM-DD or other parseable formats.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  // Force date-only semantics: keep Date but upstream will store to Postgres date.
  return d;
}

function asMoney(v) {
  const s = asText(v);
  if (!s) return null;
  const cleaned = s.replace(/[$,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function validateRequiredColumns(rawHeaders) {
  const headers = (rawHeaders || []).map(normalizeHeader);

  // Authoritative requirements: these columns must exist in the CSV header.
  // Note: requirement says `amount`; we accept `amount` OR `claim_amount` in the header,
  // but at least one must be present.
  const required = [
    'claim_number',
    'claimant_name',
    'policy_number',
    'incident_date',
    'report_date'
  ];

  const missing = required.filter((h) => !headers.includes(h));
  const hasAmount = headers.includes('amount') || headers.includes('claim_amount');

  if (missing.length || !hasAmount) {
    if (!hasAmount) missing.push('amount');
    throw badRequest('CSV validation error: missing required columns.', {
      missing_columns: missing,
      received_columns: headers
    });
  }
}

// PUBLIC_INTERFACE
function parseClaimsCsv(buffer, sourceFileName) {
  /** Parse CSV buffer into normalized claim objects with source_row_number metadata. */
  const csvText = buffer.toString('utf8');

  let records;
  try {
    records = parse(csvText, {
      columns: (headers) => {
        validateRequiredColumns(headers);
        return headers.map(normalizeHeader);
      },
      skip_empty_lines: true,
      trim: true
    });
  } catch (err) {
    // If it's already an ApiError, rethrow; otherwise normalize as a 400.
    if (err && err.statusCode) throw err;

    throw badRequest('Failed to parse CSV. Ensure it is a valid CSV with a header row.', {
      error: err && err.message ? err.message : String(err)
    });
  }

  return records.map((r, idx) => ({
    // Required fields (validated by header presence; row values may still be empty)
    claim_number: asText(r.claim_number) || asText(r.claimid) || asText(r.claim_no),
    claimant_name: asText(r.claimant_name) || asText(r.name) || asText(r.claimant),
    policy_number: asText(r.policy_number) || asText(r.policyid) || asText(r.policy_no),
    incident_date: asDate(r.incident_date) || asDate(r.loss_date) || asDate(r.date_of_loss),
    report_date: asDate(r.report_date) || asDate(r.filed_date) || asDate(r.date_reported),

    // Amount requirement: accept `amount` alias or other common aliases
    claim_amount:
      asMoney(r.amount) || asMoney(r.claim_amount) || asMoney(r.loss_amount) || asMoney(r.claimvalue),

    // Optional fields
    claimant_email: asText(r.claimant_email) || asText(r.email),
    claimant_phone: asText(r.claimant_phone) || asText(r.phone) || asText(r.mobile),
    currency: asText(r.currency) || 'USD',
    incident_state: asText(r.incident_state) || asText(r.state),
    incident_city: asText(r.incident_city) || asText(r.city),

    source_file_name: asText(sourceFileName) || null,
    source_row_number: idx + 2 // +2 to account for header row and 1-based indexing in spreadsheets
  }));
}

module.exports = {
  parseClaimsCsv
};
