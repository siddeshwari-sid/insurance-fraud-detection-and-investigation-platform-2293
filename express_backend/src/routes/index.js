const express = require('express');
const healthController = require('../controllers/health');
const claimsController = require('../controllers/claims');
const queueController = require('../controllers/queue');
const reportsController = require('../controllers/reports');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Health
 *     description: Service health checks
 *   - name: Claims
 *     description: Claims ingest, listing, detail, and outcomes
 *   - name: Queue
 *     description: Case/claim prioritization queue for investigators
 *   - name: Reports
 *     description: Dashboard reporting endpoints
 */

/**
 * @swagger
 * /:
 *   get:
 *     tags: [Health]
 *     summary: Health endpoint
 *     responses:
 *       200:
 *         description: Service health check passed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: Service is healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 environment:
 *                   type: string
 *                   example: development
 */
router.get('/', healthController.check.bind(healthController));

/**
 * @swagger
 * components:
 *   schemas:
 *     FraudSignal:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         claim_id: { type: string, format: uuid }
 *         signal_code: { type: string, example: HIGH_CLAIM_AMOUNT }
 *         signal_name: { type: string, example: High claim amount }
 *         severity: { type: integer, example: 5 }
 *         weight: { type: number, example: 2.5 }
 *         description: { type: string }
 *         evidence: { type: object }
 *         created_at: { type: string, format: date-time }
 *     Claim:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         claim_number: { type: string, nullable: true }
 *         policy_number: { type: string, nullable: true }
 *         claimant_name: { type: string, nullable: true }
 *         claimant_email: { type: string, nullable: true }
 *         claimant_phone: { type: string, nullable: true }
 *         incident_date: { type: string, format: date, nullable: true }
 *         report_date: { type: string, format: date, nullable: true }
 *         claim_amount: { type: number, nullable: true }
 *         currency: { type: string, example: USD }
 *         incident_state: { type: string, nullable: true }
 *         incident_city: { type: string, nullable: true }
 *         source_file_name: { type: string, nullable: true }
 *         source_row_number: { type: integer, nullable: true }
 *         risk_score: { type: number, example: 0.82 }
 *         risk_band: { type: string, example: high }
 *         status: { type: string, example: open }
 *         created_at: { type: string, format: date-time }
 *         updated_at: { type: string, format: date-time }
 *     OutcomeCreate:
 *       type: object
 *       required: [outcome]
 *       properties:
 *         outcome:
 *           type: string
 *           enum: [fraud_confirmed, fraud_suspected, legit, needs_more_info, no_action]
 *         notes:
 *           type: string
 *           nullable: true
 *         decided_by:
 *           type: string
 *           format: uuid
 *           nullable: true
 */

/**
 * @swagger
 * /api/claims/upload:
 *   post:
 *     tags: [Claims]
 *     summary: Upload CSV claims file, score claims, and persist results
 *     description: |
 *       Upload a CSV file via multipart/form-data field `file`.
 *       The backend parses rows into claims, computes a rule-based fraud risk score,
 *       stores the claim, creates/updates a case, and stores explained fraud signals.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Claims ingested successfully
 *       400:
 *         description: Validation or parsing error
 *       500:
 *         description: Server error
 */
router.post(
  '/api/claims/upload',
  claimsController.uploadMiddleware(),
  claimsController.upload.bind(claimsController)
);

/**
 * @swagger
 * /api/claims:
 *   get:
 *     tags: [Claims]
 *     summary: List claims
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0, maximum: 5000 }
 *       - in: query
 *         name: risk_band
 *         schema: { type: string, enum: [low, medium, high] }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: claim_number
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Claims list
 */
router.get('/api/claims', claimsController.list.bind(claimsController));

/**
 * @swagger
 * /api/claims/{id}:
 *   get:
 *     tags: [Claims]
 *     summary: Get claim detail (including signals and latest outcome)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Claim detail
 *       404:
 *         description: Not found
 */
router.get('/api/claims/:id', claimsController.detail.bind(claimsController));

/**
 * @swagger
 * /api/claims/{id}/outcome:
 *   post:
 *     tags: [Claims]
 *     summary: Record an outcome decision for a claim
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OutcomeCreate'
 *     responses:
 *       201:
 *         description: Outcome created
 *       400:
 *         description: Validation error
 */
router.post('/api/claims/:id/outcome', claimsController.outcome.bind(claimsController));

/**
 * @swagger
 * /api/queue:
 *   get:
 *     tags: [Queue]
 *     summary: Get investigative queue (cases + claim snapshots)
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0, maximum: 5000 }
 *     responses:
 *       200:
 *         description: Queue list
 */
router.get('/api/queue', queueController.list.bind(queueController));

/**
 * @swagger
 * /api/reports/summary:
 *   get:
 *     tags: [Reports]
 *     summary: Get dashboard summary counts
 *     responses:
 *       200:
 *         description: Summary payload
 */
router.get('/api/reports/summary', reportsController.summary.bind(reportsController));

module.exports = router;
