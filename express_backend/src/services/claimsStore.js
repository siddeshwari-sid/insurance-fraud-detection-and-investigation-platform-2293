const crypto = require('crypto');
const { notFound, badRequest } = require('../middleware/errors');

/**
 * In-memory datastore (MVP)
 * -------------------------
 * This module intentionally stores everything in process memory:
 * - claims
 * - fraud signals
 * - cases (1:1 with claim)
 * - outcomes (history; latest used for views)
 *
 * NOTE: Data will be lost on server restart and is not shared across instances.
 */

// Maps keyed by id
const claimsById = new Map(); // claimId -> claim row
const signalsByClaimId = new Map(); // claimId -> FraudSignal[]
const casesByClaimId = new Map(); // claimId -> case row
const outcomesByClaimId = new Map(); // claimId -> Outcome[] (history)

function uuid() {
  // Node 18+ supports randomUUID; fallback to crypto for safety.
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function toIsoDateTime(d) {
  if (!d) return new Date().toISOString();
  if (d instanceof Date) return d.toISOString();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toIsoDateOnly(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function computePriority(riskBand) {
  return riskBand === 'high' ? 3 : riskBand === 'medium' ? 1 : 0;
}

function withRiskPct(claim) {
  const raw = claim && claim.risk_score !== undefined && claim.risk_score !== null ? Number(claim.risk_score) : null;
  const risk_score_pct = raw === null || Number.isNaN(raw) ? null : Math.round(raw * 100);
  return { ...claim, risk_score_pct };
}

function latestOutcomeForClaim(claimId) {
  const arr = outcomesByClaimId.get(claimId) || [];
  if (!arr.length) return null;
  // ISO8601 string compare is safe lexicographically.
  return [...arr].sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0];
}

function queueRowForClaim(claim, caseRow, latestOutcome) {
  return {
    case_id: caseRow.id,
    claim_id: claim.id,
    claim_number: claim.claim_number || null,
    policy_number: claim.policy_number || null,
    claimant_name: claim.claimant_name || null,
    incident_date: claim.incident_date || null,
    report_date: claim.report_date || null,
    claim_amount: claim.claim_amount ?? null,
    currency: claim.currency || 'USD',
    risk_score: claim.risk_score ?? 0,
    risk_band: claim.risk_band || 'low',
    claim_status: claim.status || 'open',
    case_status: caseRow.status || 'new',
    priority: caseRow.priority || 0,
    case_updated_at: caseRow.updated_at,
    latest_outcome: latestOutcome ? latestOutcome.outcome : null,
    latest_outcome_at: latestOutcome ? latestOutcome.decided_at : null
  };
}

// PUBLIC_INTERFACE
async function insertClaimWithCaseAndSignals({ claim, scoring }) {
  /** Inserts claim, creates/updates case (1:1), and inserts fraud signals. Returns created claim row. */
  try {
    const now = new Date().toISOString();
    const id = uuid();

    const createdClaim = {
      id,
      claim_number: claim.claim_number ?? null,
      policy_number: claim.policy_number ?? null,
      claimant_name: claim.claimant_name ?? null,
      claimant_email: claim.claimant_email ?? null,
      claimant_phone: claim.claimant_phone ?? null,

      // Persist as ISO date-only strings for consistent UI display.
      incident_date: toIsoDateOnly(claim.incident_date),
      report_date: toIsoDateOnly(claim.report_date),

      claim_amount: claim.claim_amount ?? null,
      currency: claim.currency || 'USD',
      incident_state: claim.incident_state ?? null,
      incident_city: claim.incident_city ?? null,

      source_file_name: claim.source_file_name ?? null,
      source_row_number: claim.source_row_number ?? null,

      risk_score: scoring.risk_score,
      risk_band: scoring.risk_band,
      status: 'open',

      created_at: now,
      updated_at: now
    };

    claimsById.set(id, createdClaim);

    const priority = computePriority(scoring.risk_band);
    const createdCase = {
      id: uuid(),
      claim_id: id,
      status: 'new',
      priority,
      risk_score_snapshot: scoring.risk_score,
      risk_band_snapshot: scoring.risk_band,
      title: createdClaim.claim_number ? `Claim ${createdClaim.claim_number}` : `Claim ${id.slice(0, 8)}`,
      description: null,
      created_at: now,
      updated_at: now
    };
    casesByClaimId.set(id, createdCase);

    const sigs = (scoring.signals || []).map((s) => ({
      id: uuid(),
      claim_id: id,
      signal_code: s.signal_code,
      signal_name: s.signal_name,
      severity: s.severity,
      weight: s.weight,
      description: s.description || null,
      evidence: s.evidence || {},
      created_at: now
    }));
    signalsByClaimId.set(id, sigs);

    outcomesByClaimId.set(id, outcomesByClaimId.get(id) || []);

    return createdClaim;
  } catch (e) {
    throw badRequest('Failed to insert claim (in-memory store)', { error: e?.message || String(e) });
  }
}

// PUBLIC_INTERFACE
async function listClaims({ limit, offset, risk_band, status, claim_number }) {
  /** Lists claims with optional filters; returns {items, total, limit, offset}. */
  const lim = limit || 50;
  const off = offset || 0;

  let items = Array.from(claimsById.values());

  // Newest first
  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  if (risk_band) items = items.filter((c) => c.risk_band === risk_band);
  if (status) items = items.filter((c) => c.status === status);
  if (claim_number) {
    const q = String(claim_number).toLowerCase();
    items = items.filter((c) => String(c.claim_number || '').toLowerCase().includes(q));
  }

  const total = items.length;
  const paged = items.slice(off, off + lim).map(withRiskPct);

  return { items: paged, total, limit: lim, offset: off };
}

// PUBLIC_INTERFACE
async function getClaimDetail(claimId) {
  /** Gets claim + signals + latest outcome and case row. */
  const claim = claimsById.get(claimId);
  if (!claim) throw notFound('Claim not found');

  const signals = signalsByClaimId.get(claimId) || [];
  const caseRow = casesByClaimId.get(claimId) || null;
  const latest_outcome = latestOutcomeForClaim(claimId);

  const sortedSignals = [...signals].sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return String(a.created_at).localeCompare(String(b.created_at));
  });

  return {
    claim: withRiskPct(claim),
    case: caseRow,
    signals: sortedSignals,
    latest_outcome
  };
}

// PUBLIC_INTERFACE
async function createOutcomeForClaim(claimId, outcomeBody) {
  /** Creates an outcome record for a claim, linked to its case if exists. */
  const claim = claimsById.get(claimId);
  if (!claim) throw notFound('Claim not found');

  const caseRow = casesByClaimId.get(claimId) || null;
  const now = new Date().toISOString();

  const outcome = {
    id: uuid(),
    claim_id: claimId,
    case_id: caseRow ? caseRow.id : null,
    outcome: outcomeBody.outcome,
    notes: outcomeBody.notes || null,
    decided_by: outcomeBody.decided_by || null,
    decided_at: toIsoDateTime(now),
    created_at: toIsoDateTime(now)
  };

  const history = outcomesByClaimId.get(claimId) || [];
  history.push(outcome);
  outcomesByClaimId.set(claimId, history);

  // Close claim on legit/no_action/fraud_confirmed (simple MVP).
  const shouldClose = ['legit', 'no_action', 'fraud_confirmed'].includes(outcomeBody.outcome);
  if (shouldClose) {
    claimsById.set(claimId, { ...claim, status: 'closed', updated_at: now });
  }

  // Touch case for queue ordering freshness.
  if (caseRow) {
    casesByClaimId.set(claimId, { ...caseRow, updated_at: now });
  }

  return outcome;
}

// PUBLIC_INTERFACE
async function getQueue({ limit, offset }) {
  /** Returns queue rows derived from in-memory claims/cases/outcomes. */
  const lim = limit || 50;
  const off = offset || 0;

  const rows = [];

  for (const claim of claimsById.values()) {
    const caseRow = casesByClaimId.get(claim.id);
    if (!caseRow) continue;
    const lo = latestOutcomeForClaim(claim.id);
    rows.push(queueRowForClaim(withRiskPct(claim), caseRow, lo));
  }

  // Order similar to intended Supabase view ordering.
  rows.sort((a, b) => {
    const cs = String(a.case_status).localeCompare(String(b.case_status));
    if (cs !== 0) return cs;

    if (Number(b.priority) !== Number(a.priority)) return Number(b.priority) - Number(a.priority);

    const ra = Number(a.risk_score ?? 0);
    const rb = Number(b.risk_score ?? 0);
    if (rb !== ra) return rb - ra;

    return String(b.case_updated_at).localeCompare(String(a.case_updated_at));
  });

  const total = rows.length;
  const paged = rows.slice(off, off + lim);

  return { items: paged, total, limit: lim, offset: off };
}

// PUBLIC_INTERFACE
async function getReportsSummary() {
  /** Returns dashboard summary counts computed from in-memory store. */
  const generated_at = new Date().toISOString();
  const claims = Array.from(claimsById.values());

  const total_claims = claims.length;
  const high_risk_claims = claims.filter((c) => c.risk_band === 'high').length;
  const medium_risk_claims = claims.filter((c) => c.risk_band === 'medium').length;
  const low_risk_claims = claims.filter((c) => c.risk_band === 'low').length;
  const open_claims = claims.filter((c) => c.status === 'open').length;

  const latest = claims.map((c) => latestOutcomeForClaim(c.id)).filter(Boolean);
  const countOutcome = (o) => latest.filter((x) => x.outcome === o).length;

  return {
    generated_at,
    total_claims,
    high_risk_claims,
    medium_risk_claims,
    low_risk_claims,
    open_claims,
    fraud_confirmed: countOutcome('fraud_confirmed'),
    fraud_suspected: countOutcome('fraud_suspected'),
    legit: countOutcome('legit'),
    needs_more_info: countOutcome('needs_more_info'),
    no_action: countOutcome('no_action')
  };
}

module.exports = {
  insertClaimWithCaseAndSignals,
  listClaims,
  getClaimDetail,
  createOutcomeForClaim,
  getQueue,
  getReportsSummary
};
