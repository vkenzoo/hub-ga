#!/usr/bin/env bash
# Simula o ciclo de vida completo de uma assinatura via webhooks do Assiny.
# Requer dashboard rodando (3002) + webhooks (3001).

set -euo pipefail

if [ -f "apps/webhooks/.env.local" ]; then
  set -a
  source apps/webhooks/.env.local
  set +a
fi

URL_BASE="${URL_BASE:-http://localhost:3001/api/webhooks/assiny}"
SECRET="${ASSINY_WEBHOOK_SECRET:?ASSINY_WEBHOOK_SECRET ausente}"
SUB_ID="sub_test_$(date +%s)"
EMAIL="renewal-test@example.com"
PERIOD_END_1="$(date -u -v+30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)"
PERIOD_END_2="$(date -u -v+60d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+60 days' +%Y-%m-%dT%H:%M:%SZ)"

send () {
  local body="$1"
  local label="$2"
  local sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk -F'= ' '{print $NF}' | tr -d ' \n')
  echo "==> $label"
  curl -s -X POST "$URL_BASE" \
    -H "Content-Type: application/json" \
    -H "x-assiny-signature: sha256=$sig" \
    --data-raw "$body" | python3 -m json.tool || echo "(invalid response)"
  echo
}

# 1. Compra inicial — cria customer, purchase, subscription, grant (com expires_at = PERIOD_END_1)
BODY_INITIAL=$(cat <<JSON
{
  "event_id": "evt_initial_${SUB_ID}",
  "event_type": "subscription.purchase.paid",
  "product": { "id": "TEST_ASSINY_001", "name": "Produto Recorrente" },
  "customer": { "email": "$EMAIL", "name": "Renewal Test" },
  "amount": 297.00,
  "status": "paid",
  "subscription_id": "$SUB_ID",
  "current_period_end": "$PERIOD_END_1"
}
JSON
)
send "$BODY_INITIAL" "1. Compra inicial (paid)"

# 2. Renovação — extende expires_at dos grants existentes
BODY_RENEW=$(cat <<JSON
{
  "event_id": "evt_renew_${SUB_ID}_1",
  "event_type": "subscription.renewed",
  "product": { "id": "TEST_ASSINY_001", "name": "Produto Recorrente" },
  "customer": { "email": "$EMAIL", "name": "Renewal Test" },
  "amount": 297.00,
  "status": "paid",
  "subscription_id": "$SUB_ID",
  "current_period_end": "$PERIOD_END_2"
}
JSON
)
send "$BODY_RENEW" "2. Renovação"

# 3. Cancelamento — sub fica cancelada, grants vão até PERIOD_END_2
BODY_CANCEL=$(cat <<JSON
{
  "event_id": "evt_cancel_${SUB_ID}",
  "event_type": "subscription.cancelled",
  "product": { "id": "TEST_ASSINY_001", "name": "Produto Recorrente" },
  "customer": { "email": "$EMAIL", "name": "Renewal Test" },
  "amount": 0,
  "status": "cancelled",
  "subscription_id": "$SUB_ID",
  "current_period_end": "$PERIOD_END_2"
}
JSON
)
send "$BODY_CANCEL" "3. Cancelamento"
