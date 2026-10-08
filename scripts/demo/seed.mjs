#!/usr/bin/env node
// Popula a filial de demonstração DEMO-ES pela PRÓPRIA API, como um usuário faria:
// - cada CSV de scripts/demo/data passa pela importação do E10 (simulação, conferência, confirmação);
// - os tipos de carteira e a ligação login x vendedor vão pela API REST;
// - a carteira "Serra Norte" é distribuída e finalizada (E6/E7), para o vendedor de demo ter clientes.
// Rodar de novo restaura cadastros, filtros e vendedores das carteiras e não muda o que já está igual.
// Todos os dados são fictícios e só de empresa. Uso: node scripts/demo/seed.mjs [--expect-unchanged]
// `--expect-unchanged` (usado no CI na 2ª execução) não escreve nada e falha se algo precisaria mudar:
// prova que o seed é idempotente.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:39000';
const IDP = process.env.IDP_URL ?? 'http://localhost:39080';
const BRANCH = 'DEMO-ES';
const EXPECT_UNCHANGED = process.argv.includes('--expect-unchanged');
const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
const LAYOUT_OF = {
  '01-branches.csv': 'branches',
  '02-product-subgroups.csv': 'product-subgroups',
  '03-retail-networks.csv': 'retail-networks',
  '04-economic-groups.csv': 'economic-groups',
  '05-sellers.csv': 'sellers',
  '06-customers.csv': 'customers',
  '07-portfolios.csv': 'portfolios',
};
const PORTFOLIO_TYPES = [
  { code: 'GEO', name: 'Geográfica' },
  { code: 'REDE', name: 'Por rede' },
];

const log = (msg) => console.log(`[demo] ${msg}`);
const fail = (msg) => {
  console.error(`[demo] FALHOU: ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Com --expect-unchanged, qualquer escrita é falha (antes de escrever). */
const mustWrite = (what) => EXPECT_UNCHANGED && fail(`esperava nada a mudar, mas seria preciso: ${what}`);

async function request(url, init, what) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    fail(`sem resposta de ${what} (${url}); a stack está de pé? docker compose up -d`);
  }
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    // Resposta que não é JSON (ex.: 502 em HTML do proxy): guarda o começo para a mensagem de erro.
    return { status: res.status, json: { raw: text.slice(0, 120) } };
  }
}

async function token(clientId) {
  const res = await request(
    `${IDP}/default/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: 'demo',
        scope: 'openid',
      }),
    },
    'o IdP de teste',
  );
  if (res.status !== 200 || !res.json?.access_token) fail(`IdP respondeu ${res.status} para ${clientId}`);
  // O IdP de teste só lê docker/idp-config.json ao subir: um container antigo cai no mapeamento coringa.
  const claims = JSON.parse(Buffer.from(res.json.access_token.split('.')[1], 'base64url').toString());
  if (!claims.roles?.includes('admin') || !claims.branch_ids?.includes(BRANCH)) {
    fail(
      `o token de ${clientId} não é admin da ${BRANCH}: o IdP está com a config antiga. ` +
        'Recrie-o: docker compose up -d --force-recreate idp',
    );
  }
  return res.json.access_token;
}

const health = await request(`${API}/health`, {}, 'a API');
if (health.status !== 200) fail(`API respondeu ${health.status} em /health`);
const auth = { Authorization: `Bearer ${await token('demo-admin')}` };

function api(method, path, { body, version, raw } = {}) {
  const headers = { ...auth };
  if (version !== undefined) headers['If-Match'] = `"${version}"`;
  if (raw) headers['Content-Type'] = 'text/csv';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  return request(
    `${API}${path}`,
    { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) },
    'a API',
  );
}

/** Lista de uma rota de listagem; falha com mensagem clara se a resposta não for 200. */
async function items(path) {
  const res = await api('GET', path);
  if (res.status !== 200 || !Array.isArray(res.json?.items)) fail(`GET ${path} respondeu ${res.status}`);
  return res.json.items;
}

async function cancelJob(id) {
  const res = await api('POST', `/v1/imports/${id}/cancel`, { body: {} });
  if (res.status !== 200) log(`aviso: não consegui cancelar a importação #${id} (${res.status})`);
}

async function waitJob(id) {
  for (let i = 0; i < 600; i++) {
    const res = await api('GET', `/v1/imports/${id}`);
    if (res.status !== 200) fail(`GET /v1/imports/${id} respondeu ${res.status}`);
    if (res.json.status !== 'validating' && res.json.status !== 'applying') return res.json;
    await sleep(300);
  }
  // Uma simulação ainda rodando não pode ser cancelada; ela vence sozinha em 24 h.
  fail(`importação #${id} não terminou em 3 min`);
}

async function importCsv(file) {
  const layout = LAYOUT_OF[file];
  const sent = await api('POST', `/v1/imports?layout=${layout}`, { raw: readFileSync(join(DATA, file)) });
  if (sent.status !== 202) fail(`${file}: envio respondeu ${sent.status} ${JSON.stringify(sent.json)}`);
  const simulated = await waitJob(sent.json.id);
  if (simulated.status !== 'validated') {
    const lines = await api('GET', `/v1/imports/${simulated.id}/lines?status=invalid&limit=20`);
    const detail = (lines.json?.items ?? []).map((l) => `linha ${l.line}: ${l.message}`).join('; ');
    await cancelJob(simulated.id);
    fail(`${file}: simulação ${simulated.status} ${simulated.fileError?.message ?? ''} ${detail}`);
  }
  const counts = Object.entries(simulated.counts).filter(([, n]) => n > 0);
  if (counts.every(([k]) => k === 'unchanged')) {
    await cancelJob(simulated.id);
    log(`${file}: já estava carregado (${simulated.totalRows} linha(s) sem mudança)`);
    return;
  }
  if (EXPECT_UNCHANGED) {
    await cancelJob(simulated.id);
    fail(`${file}: esperava nada a mudar, mas a simulação prevê ${JSON.stringify(simulated.counts)}`);
  }
  const confirmed = await api('POST', `/v1/imports/${simulated.id}/confirm`, { body: {} });
  if (confirmed.status !== 202) {
    await cancelJob(simulated.id);
    fail(`${file}: confirmação respondeu ${confirmed.status} ${JSON.stringify(confirmed.json)}`);
  }
  const applied = await waitJob(simulated.id);
  if (applied.status !== 'applied') fail(`${file}: gravação terminou ${applied.status}`);
  log(`${file}: importado (${counts.map(([k, n]) => `${n} ${k}`).join(', ')})`);
}

async function ensurePortfolioTypes() {
  for (const t of PORTFOLIO_TYPES) {
    const found = await items(`/v1/portfolio-types?q=${encodeURIComponent(t.code)}&limit=200`);
    if (found.some((x) => x.code === t.code)) continue;
    mustWrite(`criar o tipo de carteira ${t.code}`);
    const created = await api('POST', '/v1/portfolio-types', { body: t });
    if (created.status !== 201) fail(`tipo ${t.code}: ${created.status} ${JSON.stringify(created.json)}`);
    log(`tipo de carteira ${t.code} criado`);
  }
}

async function linkSellerLogin(code, userSub) {
  const seller = (await items(`/v1/sellers?q=${code}&limit=200`)).find((s) => s.code === code);
  if (!seller) fail(`vendedor ${code} não encontrado`);
  if (seller.userSub === userSub) return;
  mustWrite(`ligar o login ${userSub} ao vendedor ${code}`);
  const res = await api('PATCH', `/v1/sellers/${seller.id}`, { body: { userSub }, version: seller.version });
  if (res.status !== 200) fail(`ligar ${code} a ${userSub}: ${res.status} ${JSON.stringify(res.json)}`);
  log(`login ${userSub} ligado ao vendedor ${code}`);
}

async function portfolioByName(name) {
  const p = (await items(`/v1/portfolios?q=${encodeURIComponent(name)}&limit=200`)).find(
    (x) => x.name === name && x.branch.code === BRANCH,
  );
  if (!p) fail(`carteira ${name} não encontrada`);
  return p;
}

async function finalize(name) {
  const p = await portfolioByName(name);
  const summary = await api('GET', `/v1/portfolios/${p.id}/assignments/summary`);
  if (summary.status !== 200) fail(`resumo de ${name}: ${summary.status}`);
  const { assigned, unassigned, stale } = summary.json.totals;
  if (EXPECT_UNCHANGED) {
    // Sem escrever: a carteira já está finalizada, sem célula pendente e com um vínculo por célula.
    const links = await api('GET', `/v1/portfolios/${p.id}/links?limit=1`);
    if (p.status !== 'active' || unassigned + stale > 0 || links.json?.total !== assigned) {
      fail(
        `${name}: esperava finalizada e completa (situação ${p.status}, ${unassigned + stale} célula(s) ` +
          `pendente(s), ${links.json?.total} vínculo(s) para ${assigned} célula(s))`,
      );
    }
    log(`${name}: finalizada, ${assigned} vínculo(s) intactos`);
    return;
  }
  let version = p.version;
  if (unassigned + stale > 0) {
    const dist = await api('POST', `/v1/portfolios/${p.id}/distribute`, { body: {}, version });
    if (dist.status !== 200) fail(`distribuir ${name}: ${dist.status} ${JSON.stringify(dist.json)}`);
    version = dist.json.portfolio.version;
  }
  const fin = await api('POST', `/v1/portfolios/${p.id}/finalize`, { body: {}, version });
  if (fin.status !== 200) fail(`finalizar ${name}: ${fin.status} ${JSON.stringify(fin.json)}`);
  const { created, ended, kept, takenOver } = fin.json;
  log(
    `${name} finalizada: ${created} vínculo(s) criado(s), ${ended} encerrado(s), ${kept} mantido(s), ` +
      `${takenOver} tomado(s) de outra carteira`,
  );
}

async function summary() {
  for (const p of (await items('/v1/portfolios?limit=200')).filter((x) => x.branch.code === BRANCH)) {
    const full = await api('GET', `/v1/portfolios/${p.id}?include=conflicts`);
    const preview = await api('GET', `/v1/portfolios/${p.id}/preview?limit=1`);
    const { conflictsBlocked: blocked, conflictsLost: lost } = full.json ?? {};
    log(
      `  ${p.name.padEnd(16)} ${p.status === 'active' ? 'finalizada' : 'rascunho  '} ` +
        `prévia ${String(preview.json?.total).padStart(2)} · bloqueados ${blocked} · perdidos ${lost}`,
    );
  }
}

for (const file of Object.keys(LAYOUT_OF)) {
  if (file === '07-portfolios.csv') await ensurePortfolioTypes();
  if (!readdirSync(DATA).includes(file)) fail(`arquivo ausente: ${file}`);
  await importCsv(file);
}
await linkSellerLogin('V101', 'demo-vend');
await finalize('Serra Norte');
log('carteiras da filial DEMO-ES:');
await summary();
log('pronto. Abra http://localhost:39081/demo/index.html e escolha um perfil "demo".');
