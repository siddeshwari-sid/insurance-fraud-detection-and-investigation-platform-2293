const multer = require('multer');
const { parseClaimsCsv } = require('../services/csvClaims');
const { scoreClaim } = require('../services/scoring');
const store = require('../services/claimsStore');
const { claimListQuerySchema, outcomeBodySchema, validateUuid } = require('../validation/schemas');
const { badRequest } = require('../middleware/errors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

class ClaimsController {
  // PUBLIC_INTERFACE
  uploadMiddleware() {
    /** Returns multer middleware for CSV upload under form-data field `file`. */
    return upload.single('file');
  }

  // PUBLIC_INTERFACE
  async upload(req, res, next) {
    /** POST /api/claims/upload: parse CSV, score each claim, persist to Supabase, return created items. */
    try {
      if (!req.file || !req.file.buffer) {
        throw badRequest('Missing CSV file upload. Use multipart/form-data field "file".');
      }

      const sourceFileName = req.file.originalname || 'claims.csv';
      const claims = parseClaimsCsv(req.file.buffer, sourceFileName);

      if (!claims.length) {
        throw badRequest('CSV parsed successfully but contained no records.');
      }

      const created = [];
      for (const claim of claims) {
        const scoring = scoreClaim(claim);
        // eslint-disable-next-line no-await-in-loop
        const inserted = await store.insertClaimWithCaseAndSignals({ claim, scoring });
        created.push({
          claim: inserted,
          scoring_summary: { risk_score: scoring.risk_score, risk_band: scoring.risk_band, signals_count: scoring.signals.length }
        });
      }

      return res.status(201).json({
        status: 'ok',
        message: 'Claims uploaded successfully',
        data: {
          source_file_name: sourceFileName,
          ingested_count: created.length,
          items: created
        }
      });
    } catch (err) {
      return next(err);
    }
  }

  // PUBLIC_INTERFACE
  async list(req, res, next) {
    /** GET /api/claims: list claims with optional filters. */
    try {
      const query = claimListQuerySchema.parse(req.query || {});
      const result = await store.listClaims(query);
      return res.status(200).json({ status: 'ok', data: result });
    } catch (err) {
      return next(err);
    }
  }

  // PUBLIC_INTERFACE
  async detail(req, res, next) {
    /** GET /api/claims/:id: claim detail with signals and latest outcome. */
    try {
      const claimId = validateUuid(req.params.id);
      const result = await store.getClaimDetail(claimId);
      return res.status(200).json({ status: 'ok', data: result });
    } catch (err) {
      return next(err);
    }
  }

  // PUBLIC_INTERFACE
  async outcome(req, res, next) {
    /** POST /api/claims/:id/outcome: record an investigator decision. */
    try {
      const claimId = validateUuid(req.params.id);
      const body = outcomeBodySchema.parse(req.body || {});
      const created = await store.createOutcomeForClaim(claimId, body);
      return res.status(201).json({ status: 'ok', message: 'Outcome recorded', data: created });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new ClaimsController();
