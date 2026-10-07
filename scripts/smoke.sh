#!/usr/bin/env bash
# Teste de fumaça da stack do Compose (api + web + idp). Sai com código != 0 na primeira falha.
# Variáveis opcionais: API_URL, WEB_URL, IDP_URL, WAIT_SECONDS.
set -euo pipefail

API_URL="${API_URL:-http://localhost:39000}"
WEB_URL="${WEB_URL:-http://localhost:39081}"
IDP_URL="${IDP_URL:-http://localhost:39080}"
WAIT_SECONDS="${WAIT_SECONDS:-60}"

ok() { echo "[OK]   $*"; }
fail() { echo "[FALHA] $*" >&2; exit 1; }

status_of() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }

echo "Aguardando a API em ${API_URL}/health (até ${WAIT_SECONDS}s)..."
deadline=$((SECONDS + WAIT_SECONDS))
until [ "$(status_of "${API_URL}/health")" = "200" ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "API não respondeu 200 em /health dentro de ${WAIT_SECONDS}s"
  sleep 2
done
ok "GET /health -> 200"

code=$(status_of "${API_URL}/ready")
[ "$code" = "200" ] || fail "GET /ready esperado 200, recebido ${code}"
ok "GET /ready -> 200"

code=$(status_of "${API_URL}/v1/me")
[ "$code" = "401" ] || fail "GET /v1/me sem token esperado 401, recebido ${code}"
ok "GET /v1/me sem token -> 401"

# O IdP pode demorar mais que a API para subir: espera o discovery responder 200 antes de pedir token.
IDP_WAIT_SECONDS=90
echo "Aguardando o IdP em ${IDP_URL}/default/.well-known/openid-configuration (até ${IDP_WAIT_SECONDS}s)..."
idp_deadline=$((SECONDS + IDP_WAIT_SECONDS))
until [ "$(status_of "${IDP_URL}/default/.well-known/openid-configuration")" = "200" ]; do
  [ "$SECONDS" -lt "$idp_deadline" ] || fail "IdP não respondeu 200 no discovery dentro de ${IDP_WAIT_SECONDS}s"
  sleep 2
done
ok "IdP pronto (discovery -> 200)"

# Token do IdP de mentira (client_credentials; client_id/secret/scope quaisquer).
token_json=$(curl -s -X POST "${IDP_URL}/default/token" \
  -d grant_type=client_credentials -d client_id=smoke -d client_secret=smoke -d scope=openid) \
  || fail "não foi possível obter token em ${IDP_URL}/default/token"
token=$(printf '%s' "$token_json" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$token" ] || fail "resposta do IdP sem access_token: ${token_json}"
ok "token obtido do IdP"

body=$(mktemp)
trap 'rm -f "$body"' EXIT
code=$(curl -s -o "$body" -w '%{http_code}' -H "Authorization: Bearer ${token}" "${API_URL}/v1/me" || true)
[ "$code" = "200" ] || fail "GET /v1/me com token esperado 200, recebido ${code}: $(cat "$body")"
grep -q '"sub"' "$body" || fail "resposta de /v1/me sem campo sub: $(cat "$body")"
ok "GET /v1/me com token -> 200 com sub"

# Preflight CORS real: origem listada recebe o header; origem desconhecida não.
cors_headers() {
  curl -s -D - -o /dev/null -X OPTIONS "${API_URL}/v1/me" \
    -H "Origin: $1" -H 'Access-Control-Request-Method: GET' || true
}
allowed=$(cors_headers "${WEB_URL}")
printf '%s' "$allowed" | tr -d '\r' | grep -qix "access-control-allow-origin: ${WEB_URL}" \
  || fail "preflight com origem ${WEB_URL} sem access-control-allow-origin correspondente: ${allowed}"
ok "preflight CORS (origem listada) -> allow-origin ${WEB_URL}"
denied=$(cors_headers "http://origem-nao-listada.example")
if printf '%s' "$denied" | grep -qi '^access-control-allow-origin:'; then
  fail "preflight com origem não listada retornou access-control-allow-origin: ${denied}"
fi
ok "preflight CORS (origem não listada) -> sem allow-origin"

headers=$(curl -s -D - -o /dev/null "${WEB_URL}/gmill-carteira.js" || true)
printf '%s' "$headers" | head -n1 | grep -q ' 200' || fail "GET ${WEB_URL}/gmill-carteira.js não retornou 200"
printf '%s' "$headers" | grep -i '^content-type:' | grep -qi 'javascript' \
  || fail "content-type de gmill-carteira.js não é javascript"
ok "GET /gmill-carteira.js -> 200 (javascript)"

# Proxy da demo: /api/* no nginx chega na API pela mesma origem (sem CORS e sem outra porta).
code=$(status_of "${WEB_URL}/api/health")
[ "$code" = "200" ] || fail "GET ${WEB_URL}/api/health (proxy) esperado 200, recebido ${code}"
code=$(curl -s -o "$body" -w '%{http_code}' -H "Authorization: Bearer ${token}" "${WEB_URL}/api/v1/me" || true)
[ "$code" = "200" ] || fail "GET ${WEB_URL}/api/v1/me (proxy) com token esperado 200, recebido ${code}"
grep -q '"sub"' "$body" || fail "resposta de /api/v1/me (proxy) sem campo sub"
ok "proxy /api da demo -> /health 200 e /v1/me 200 com token"

echo "Smoke concluído com sucesso."
