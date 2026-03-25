const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Insurance Fraud Detection API',
      version: '1.0.0',
      description:
        'REST API for CSV claim ingestion, rule-based fraud scoring with signal explanations, investigator queue, outcomes, and dashboard reports.'
    }
  },
  apis: ['./src/routes/*.js'] // Swagger JSDoc annotations live in routes
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
