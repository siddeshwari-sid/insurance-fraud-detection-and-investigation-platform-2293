const { z } = require('zod');

const uuidSchema = z.string().uuid();

const outcomeEnum = z.enum([
  'fraud_confirmed',
  'fraud_suspected',
  'legit',
  'needs_more_info',
  'no_action'
]);

// PUBLIC_INTERFACE
function validateUuid(id) {
  /** Validates a uuid and returns it, throwing ZodError on failure. */
  return uuidSchema.parse(id);
}

const claimListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
  risk_band: z.enum(['low', 'medium', 'high']).optional(),
  status: z.string().min(1).max(50).optional(),
  claim_number: z.string().min(1).max(100).optional()
});

const outcomeBodySchema = z.object({
  outcome: outcomeEnum,
  notes: z.string().max(2000).optional().nullable(),
  decided_by: uuidSchema.optional().nullable()
});

module.exports = {
  validateUuid,
  claimListQuerySchema,
  outcomeBodySchema,
  outcomeEnum
};
