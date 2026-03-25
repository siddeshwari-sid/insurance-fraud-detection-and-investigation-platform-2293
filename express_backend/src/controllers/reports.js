const store = require('../services/claimsStore');

class ReportsController {
  // PUBLIC_INTERFACE
  async summary(req, res, next) {
    /** GET /api/reports/summary: returns summary counts view. */
    try {
      const row = await store.getReportsSummary();
      return res.status(200).json({ status: 'ok', data: row });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new ReportsController();
