const { createSupabaseServiceClient } = require('../db/supabase');
const { notFound, badRequest } = require('../middleware/errors');

function sb() {
  return createSupabaseServiceClient();
}

function mapClaimRow(row) {
  return row;
}

// PUBLIC_INTERFACE
async function insertClaimWithCaseAndSignals({ claim, scoring }) {
  /** Inserts claim, creates/updates case (1:1), and inserts fraud signals. Returns created claim id. */
  const supabase = sb();

  // Insert claim
  const { data: claimRows, error: claimErr } = await supabase
    .from('claims')
    .insert([
      {
        ...claim,
        risk_score: scoring.risk_score,
        risk_band: scoring.risk_band,
        status: 'open'
      }
    ])
    .select('*');

  if (claimErr) {
    throw badRequest('Failed to insert claim', { supabase: claimErr.message });
  }

  const insertedClaim = claimRows[0];

  // Upsert case 1:1
  const priority = scoring.risk_band === 'high' ? 3 : scoring.risk_band === 'medium' ? 1 : 0;
  const { error: caseErr } = await supabase
    .from('cases')
    .upsert(
      [
        {
          claim_id: insertedClaim.id,
          status: 'new',
          priority,
          risk_score_snapshot: scoring.risk_score,
          risk_band_snapshot: scoring.risk_band,
          title: insertedClaim.claim_number
            ? `Claim ${insertedClaim.claim_number}`
            : `Claim ${insertedClaim.id.slice(0, 8)}`,
          description: null
        }
      ],
      { onConflict: 'claim_id' }
    );

  if (caseErr) {
    throw badRequest('Failed to upsert case for claim', { supabase: caseErr.message });
  }

  // Insert signals
  if (scoring.signals && scoring.signals.length) {
    const payload = scoring.signals.map((s) => ({
      claim_id: insertedClaim.id,
      ...s
    }));

    const { error: sigErr } = await supabase.from('fraud_signals').insert(payload);
    if (sigErr) {
      throw badRequest('Failed to insert fraud signals', { supabase: sigErr.message });
    }
  }

  return mapClaimRow(insertedClaim);
}

// PUBLIC_INTERFACE
async function listClaims({ limit, offset, risk_band, status, claim_number }) {
  /** Lists claims with optional filters; returns {items, total}. */
  const supabase = sb();

  let query = supabase.from('claims').select('*', { count: 'exact' }).order('created_at', { ascending: false });

  if (risk_band) query = query.eq('risk_band', risk_band);
  if (status) query = query.eq('status', status);
  if (claim_number) query = query.ilike('claim_number', `%${claim_number}%`);

  const from = offset || 0;
  const to = from + (limit || 50) - 1;

  const { data, error, count } = await query.range(from, to);
  if (error) {
    throw badRequest('Failed to list claims', { supabase: error.message });
  }

  return { items: data || [], total: count || 0, limit: limit || 50, offset: offset || 0 };
}

// PUBLIC_INTERFACE
async function getClaimDetail(claimId) {
  /** Gets claim + signals + latest outcome and case row. */
  const supabase = sb();

  const { data: claimRows, error: claimErr } = await supabase.from('claims').select('*').eq('id', claimId).limit(1);
  if (claimErr) throw badRequest('Failed to fetch claim', { supabase: claimErr.message });
  if (!claimRows || !claimRows.length) throw notFound('Claim not found');

  const claim = claimRows[0];

  const { data: signals, error: sigErr } = await supabase
    .from('fraud_signals')
    .select('*')
    .eq('claim_id', claimId)
    .order('severity', { ascending: false })
    .order('created_at', { ascending: true });

  if (sigErr) throw badRequest('Failed to fetch fraud signals', { supabase: sigErr.message });

  const { data: caseRows, error: caseErr } = await supabase.from('cases').select('*').eq('claim_id', claimId).limit(1);
  if (caseErr) throw badRequest('Failed to fetch case', { supabase: caseErr.message });

  const { data: outcomes, error: outErr } = await supabase
    .from('outcomes')
    .select('*')
    .eq('claim_id', claimId)
    .order('decided_at', { ascending: false })
    .limit(1);

  if (outErr) throw badRequest('Failed to fetch outcomes', { supabase: outErr.message });

  return {
    claim,
    case: (caseRows && caseRows[0]) || null,
    signals: signals || [],
    latest_outcome: (outcomes && outcomes[0]) || null
  };
}

// PUBLIC_INTERFACE
async function createOutcomeForClaim(claimId, outcomeBody) {
  /** Creates an outcome record for a claim, linked to its case if exists. */
  const supabase = sb();

  const { data: caseRows, error: caseErr } = await supabase.from('cases').select('id').eq('claim_id', claimId).limit(1);
  if (caseErr) throw badRequest('Failed to resolve case for claim', { supabase: caseErr.message });

  const caseId = caseRows && caseRows[0] ? caseRows[0].id : null;

  const { data: outRows, error: outErr } = await supabase
    .from('outcomes')
    .insert([
      {
        claim_id: claimId,
        case_id: caseId,
        outcome: outcomeBody.outcome,
        notes: outcomeBody.notes || null,
        decided_by: outcomeBody.decided_by || null
      }
    ])
    .select('*');

  if (outErr) throw badRequest('Failed to create outcome', { supabase: outErr.message });

  // Optionally close claim on legit/no_action/fraud_confirmed (simple MVP).
  const shouldClose = ['legit', 'no_action', 'fraud_confirmed'].includes(outcomeBody.outcome);
  if (shouldClose) {
    const { error: updErr } = await supabase.from('claims').update({ status: 'closed' }).eq('id', claimId);
    if (updErr) {
      // Non-fatal; return outcome anyway.
      // eslint-disable-next-line no-console
      console.warn('Failed to update claim status:', updErr.message);
    }
  }

  return outRows[0];
}

// PUBLIC_INTERFACE
async function getQueue({ limit, offset }) {
  /** Returns queue rows from v_queue. */
  const supabase = sb();
  const from = offset || 0;
  const to = from + (limit || 50) - 1;

  const { data, error, count } = await supabase
    .from('v_queue')
    .select('*', { count: 'exact' })
    .order('case_status', { ascending: true })
    .order('priority', { ascending: false })
    .order('risk_score', { ascending: false })
    .order('case_updated_at', { ascending: false })
    .range(from, to);

  if (error) throw badRequest('Failed to fetch queue', { supabase: error.message });

  return { items: data || [], total: count || 0, limit: limit || 50, offset: offset || 0 };
}

// PUBLIC_INTERFACE
async function getReportsSummary() {
  /** Returns a single row from v_reports_summary. */
  const supabase = sb();
  const { data, error } = await supabase.from('v_reports_summary').select('*').limit(1);
  if (error) throw badRequest('Failed to fetch reports summary', { supabase: error.message });
  return (data && data[0]) || null;
}

module.exports = {
  insertClaimWithCaseAndSignals,
  listClaims,
  getClaimDetail,
  createOutcomeForClaim,
  getQueue,
  getReportsSummary
};
