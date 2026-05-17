#!/usr/bin/env bash
# Simula um webhook do Assiny apontando pro app local.
# Usa o ASSINY_WEBHOOK_SECRET do .env.local para assinar.
#
# Uso:
#   pnpm --filter @hub/webhooks dev          # em outro terminal
#   bash scripts/test-webhook.sh

set -euo pipefail

# Carrega .env.local
if [ -f "apps/webhooks/.env.local" ]; then
  set -a
  source apps/webhooks/.env.local
  set +a
fi

URL="${URL:-http://localhost:3001/api/webhooks/assiny}"
SECRET="${ASSINY_WEBHOOK_SECRET:?defina ASSINY_WEBHOOK_SECRET em apps/webhooks/.env.local}"

# IMPORTANTE: troque "TODO" abaixo pelo ID real do produto no Assiny
# (ou ajuste a tabela products no banco para conter um id que case).
BODY=$(cat <<'JSON'
{
  "event_id": "evt_test_001",
  "event_type": "purchase.paid",
  "product": { "id": "TEST_ASSINY_001", "name": "Produto Teste" },
  "customer": { "email": "teste@example.com", "name": "Cliente Teste", "phone": "11999999999" },
  "amount": 10.00,
  "status": "paid",
  "utm": { "source": "google", "medium": "cpc", "campaign": "smoke_test" }
}
JSON
)

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk -F'= ' '{print $NF}' | tr -d ' \n')

echo "POST $URL"
echo "Signature: sha256=$SIG"
echo ""

curl -i -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-assiny-signature: sha256=$SIG" \
  --data-raw "$BODY"
echo
