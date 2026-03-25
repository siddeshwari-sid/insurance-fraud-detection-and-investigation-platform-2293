#!/bin/bash
cd /home/kavia/workspace/code-generation/insurance-fraud-detection-and-investigation-platform-2293/express_backend
npm run lint
LINT_EXIT_CODE=$?
if [ $LINT_EXIT_CODE -ne 0 ]; then
  exit 1
fi

