// Conector do ChatGPT/Claude por OAuth (como o Metricool): descoberta,
// registro dinâmico, Permitir no painel, PKCE, token, MCP, renovação, revogação.
import { teste, igual, verdade, rodar } from "./base.mjs";
import { ambiente, A, B } from "./ambiente.mjs";
import { criarServidorMcp } from "../supabase/functions/_compartilhado/mcp-http.js";

const BASE = "https://ref.supabase.co/functions/v1/mcp";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const b64url = (b) => Buffer.from(b).toString("base64url");
async function pkce() {
  const verificador = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const desafio = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador))));
  return { verificador, desafio };
}
function montar(e) {
  const srv = criarServidorMcp({ api: e.api, base: BASE });
  const req = (metodo, caminho, { corpo, form, token, cab = {} } = {}) => srv(new Request(BASE + caminho, {
    method: metodo,
    headers: { ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : corpo ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), ...cab },
    body: form ? new URLSearchParams(form).toString() : corpo ? JSON.stringify(corpo) : undefined,
    redirect: "manual",
  }));
  return req;
}
// O caminho inteiro que o ChatGPT faz, até ter o token.
async function conectar(e, req, usuario, { escopo, scope = "leitura programar" } = {}) {
  const reg = await (await req("POST", "/oauth/register", { corpo: { client_name: "ChatGPT", redirect_uris: [REDIRECT] } })).json();
  const { verificador, desafio } = await pkce();
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: desafio, code_challenge_method: "S256", state: "xyz", scope, resource: BASE });
  const ida = await req("GET", "/oauth/authorize?" + q);
  igual(ida.status, 302);
  const painel = ida.headers.get("location");
  verdade(painel.startsWith("https://painel.exemplo/#autorizar/"), painel);
  const pedido = painel.split("/").pop();
  const visto = await e.chamar(usuario, "GET", `/v1/oauth/pedidos/${pedido}`);
  igual(visto.status, 200, JSON.stringify(visto.corpo));
  const ap = await e.chamar(usuario, "POST", `/v1/oauth/pedidos/${pedido}/aprovar`, escopo ? { escopo } : {});
  igual(ap.status, 200, JSON.stringify(ap.corpo));
  const volta = new URL(ap.corpo.redirecionar_para);
  igual(volta.origin + volta.pathname, REDIRECT); igual(volta.searchParams.get("state"), "xyz"); igual(volta.searchParams.get("iss"), BASE);
  const code = volta.searchParams.get("code");
  const tk = await req("POST", "/oauth/token", { form: { grant_type: "authorization_code", code, code_verifier: verificador, client_id: reg.client_id, redirect_uri: REDIRECT, resource: BASE } });
  igual(tk.status, 200);
  return { reg, pedido, code, verificador, tokens: await tk.json(), visto: visto.corpo };
}
const mcpChamar = (req, token, msg) => req("POST", "", { corpo: { jsonrpc: "2.0", ...msg }, token });

teste("descoberta: 401 aponta os metadados; recurso e servidor de autorização respondem", async () => {
  const e = ambiente(); const req = montar(e);
  const r = await req("POST", "", { corpo: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
  igual(r.status, 401);
  verdade(r.headers.get("www-authenticate").includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource"`));
  const pr = await (await req("GET", "/.well-known/oauth-protected-resource")).json();
  igual(pr.resource, BASE); igual(pr.authorization_servers, [BASE]);
  for (const c of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    const m = await (await req("GET", c)).json();
    igual(m.issuer, BASE); igual(m.code_challenge_methods_supported, ["S256"]); igual(m.token_endpoint_auth_methods_supported, ["none"]);
    igual(m.registration_endpoint, BASE + "/oauth/register");
  }
  igual((await req("OPTIONS", "/oauth/token")).status, 204, "CORS");
});

teste("conectar como no Metricool: Permitir no painel e as ferramentas funcionam com o token", async () => {
  const e = ambiente(); await e.preparar(A); const req = montar(e);
  const { tokens, visto } = await conectar(e, req, A);
  igual(visto.pedido.cliente, "ChatGPT"); igual(visto.pedido.destino, "chatgpt.com");
  verdade(/^js_[0-9a-f]{48}$/.test(tokens.access_token) && /^jsr_[0-9a-f]{48}$/.test(tokens.refresh_token));
  igual(tokens.token_type, "Bearer"); igual(tokens.scope, "leitura programar");
  const ini = await (await mcpChamar(req, tokens.access_token, { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  igual(ini.result.serverInfo.name, "jarvis-social");
  const nomes = (await (await mcpChamar(req, tokens.access_token, { id: 2, method: "tools/list" })).json()).result.tools.map((t) => t.name);
  verdade(nomes.includes("agendar_reel") && nomes.includes("ver_grade"));
  const ag = await (await mcpChamar(req, tokens.access_token, { id: 3, method: "tools/call", params: { name: "ver_agenda", arguments: {} } })).json();
  igual(ag.result.isError, false, JSON.stringify(ag));
  const lista = (await e.chamar(A, "GET", "/v1/chaves")).corpo.chaves;
  igual(lista.map((k) => k.nome), ["ChatGPT (conectado)"], "a conexão aparece em Ajustes › Integrações");
  verdade(!JSON.stringify(lista).includes(tokens.refresh_token));
});

teste("PKCE errado, código repetido, redirect trocado e cliente desconhecido são recusados", async () => {
  const e = ambiente(); await e.preparar(A); const req = montar(e);
  const c = await conectar(e, req, A);
  const de_novo = await req("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: c.code, code_verifier: c.verificador, client_id: c.reg.client_id } });
  igual(de_novo.status, 400); igual((await de_novo.json()).error, "invalid_grant");
  igual((await mcpChamar(req, c.tokens.access_token, { id: 1, method: "ping" })).status, 401, "código reusado derruba o token que ele gerou");
  // PKCE errado
  const reg = await (await req("POST", "/oauth/register", { corpo: { client_name: "X", redirect_uris: [REDIRECT] } })).json();
  const { desafio } = await pkce();
  const ida = await req("GET", "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: desafio, code_challenge_method: "S256" }));
  const pedido = ida.headers.get("location").split("/").pop();
  const code = new URL((await e.chamar(A, "POST", `/v1/oauth/pedidos/${pedido}/aprovar`)).corpo.redirecionar_para).searchParams.get("code");
  igual((await (await req("POST", "/oauth/token", { form: { grant_type: "authorization_code", code, code_verifier: "x".repeat(43) } })).json()).error, "invalid_grant");
  // redirect não registrado: página de erro, nunca redireciona
  const mau = await req("GET", "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://ladrao.exemplo/cb", code_challenge: desafio, code_challenge_method: "S256" }));
  igual(mau.status, 400); igual(mau.headers.get("location"), null);
  // sem PKCE: volta ao cliente com erro
  const sem = await req("GET", "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT }));
  igual(new URL(sem.headers.get("location")).searchParams.get("error"), "invalid_request");
  igual((await req("GET", "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: "00000000-0000-0000-0000-000000000000", redirect_uri: REDIRECT }))).status, 400, "cliente desconhecido: página de erro");
  igual((await req("POST", "/oauth/register", { corpo: { redirect_uris: ["http://ladrao.exemplo/cb"] } })).status, 400, "redirect http fora do loopback");
});

teste("renovação troca o segredo da mesma conexão; revogar no painel corta acesso e renovação", async () => {
  const e = ambiente(); await e.preparar(A); const req = montar(e);
  const { tokens, reg } = await conectar(e, req, A);
  const r = await (await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.client_id } })).json();
  verdade(r.access_token && r.access_token !== tokens.access_token);
  igual((await mcpChamar(req, tokens.access_token, { id: 1, method: "ping" })).status, 401, "o token antigo para de valer");
  igual((await mcpChamar(req, r.access_token, { id: 1, method: "ping" })).status, 200);
  igual((await (await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token } })).json()).error, "invalid_grant", "refresh antigo não reusa");
  igual((await e.chamar(A, "GET", "/v1/chaves")).corpo.chaves.length, 1, "uma conexão = uma linha");
  // vencido: renova sozinho
  e.avancar(8 * 24 * 60);
  igual((await mcpChamar(req, r.access_token, { id: 1, method: "ping" })).headers.get("www-authenticate").includes('error="invalid_token"'), true);
  const r2 = await (await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: r.refresh_token } })).json();
  igual((await mcpChamar(req, r2.access_token, { id: 1, method: "ping" })).status, 200);
  const [k] = (await e.chamar(A, "GET", "/v1/chaves")).corpo.chaves;
  await e.chamar(A, "POST", `/v1/chaves/${k.id}/revogar`);
  igual((await mcpChamar(req, r2.access_token, { id: 1, method: "ping" })).status, 401);
  igual((await (await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: r2.refresh_token } })).json()).error, "invalid_grant");
});

teste("'Só ler' no painel vale no servidor; pedido de outro espaço/negado/vencido não serve", async () => {
  const e = ambiente(); await e.preparar(A); await e.preparar(B); const req = montar(e);
  const { tokens } = await conectar(e, req, A, { escopo: "leitura" });
  igual(tokens.scope, "leitura");
  const r = await (await mcpChamar(req, tokens.access_token, { id: 1, method: "tools/call", params: { name: "pausar_fila", arguments: {} } })).json();
  igual(r.result.isError, true); verdade(r.result.content[0].text.includes("só de leitura"));
  // negar
  const reg = await (await req("POST", "/oauth/register", { corpo: { client_name: "Y", redirect_uris: [REDIRECT] } })).json();
  const { desafio } = await pkce();
  const abrir = async () => (await req("GET", "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: desafio, code_challenge_method: "S256", state: "s" }))).headers.get("location").split("/").pop();
  const p1 = await abrir();
  const n = await e.chamar(A, "POST", `/v1/oauth/pedidos/${p1}/negar`);
  igual(new URL(n.corpo.redirecionar_para).searchParams.get("error"), "access_denied");
  igual((await e.chamar(A, "POST", `/v1/oauth/pedidos/${p1}/aprovar`)).status, 404, "negado não vira aprovado");
  const p2 = await abrir(); e.avancar(16);
  igual((await e.chamar(A, "GET", `/v1/oauth/pedidos/${p2}`)).status, 410, "pedido vence em 15 min");
  // o token só enxerga o espaço de quem aprovou
  const posts = await (await mcpChamar(req, tokens.access_token, { id: 2, method: "tools/call", params: { name: "ver_agenda", arguments: {} } })).json();
  verdade(!JSON.stringify(posts).includes("Espaço b"));
  // chave de integração não aprova conexão nova
  const p3 = await abrir();
  const viaChave = await e.api.tratar({ metodo: "POST", caminho: `/v1/oauth/pedidos/${p3}/aprovar`, corpo: {}, token: tokens.access_token });
  igual(viaChave.status, 403);
});

teste("sem autenticação continua valendo: endereço com a chave do painel", async () => {
  const e = ambiente(); await e.preparar(A); const req = montar(e);
  const chave = (await e.chamar(A, "POST", "/v1/chaves", { nome: "ChatGPT" })).corpo.segredo;
  const r = await (await req("POST", "/" + chave, { corpo: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).json();
  verdade(r.result.tools.length > 10);
});

rodar("OAuth do conector: ChatGPT e Claude conectam como no Metricool");
