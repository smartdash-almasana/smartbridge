#!/bin/bash
# SmartSeller V2 — Demo end-to-end
# Requiere: BASE_URL, STORE_ID, STORE_EXTERNAL_ID como env vars
# Ejemplo:
#   BASE_URL=http://localhost:3000 \
#   STORE_ID=0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2 \
#   STORE_EXTERNAL_ID=59925004 \
#   bash scripts/demo.sh

set -e

echo "=== SmartSeller V2 Demo ==="
echo "BASE_URL:          $BASE_URL"
echo "STORE_ID:          $STORE_ID"
echo "STORE_EXTERNAL_ID: $STORE_EXTERNAL_ID"
echo ""

echo "1. Ingest webhook..."
INGEST_RESPONSE=$(curl -s -X POST "$BASE_URL/api/ingest" \
  -H "Content-Type: application/json" \
  -d "{\"resource\":\"/orders/v1/orders/123456\",\"topic\":\"orders_v2\",\"user_id\":\"$STORE_EXTERNAL_ID\"}")
echo "$INGEST_RESPONSE" | jq .

EVENT_ID=$(echo "$INGEST_RESPONSE" | jq -r '.event_id // empty')
echo ""

echo "2. Normalize..."
if [ -n "$EVENT_ID" ]; then
  curl -s -X POST "$BASE_URL/api/normalize/$EVENT_ID" | jq .
else
  echo "(skipped — no event_id returned, likely idempotent or 404)"
fi
echo ""

echo "3. Run engine..."
curl -s -X POST "$BASE_URL/api/engine/$STORE_ID" | jq .
echo ""

echo "4. Read score..."
curl -s "$BASE_URL/api/score/$STORE_ID" | jq .
echo ""

echo "=== DONE ==="
