const store = require('../services/claimsStore');
const { z } = require('zod');

const queueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional()
});

class QueueController {
  // PUBLIC_INTERFACE
  async list(req, res, next) {
    /** GET /api/queue: returns prioritized cases/claims from v_queue. */
    try {
      const query = queueQuerySchema.parse(req.query || {});
      const result = await store.getQueue(query);
      return res.status(200).json({ status: 'ok', data: result });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new QueueController();
