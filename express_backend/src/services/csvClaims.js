const { parse } = require('csv-parse/sync');

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

// PUBLIC_INTERFACE
function parseClaimsCsv(buffer, sourceFileName) {
  /** Parse CSV buffer into normalized claim objects with source_row_number metadata. */
  const csvText = buffer.toString('utf8');

  const records = parse(csvText, {
    columns: (headers) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    trim: true
  });

  // Expected (flexible): claim_number, policy_number, claimant_name, claimant_email, claimant_phone,
  // incident_date, report_date, claim_amount, currency, incident_state, incident_city
  return records.map((r, idx) => ({
    claim_number: asText(r.claim_number) || asText(r.claimid) || asText(r.claim_no),
    policy_number: asText(r.policy_number) || asText(r.policyid) || asText(r.policy_no),
    claimant_name: asText(r.claimant_name) || asText(r.name) || asText(r.claimant),
    claimant_email: asText(r.claimant_email) || asText(r.email),
    claimant_phone: asText(r.claimant_phone) || asText(r.phone) || asText(r.mobile),
    incident_date: asDate(r.incident_date) || asDate(r.loss_date) || asDate(r.date_of_loss),
    report_date: asDate(r.report_date) || asDate(r.filed_date) || asDate(r.date_reported),
    claim_amount: asMoney(r.claim_amount) || asMoney(r.amount) || asMoney(r.loss_amount),
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
