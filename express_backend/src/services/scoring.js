/**
 * Rule-based fraud scoring (MVP).
 * Input: a normalized claim object (strings/numbers/dates as JS values).
 * Output: { risk_score, risk_band, signals[] }
 */

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, '');
  return digits || null;
}

function daysBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function addSignal(signals, signal) {
  signals.push({
    signal_code: signal.signal_code,
    signal_name: signal.signal_name,
    severity: signal.severity,
    weight: signal.weight,
    description: signal.description || null,
    evidence: signal.evidence || {}
  });
}

function computeRiskBand(score) {
  if (score >= 0.75) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Compute score via additive weights then squashed to 0..1.
 * Weights are designed for interpretability, not ML accuracy.
 */
function squash(totalWeight) {
  // logistic-ish squash; keep deterministic and simple
  const x = clamp(totalWeight, 0, 10);
  return clamp(x / 10, 0, 1);
}

// PUBLIC_INTERFACE
function scoreClaim(claim) {
  /** Scores a claim and returns an explanation-rich payload. */
  const signals = [];

  const claimAmount = toNumberOrNull(claim.claim_amount);
  const incidentDate = claim.incident_date instanceof Date ? claim.incident_date : null;
  const reportDate = claim.report_date instanceof Date ? claim.report_date : null;

  let weightTotal = 0;

  // 1) High claim amount
  if (claimAmount !== null) {
    if (claimAmount >= 25000) {
      const weight = 2.5;
      weightTotal += weight;
      addSignal(signals, {
        signal_code: 'HIGH_CLAIM_AMOUNT',
        signal_name: 'High claim amount',
        severity: 5,
        weight,
        description: 'Claim amount is above $25,000.',
        evidence: { claim_amount: claimAmount, threshold: 25000 }
      });
    } else if (claimAmount >= 10000) {
      const weight = 1.5;
      weightTotal += weight;
      addSignal(signals, {
        signal_code: 'ELEVATED_CLAIM_AMOUNT',
        signal_name: 'Elevated claim amount',
        severity: 3,
        weight,
        description: 'Claim amount is above $10,000.',
        evidence: { claim_amount: claimAmount, threshold: 10000 }
      });
    }
  }

  // 2) Late reporting: report_date - incident_date
  const lagDays = incidentDate && reportDate ? daysBetween(incidentDate, reportDate) : null;
  if (lagDays !== null) {
    if (lagDays >= 30) {
      const weight = 2.0;
      weightTotal += weight;
      addSignal(signals, {
        signal_code: 'LATE_REPORTED_INCIDENT',
        signal_name: 'Late reported incident',
        severity: 4,
        weight,
        description: 'Incident was reported 30+ days after occurrence.',
        evidence: { lag_days: lagDays, threshold_days: 30 }
      });
    } else if (lagDays >= 14) {
      const weight = 1.0;
      weightTotal += weight;
      addSignal(signals, {
        signal_code: 'DELAYED_REPORTING',
        signal_name: 'Delayed reporting',
        severity: 2,
        weight,
        description: 'Incident was reported 14+ days after occurrence.',
        evidence: { lag_days: lagDays, threshold_days: 14 }
      });
    }
  }

  // 3) Missing contact details
  const emailMissing = !claim.claimant_email;
  const phoneMissing = !normalizePhone(claim.claimant_phone);
  if (emailMissing || phoneMissing) {
    const weight = emailMissing && phoneMissing ? 1.5 : 0.75;
    weightTotal += weight;
    addSignal(signals, {
      signal_code: 'MISSING_CONTACT_INFO',
      signal_name: 'Missing contact information',
      severity: emailMissing && phoneMissing ? 3 : 2,
      weight,
      description: 'Claimant is missing email and/or phone contact info.',
      evidence: { claimant_email_present: !emailMissing, claimant_phone_present: !phoneMissing }
    });
  }

  // 4) Suspicious location: missing state/city
  if (!claim.incident_state || !claim.incident_city) {
    const weight = 0.6;
    weightTotal += weight;
    addSignal(signals, {
      signal_code: 'INCOMPLETE_LOCATION',
      signal_name: 'Incomplete incident location',
      severity: 2,
      weight,
      description: 'Incident state and/or city is missing.',
      evidence: { incident_state: claim.incident_state || null, incident_city: claim.incident_city || null }
    });
  }

  // 5) Missing identifiers (policy/claim number)
  if (!claim.policy_number || !claim.claim_number) {
    const weight = 0.8;
    weightTotal += weight;
    addSignal(signals, {
      signal_code: 'MISSING_IDENTIFIERS',
      signal_name: 'Missing policy/claim identifiers',
      severity: 2,
      weight,
      description: 'Policy number and/or claim number is missing.',
      evidence: { policy_number_present: !!claim.policy_number, claim_number_present: !!claim.claim_number }
    });
  }

  // 6) Very recent incident (possible staging) - if incident_date within last 2 days
  if (incidentDate) {
    const now = new Date();
    const daysAgo = daysBetween(incidentDate, now);
    if (daysAgo !== null && daysAgo <= 2) {
      const weight = 0.7;
      weightTotal += weight;
      addSignal(signals, {
        signal_code: 'VERY_RECENT_INCIDENT',
        signal_name: 'Very recent incident',
        severity: 1,
        weight,
        description: 'Incident date is within the last 2 days.',
        evidence: { incident_date: incidentDate.toISOString().slice(0, 10), days_ago: daysAgo, threshold_days: 2 }
      });
    }
  }

  const risk_score = Number(squash(weightTotal).toFixed(3));
  const risk_band = computeRiskBand(risk_score);

  return { risk_score, risk_band, signals };
}

module.exports = {
  scoreClaim
};
