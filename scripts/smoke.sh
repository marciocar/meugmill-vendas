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

# Proxy da demo para um endpoint novo da E2.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" "${WEB_URL}/api/v1/geo/states" || true)
[ "$code" = "200" ] || fail "GET ${WEB_URL}/api/v1/geo/states (proxy) com token esperado 200, recebido ${code}"
ok "proxy /api da demo -> /v1/geo/states 200 com token"

# Contrato OpenAPI público (sem token).
code=$(curl -s -o "$body" -w '%{http_code}' "${API_URL}/v1/openapi.json" || true)
[ "$code" = "200" ] || fail "GET /v1/openapi.json esperado 200, recebido ${code}"
grep -q '"openapi"' "$body" || fail "resposta de /v1/openapi.json sem o campo openapi"
ok "GET /v1/openapi.json -> 200 com openapi"

# Dados mestres com token de ADMIN (o IdP de teste escolhe o perfil pelo client_id; ver compose.yaml).
admin_json=$(curl -s -X POST "${IDP_URL}/default/token" \
  -d grant_type=client_credentials -d client_id=smoke-admin -d client_secret=smoke -d scope=openid) \
  || fail "não foi possível obter token de admin em ${IDP_URL}/default/token"
admin_token=$(printf '%s' "$admin_json" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$admin_token" ] || fail "resposta do IdP sem access_token de admin"
ok "token de admin obtido do IdP"

hdrs=$(mktemp)
trap 'rm -f "$body" "$hdrs"' EXIT
auth_admin="Authorization: Bearer ${admin_token}"
code_value="SMK-$(date +%s)"

code=$(curl -s -D "$hdrs" -o "$body" -w '%{http_code}' -X POST "${API_URL}/v1/product-subgroups" \
  -H "$auth_admin" -H 'Content-Type: application/json' \
  -d "{\"code\":\"${code_value}\",\"name\":\"Subgrupo de fumaça\"}" || true)
[ "$code" = "201" ] || fail "POST /v1/product-subgroups esperado 201, recebido ${code}: $(cat "$body")"
tr -d '\r' < "$hdrs" | grep -qix 'etag: "1"' || fail "POST de subgrupo sem ETag \"1\": $(cat "$hdrs")"
subgroup_id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$body" | head -n1)
[ -n "$subgroup_id" ] || fail "resposta do POST de subgrupo sem id: $(cat "$body")"
ok "POST /v1/product-subgroups -> 201 com ETag \"1\" (código ${code_value})"

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/product-subgroups/${subgroup_id}" || true)
[ "$code" = "200" ] || fail "GET /v1/product-subgroups/${subgroup_id} esperado 200, recebido ${code}"
ok "GET /v1/product-subgroups/{id} -> 200"

code=$(curl -s -o "$body" -w '%{http_code}' -X PATCH "${API_URL}/v1/product-subgroups/${subgroup_id}" \
  -H "$auth_admin" -H 'Content-Type: application/json' -d '{"name":"Subgrupo de fumaça 2"}' || true)
[ "$code" = "428" ] || fail "PATCH sem If-Match esperado 428, recebido ${code}: $(cat "$body")"
ok "PATCH sem If-Match -> 428"

code=$(curl -s -o "$body" -w '%{http_code}' -X POST "${API_URL}/v1/product-subgroups/${subgroup_id}/deactivate" \
  -H "$auth_admin" -H 'If-Match: "1"' || true)
[ "$code" = "200" ] || fail "deactivate com If-Match esperado 200, recebido ${code}: $(cat "$body")"
ok "POST /v1/product-subgroups/{id}/deactivate com If-Match -> 200"

# Fluxo do wizard da carteira (E3), com o token de ADMIN. Códigos únicos por execução (epoch).
json_get() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=Function("j","return "+process.argv[2])(j);process.stdout.write(v===undefined||v===null?"":String(v))' "$body" "$1"; }
json_post() { # json_post <rota> <corpo> -> código HTTP (corpo em $body, cabeçalhos em $hdrs)
  curl -s -D "$hdrs" -o "$body" -w '%{http_code}' -X POST "${API_URL}$1" \
    -H "$auth_admin" -H 'Content-Type: application/json' -d "$2" || true
}
json_put() { # json_put <rota> <if-match> <corpo> -> código HTTP
  curl -s -D "$hdrs" -o "$body" -w '%{http_code}' -X PUT "${API_URL}$1" \
    -H "$auth_admin" -H 'Content-Type: application/json' -H "If-Match: \"$2\"" -d "$3" || true
}
epoch=$(date +%s)

# Pré-requisitos idempotentes: a filial filial-01 (a do token de admin).
code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/branches?q=filial-01&limit=200" || true)
[ "$code" = "200" ] || fail "GET /v1/branches esperado 200, recebido ${code}: $(cat "$body")"
branch_id=$(json_get 'j.items.filter(b=>b.code==="filial-01").map(b=>b.id)[0]')
if [ -z "$branch_id" ]; then
  code=$(json_post /v1/branches '{"code":"filial-01","name":"Filial de fumaça","municipalityCode":3205002}')
  case "$code" in
    201) branch_id=$(json_get 'j.id') ;;
    409)
      code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/branches?q=filial-01&limit=200" || true)
      [ "$code" = "200" ] || fail "GET /v1/branches (após 409) esperado 200, recebido ${code}"
      branch_id=$(json_get 'j.items.filter(b=>b.code==="filial-01").map(b=>b.id)[0]') ;;
    *) fail "POST /v1/branches esperado 201 ou 409, recebido ${code}: $(cat "$body")" ;;
  esac
fi
[ -n "$branch_id" ] || fail "não foi possível obter o id da filial filial-01"
ok "filial filial-01 disponível (id ${branch_id})"

code=$(json_post /v1/portfolio-types "{\"code\":\"SMK-T-${epoch}\",\"name\":\"Tipo de fumaça\"}")
[ "$code" = "201" ] || fail "POST /v1/portfolio-types esperado 201, recebido ${code}: $(cat "$body")"
type_id=$(json_get 'j.id')
[ -n "$type_id" ] || fail "resposta do POST de tipo de carteira sem id"
ok "POST /v1/portfolio-types -> 201 (id ${type_id})"

code=$(json_post /v1/product-subgroups "{\"code\":\"SMK-G-${epoch}\",\"name\":\"Subgrupo da carteira\"}")
[ "$code" = "201" ] || fail "POST /v1/product-subgroups (carteira) esperado 201, recebido ${code}: $(cat "$body")"
pf_subgroup_id=$(json_get 'j.id')
[ -n "$pf_subgroup_id" ] || fail "resposta do POST de subgrupo (carteira) sem id"

code=$(json_post /v1/sellers "{\"code\":\"SMK-V-${epoch}\",\"name\":\"Vendedor de fumaça\",\"branchIds\":[${branch_id}]}")
[ "$code" = "201" ] || fail "POST /v1/sellers esperado 201, recebido ${code}: $(cat "$body")"
seller_id=$(json_get 'j.id')
[ -n "$seller_id" ] || fail "resposta do POST de vendedor sem id"
ok "subgrupo (id ${pf_subgroup_id}) e vendedor (id ${seller_id}) criados com vínculo na filial"

code=$(json_post /v1/portfolios \
  "{\"name\":\"Carteira de fumaça ${epoch}\",\"branchId\":${branch_id},\"responsibleSub\":\"admin-01\",\"portfolioTypeId\":${type_id}}")
[ "$code" = "201" ] || fail "POST /v1/portfolios esperado 201, recebido ${code}: $(cat "$body")"
tr -d '\r' < "$hdrs" | grep -qix 'etag: "1"' || fail "POST de carteira sem ETag \"1\": $(cat "$hdrs")"
portfolio_id=$(json_get 'j.id')
[ -n "$portfolio_id" ] || fail "resposta do POST de carteira sem id"
ok "POST /v1/portfolios -> 201 com ETag \"1\" (rascunho ${portfolio_id})"

code=$(json_put "/v1/portfolios/${portfolio_id}/filters" 1 \
  '{"regions":[{"level":"state","stateCode":32},{"level":"municipality","stateCode":32,"municipalityCode":3205002},{"level":"neighborhood","stateCode":32,"municipalityCode":3205002,"neighborhoodLabel":"Centro de Serra"}],"retailNetworkIds":[],"economicGroupIds":[]}')
[ "$code" = "200" ] || fail "PUT /filters esperado 200, recebido ${code}: $(cat "$body")"
tr -d '\r' < "$hdrs" | grep -qix 'etag: "2"' || fail "PUT /filters sem ETag \"2\": $(cat "$hdrs")"
ok "PUT /v1/portfolios/{id}/filters -> 200 com ETag \"2\" (UF, município e bairro)"

code=$(json_put "/v1/portfolios/${portfolio_id}/sellers" 2 \
  "{\"assignments\":[{\"sellerId\":${seller_id},\"productSubgroupId\":${pf_subgroup_id}}]}")
[ "$code" = "200" ] || fail "PUT /sellers esperado 200, recebido ${code}: $(cat "$body")"
tr -d '\r' < "$hdrs" | grep -qix 'etag: "3"' || fail "PUT /sellers sem ETag \"3\": $(cat "$hdrs")"
ok "PUT /v1/portfolios/{id}/sellers -> 200 com ETag \"3\""

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${portfolio_id}" || true)
[ "$code" = "200" ] || fail "GET /v1/portfolios/${portfolio_id} esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get 'j.status')" = "draft" ] || fail "carteira esperada com status draft: $(cat "$body")"
[ "$(json_get 'j.filters.regions.length')" = "3" ] || fail "carteira esperada com 3 regiões: $(cat "$body")"
[ "$(json_get 'j.sellers.length')" = "1" ] || fail "carteira esperada com 1 vendedor: $(cat "$body")"
ok "GET /v1/portfolios/{id} -> 200 (draft, 3 regiões, 1 vendedor)"

code=$(curl -s -o "$body" -w '%{http_code}' -X PATCH "${API_URL}/v1/portfolios/${portfolio_id}" \
  -H "$auth_admin" -H 'Content-Type: application/json' -d '{"description":"Descrição de fumaça"}' || true)
[ "$code" = "428" ] || fail "PATCH de carteira sem If-Match esperado 428, recebido ${code}: $(cat "$body")"
ok "PATCH /v1/portfolios/{id} sem If-Match -> 428"

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" \
  "${API_URL}/v1/portfolios?branchId=${branch_id}&q=${epoch}" || true)
[ "$code" = "200" ] || fail "GET /v1/portfolios esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get "j.items.some(i=>i.id===${portfolio_id})")" = "true" ] \
  || fail "GET /v1/portfolios não contém a carteira ${portfolio_id}"
ok "GET /v1/portfolios -> 200 contendo a carteira criada"

code=$(curl -s -o /dev/null -w '%{http_code}' -H "$auth_admin" "${WEB_URL}/api/v1/portfolios" || true)
[ "$code" = "200" ] || fail "GET ${WEB_URL}/api/v1/portfolios (proxy) esperado 200, recebido ${code}"
ok "proxy /api da demo -> /v1/portfolios 200 com token de admin"

# Prévia de elegibilidade e ajustes manuais (E4), reaproveitando a carteira do wizard.
# CNPJ numérico válido e único por execução: 8 dígitos do epoch + filial 000N + 2 DVs (módulo 11).
make_cnpj() { # make_cnpj <epoch> <ordem 1..9> -> CNPJ de 14 dígitos
  node -e '
    const base = String(Number(process.argv[1]) % 1e8).padStart(8, "0") + "000" + process.argv[2];
    const dv = (d) => {
      const w = d.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      const r = d.split("").reduce((a, c, i) => a + Number(c) * w[i], 0) % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const d1 = dv(base);
    process.stdout.write(base + d1 + dv(base + d1));
  ' "$1" "$2"
}
cnpj_a=$(make_cnpj "$epoch" 1)
cnpj_b=$(make_cnpj "$epoch" 2)
[ "${#cnpj_a}" = "14" ] && [ "${#cnpj_b}" = "14" ] || fail "geração de CNPJ falhou (${cnpj_a} / ${cnpj_b})"
name_a="Cliente Alfa ${epoch}"
name_b="Cliente Beta ${epoch}"

code=$(json_post /v1/customers \
  "{\"cnpj\":\"${cnpj_a}\",\"legalName\":\"${name_a}\",\"municipalityCode\":3205002,\"neighborhood\":\"Centro de Serra\",\"branchIds\":[${branch_id}]}")
[ "$code" = "201" ] || fail "POST /v1/customers (A, casa pelo filtro) esperado 201, recebido ${code}: $(cat "$body")"
customer_a=$(json_get 'j.id')
code=$(json_post /v1/customers \
  "{\"cnpj\":\"${cnpj_b}\",\"legalName\":\"${name_b}\",\"municipalityCode\":3304557,\"neighborhood\":\"Centro\",\"branchIds\":[${branch_id}]}")
[ "$code" = "201" ] || fail "POST /v1/customers (B, outra UF) esperado 201, recebido ${code}: $(cat "$body")"
customer_b=$(json_get 'j.id')
[ -n "$customer_a" ] && [ -n "$customer_b" ] || fail "clientes criados sem id"
ok "clientes A (${customer_a}, Serra/bairro da carteira) e B (${customer_b}, outra UF) criados na filial-01"

preview() { # preview <base> <q> -> código HTTP (corpo em $body)
  curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" -G "$1/v1/portfolios/${portfolio_id}/preview" \
    --data-urlencode "q=$2" || true
}

code=$(preview "$API_URL" "$name_a")
[ "$code" = "200" ] || fail "GET preview?q=A esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get "j.items.filter(i=>i.customer.id===${customer_a} && i.source==='filter' && i.matchedRegionLevel==='neighborhood').length")" = "1" ] \
  || fail "prévia esperava A com source=filter e matchedRegionLevel=neighborhood: $(cat "$body")"
ok "GET /preview?q=A -> 200 com A (source filter, nível neighborhood)"

code=$(preview "$API_URL" "$name_b")
[ "$code" = "200" ] || fail "GET preview?q=B esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get 'j.total')" = "0" ] || fail "prévia esperava total 0 para B (fora dos filtros): $(cat "$body")"
ok "GET /preview?q=B -> total 0 (B não casa os filtros)"

code=$(curl -s -D "$hdrs" -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${portfolio_id}" || true)
[ "$code" = "200" ] || fail "GET /v1/portfolios/${portfolio_id} esperado 200, recebido ${code}"
current_version=$(tr -d '\r' < "$hdrs" | sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*"\([0-9]*\)".*/\1/p' | head -n1)
[ -n "$current_version" ] || fail "carteira sem ETag: $(cat "$hdrs")"

code=$(json_put "/v1/portfolios/${portfolio_id}/overrides" "$current_version" \
  "{\"include\":[${customer_b}],\"exclude\":[${customer_a}]}")
[ "$code" = "200" ] || fail "PUT /overrides esperado 200, recebido ${code}: $(cat "$body")"
new_version=$(tr -d '\r' < "$hdrs" | sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*"\([0-9]*\)".*/\1/p' | head -n1)
[ -n "$new_version" ] && [ "$new_version" != "$current_version" ] \
  || fail "PUT /overrides sem ETag novo (antes ${current_version}, depois ${new_version}): $(cat "$hdrs")"
ok "PUT /v1/portfolios/{id}/overrides -> 200 com ETag novo (\"${new_version}\")"

code=$(preview "$API_URL" "$name_b")
[ "$code" = "200" ] || fail "GET preview?q=B (após ajuste) esperado 200, recebido ${code}"
[ "$(json_get "j.items.filter(i=>i.customer.id===${customer_b} && i.source==='manual').length")" = "1" ] \
  || fail "prévia esperava B com source=manual: $(cat "$body")"
ok "GET /preview?q=B -> B incluído manualmente (source manual)"

code=$(preview "$API_URL" "$name_a")
[ "$code" = "200" ] || fail "GET preview?q=A (após ajuste) esperado 200, recebido ${code}"
[ "$(json_get 'j.total')" = "0" ] || fail "prévia esperava total 0 para A (excluído): $(cat "$body")"
ok "GET /preview?q=A -> total 0 (A excluído manualmente)"

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${portfolio_id}/overrides" || true)
[ "$code" = "200" ] || fail "GET /overrides esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get "j.include.filter(e=>e.customer.id===${customer_b} && e.effective===true).length")" = "1" ] \
  || fail "/overrides esperava B em include com effective=true: $(cat "$body")"
[ "$(json_get "j.exclude.filter(e=>e.customer.id===${customer_a} && e.effective===true).length")" = "1" ] \
  || fail "/overrides esperava A em exclude com effective=true: $(cat "$body")"
ok "GET /overrides -> B em include e A em exclude, ambos effective"

code=$(curl -s -o "$body" -w '%{http_code}' -X PUT "${API_URL}/v1/portfolios/${portfolio_id}/overrides" \
  -H "$auth_admin" -H 'Content-Type: application/json' -d '{"include":[],"exclude":[]}' || true)
[ "$code" = "428" ] || fail "PUT /overrides sem If-Match esperado 428, recebido ${code}: $(cat "$body")"
ok "PUT /overrides sem If-Match -> 428"

code=$(preview "${WEB_URL}/api" "$name_b")
[ "$code" = "200" ] || fail "GET ${WEB_URL}/api/v1/portfolios/{id}/preview (proxy) esperado 200, recebido ${code}"
ok "proxy /api da demo -> /v1/portfolios/{id}/preview 200"

# Conflitos entre carteiras da filial (E5). As execuções anteriores deixaram carteiras na filial-01
# que também concorrem; por isso o cliente C fica num bairro ÚNICO por execução, numa UF (RJ) que
# nenhuma carteira antiga alcança, e as carteiras do teste usam esse bairro.
conflict_hood="Bairro Conflito ${epoch}"
cnpj_c=$(make_cnpj "$epoch" 3)
[ "${#cnpj_c}" = "14" ] || fail "geração de CNPJ do cliente C falhou (${cnpj_c})"
name_c="Cliente Gama ${epoch}"
code=$(json_post /v1/customers \
  "{\"cnpj\":\"${cnpj_c}\",\"legalName\":\"${name_c}\",\"municipalityCode\":3304557,\"neighborhood\":\"${conflict_hood}\",\"branchIds\":[${branch_id}]}")
[ "$code" = "201" ] || fail "POST /v1/customers (C, conflito) esperado 201, recebido ${code}: $(cat "$body")"
customer_c=$(json_get 'j.id')
[ -n "$customer_c" ] || fail "cliente C criado sem id"
ok "cliente C (${customer_c}) criado no bairro único '${conflict_hood}' (RJ)"

make_portfolio() { # make_portfolio <nome> <regioes-json> -> id em $new_pid, ETag atual em $new_version
  code=$(json_post /v1/portfolios \
    "{\"name\":\"$1\",\"branchId\":${branch_id},\"responsibleSub\":\"admin-01\",\"portfolioTypeId\":${type_id}}")
  [ "$code" = "201" ] || fail "POST /v1/portfolios ($1) esperado 201, recebido ${code}: $(cat "$body")"
  new_pid=$(json_get 'j.id')
  code=$(json_put "/v1/portfolios/${new_pid}/filters" 1 \
    "{\"regions\":$2,\"retailNetworkIds\":[],\"economicGroupIds\":[]}")
  [ "$code" = "200" ] || fail "PUT /filters ($1) esperado 200, recebido ${code}: $(cat "$body")"
  code=$(json_put "/v1/portfolios/${new_pid}/sellers" 2 \
    "{\"assignments\":[{\"sellerId\":${seller_id},\"productSubgroupId\":${pf_subgroup_id}}]}")
  [ "$code" = "200" ] || fail "PUT /sellers ($1) esperado 200, recebido ${code}: $(cat "$body")"
  new_version=$(tr -d '\r' < "$hdrs" | sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*"\([0-9]*\)".*/\1/p' | head -n1)
  [ -n "$new_version" ] || fail "carteira $1 sem ETag: $(cat "$hdrs")"
}

preview_c() { # preview_c <carteira> -> código HTTP (corpo em $body), buscando só o cliente C
  curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" -G "${API_URL}/v1/portfolios/$1/preview" \
    --data-urlencode "q=$name_c" || true
}

# C na carteira $1: espera resolução $2 e posto $3.
expect_c() {
  code=$(preview_c "$1")
  [ "$code" = "200" ] || fail "GET preview da carteira $1 esperado 200, recebido ${code}: $(cat "$body")"
  [ "$(json_get "j.items.filter(i=>i.customer.id===${customer_c} && i.resolution==='$2' && i.rank===$3).length")" = "1" ] \
    || fail "carteira $1: C esperado com resolution=$2 e rank=$3: $(cat "$body")"
}

deactivate_portfolio() { # deactivate_portfolio <id> <versão>
  code=$(curl -s -o "$body" -w '%{http_code}' -X POST "${API_URL}/v1/portfolios/$1/deactivate" \
    -H "$auth_admin" -H "If-Match: \"$2\"" || true)
  [ "$code" = "200" ] || fail "deactivate da carteira $1 esperado 200, recebido ${code}: $(cat "$body")"
}

hood_region="{\"level\":\"neighborhood\",\"stateCode\":33,\"municipalityCode\":3304557,\"neighborhoodLabel\":\"${conflict_hood}\"}"
city_region='{"level":"municipality","stateCode":33,"municipalityCode":3304557}'

make_portfolio "Conflito bairro ${epoch}" "[${hood_region}]"
pf_hood=$new_pid
hood_version=$new_version
make_portfolio "Conflito cidade ${epoch}" "[${city_region}]"
pf_city=$new_pid
city_version=$new_version
ok "carteiras do conflito criadas: bairro (${pf_hood}) e município (${pf_city}), mesmo vendedor/subgrupo"

expect_c "$pf_hood" assigned 3
expect_c "$pf_city" lost 2
code=$(preview_c "$pf_city")
[ "$(json_get "j.items[0].competitors.filter(c=>c.portfolioId===${pf_hood} && c.rank===3).length")" = "1" ] \
  || fail "carteira do município: C esperado com a carteira do bairro (${pf_hood}, posto 3) em competitors: $(cat "$body")"
ok "bairro x município: C assigned (posto 3) no bairro e lost (posto 2) no município, com concorrente"

make_portfolio "Conflito empate ${epoch}" "[${hood_region}]"
pf_tie=$new_pid
tie_version=$new_version
expect_c "$pf_hood" blocked 3
expect_c "$pf_tie" blocked 3
# As contagens de conflito só vêm sob demanda (?include=conflicts): resolver a disputa inteira custa caro.
code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${pf_hood}?include=conflicts" || true)
[ "$code" = "200" ] || fail "GET /v1/portfolios/${pf_hood}?include=conflicts esperado 200, recebido ${code}"
[ "$(json_get 'j.conflictsBlocked >= 1')" = "true" ] || fail "agregado esperava conflictsBlocked >= 1: $(cat "$body")"
code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" -G "${API_URL}/v1/portfolios/${pf_hood}/preview" \
  --data-urlencode "q=$name_c" --data-urlencode "resolution=blocked" || true)
[ "$code" = "200" ] || fail "GET preview?resolution=blocked esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get 'j.total')" = "1" ] || fail "preview?resolution=blocked esperava total 1 para C: $(cat "$body")"
code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${pf_hood}/preview?resolution=foo" || true)
[ "$code" = "400" ] || fail "preview?resolution=foo esperado 400, recebido ${code}"
ok "empate de posto 3: C blocked nas duas carteiras, conflictsBlocked >= 1 e filtro resolution (foo -> 400)"

deactivate_portfolio "$pf_tie" "$tie_version"
expect_c "$pf_hood" assigned 3
ok "carteira do empate inativada: C volta a assigned na carteira do bairro"

deactivate_portfolio "$pf_hood" "$hood_version"
deactivate_portfolio "$pf_city" "$city_version"
ok "carteiras do teste de conflito inativadas ao final"

# Distribuição dos clientes entre vendedores (E6). Bairro ÚNICO por execução (RJ), dois vendedores no
# mesmo subgrupo e 5 clientes: a divisão automática tem de ficar equilibrada (diferença <= 1).
dist_hood="Bairro Distribuicao ${epoch}"
code=$(json_post /v1/sellers "{\"code\":\"SMK-V2-${epoch}\",\"name\":\"Vendedor de fumaça 2\",\"branchIds\":[${branch_id}]}")
[ "$code" = "201" ] || fail "POST /v1/sellers (2º vendedor) esperado 201, recebido ${code}: $(cat "$body")"
seller2_id=$(json_get 'j.id')
[ -n "$seller2_id" ] || fail "resposta do POST do 2º vendedor sem id"
dist_total=5
for n in 4 5 6 7 8; do
  cnpj_d=$(make_cnpj "$epoch" "$n")
  [ "${#cnpj_d}" = "14" ] || fail "geração de CNPJ do cliente ${n} falhou (${cnpj_d})"
  code=$(json_post /v1/customers \
    "{\"cnpj\":\"${cnpj_d}\",\"legalName\":\"Cliente Distribuicao ${n} ${epoch}\",\"municipalityCode\":3304557,\"neighborhood\":\"${dist_hood}\",\"branchIds\":[${branch_id}]}")
  [ "$code" = "201" ] || fail "POST /v1/customers (distribuição ${n}) esperado 201, recebido ${code}: $(cat "$body")"
done
code=$(json_post /v1/portfolios \
  "{\"name\":\"Distribuicao ${epoch}\",\"branchId\":${branch_id},\"responsibleSub\":\"admin-01\",\"portfolioTypeId\":${type_id}}")
[ "$code" = "201" ] || fail "POST /v1/portfolios (distribuição) esperado 201, recebido ${code}: $(cat "$body")"
pf_dist=$(json_get 'j.id')
code=$(json_put "/v1/portfolios/${pf_dist}/filters" 1 \
  "{\"regions\":[{\"level\":\"neighborhood\",\"stateCode\":33,\"municipalityCode\":3304557,\"neighborhoodLabel\":\"${dist_hood}\"}],\"retailNetworkIds\":[],\"economicGroupIds\":[]}")
[ "$code" = "200" ] || fail "PUT /filters (distribuição) esperado 200, recebido ${code}: $(cat "$body")"
code=$(json_put "/v1/portfolios/${pf_dist}/sellers" 2 \
  "{\"assignments\":[{\"sellerId\":${seller_id},\"productSubgroupId\":${pf_subgroup_id}},{\"sellerId\":${seller2_id},\"productSubgroupId\":${pf_subgroup_id}}]}")
[ "$code" = "200" ] || fail "PUT /sellers (distribuição) esperado 200, recebido ${code}: $(cat "$body")"
dist_version=$(tr -d '\r' < "$hdrs" | sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*"\([0-9]*\)".*/\1/p' | head -n1)
[ -n "$dist_version" ] || fail "carteira de distribuição sem ETag: $(cat "$hdrs")"
ok "carteira de distribuição (${pf_dist}) criada: 2 vendedores no mesmo subgrupo e ${dist_total} clientes no bairro único"

code=$(curl -s -o "$body" -w '%{http_code}' -X POST "${API_URL}/v1/portfolios/${pf_dist}/distribute" \
  -H "$auth_admin" -H 'Content-Type: application/json' -d '{}' || true)
[ "$code" = "428" ] || fail "POST /distribute sem If-Match esperado 428, recebido ${code}: $(cat "$body")"
ok "POST /distribute sem If-Match -> 428"

code=$(curl -s -D "$hdrs" -o "$body" -w '%{http_code}' -X POST "${API_URL}/v1/portfolios/${pf_dist}/distribute" \
  -H "$auth_admin" -H 'Content-Type: application/json' -H "If-Match: \"${dist_version}\"" -d '{}' || true)
[ "$code" = "200" ] || fail "POST /distribute esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get "Object.values(j.distributed).reduce((a,b)=>a+b,0)")" = "${dist_total}" ] \
  || fail "distribute esperava ${dist_total} atribuições gravadas: $(cat "$body")"
dist_version=$(tr -d '\r' < "$hdrs" | sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*"\([0-9]*\)".*/\1/p' | head -n1)
[ -n "$dist_version" ] || fail "POST /distribute sem ETag: $(cat "$hdrs")"
ok "POST /v1/portfolios/{id}/distribute -> 200 (${dist_total} atribuições)"

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${pf_dist}/assignments/summary" || true)
[ "$code" = "200" ] || fail "GET /assignments/summary esperado 200, recebido ${code}: $(cat "$body")"
[ "$(json_get 'j.totals.unassigned')" = "0" ] || fail "summary esperava unassigned 0: $(cat "$body")"
[ "$(json_get 'j.totals.assigned')" = "${dist_total}" ] || fail "summary esperava assigned ${dist_total}: $(cat "$body")"
[ "$(json_get 'j.subgroups[0].sellers.length')" = "2" ] || fail "summary esperava 2 vendedores: $(cat "$body")"
[ "$(json_get 'Math.abs(j.subgroups[0].sellers[0].count - j.subgroups[0].sellers[1].count) <= 1')" = "true" ] \
  || fail "distribuição desequilibrada (diferença > 1): $(cat "$body")"
ok "GET /assignments/summary -> 2 vendedores equilibrados (diferença <= 1), unassigned 0"

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${pf_dist}/assignments?limit=1" || true)
[ "$code" = "200" ] || fail "GET /assignments esperado 200, recebido ${code}: $(cat "$body")"
swap_customer=$(json_get 'j.items[0].customer.id')
swap_from=$(json_get 'j.items[0].seller.id')
[ -n "$swap_customer" ] && [ -n "$swap_from" ] || fail "GET /assignments sem item atribuído: $(cat "$body")"
if [ "$swap_from" = "$seller_id" ]; then swap_to=$seller2_id; else swap_to=$seller_id; fi
code=$(json_put "/v1/portfolios/${pf_dist}/assignments" "$dist_version" \
  "{\"set\":[{\"customerId\":${swap_customer},\"productSubgroupId\":${pf_subgroup_id},\"sellerId\":${swap_to}}]}")
[ "$code" = "200" ] || fail "PUT /assignments esperado 200, recebido ${code}: $(cat "$body")"
code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" \
  "${API_URL}/v1/portfolios/${pf_dist}/assignments?sellerId=${swap_to}&limit=200" || true)
[ "$(json_get "j.items.some(i=>i.customer.id===${swap_customer})")" = "true" ] \
  || fail "cliente ${swap_customer} não aparece sob o vendedor ${swap_to} após o PUT: $(cat "$body")"
ok "PUT /assignments -> 200 (cliente trocado de vendedor)"

code=$(curl -s -o /dev/null -w '%{http_code}' -H "$auth_admin" "${WEB_URL}/api/v1/portfolios/${pf_dist}/assignments/summary" || true)
[ "$code" = "200" ] || fail "GET ${WEB_URL}/api/v1/portfolios/{id}/assignments/summary (proxy) esperado 200, recebido ${code}"
ok "proxy /api da demo -> /assignments/summary 200"

code=$(curl -s -o "$body" -w '%{http_code}' -H "$auth_admin" "${API_URL}/v1/portfolios/${pf_dist}" || true)
[ "$code" = "200" ] || fail "GET /v1/portfolios/${pf_dist} esperado 200, recebido ${code}"
deactivate_portfolio "$pf_dist" "$(json_get 'j.version')"
ok "carteira de distribuição inativada ao final"

echo "Smoke concluído com sucesso."
