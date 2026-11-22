// OAuth 2.1 do conector MCP: o ChatGPT (e o Claude) conectam como no
// Metricool. Você cola o endereço do MCP, toca em Conectar, entra no painel
// do Jarvis, toca em Permitir e volta para a conversa. Nenhuma chave copiada.
//
// Base (emissor e recurso) = https://<ref>.supabase.co/functions/v1/mcp
//   GET  <base>/.well-known/oauth-protected-resource      (RFC 9728)
//   GET  <base>/.well-known/oauth-authorization-server    (RFC 8414, forma "acrescentada")
//   GET  <base>/.well-known/openid-configuration          (a forma que o MCP manda tentar quando o emissor tem caminho)
//   POST <base>/oauth/register    registro dinâmico de cliente (RFC 7591)
//   GET  <base>/oauth/authorize   confere cliente, redirect e PKCE e manda para o painel (#autorizar/<pedido>)
//   POST <base>/oauth/token       authorization_code (PKCE S256) e refresh_token (rotativo)
// Também aceita client_id que é URL (Client ID Metadata Document, MCP 2025-11).
//
// O token de acesso É uma chave de integração (js_ + 48 hex, tabela
// tokens_api): vale exatamente o que a chave manual vale (ROTAS_DA_CHAVE,
// escopos, só o espaço dela) e aparece em Ajustes › Integrações, onde se revoga.
// O refresh troca o segredo da MESMA linha (um aparelho conectado = uma linha).
import { sha256Hex } from "./cifra.js";
import { conferirDestino } from "./importar.js";

export const ESCOPOS = ["leitura", "programar"];
const MIN = 60e3, DIA = 864e5;
export const PRAZOS = { pedido: 15 * MIN, codigo: 5 * MIN, acesso: 7 * DIA, refresh: 180 * DIA };

export class ErroOAuth extends Error {
  constructor(erro, descricao, status = 400) { super(descricao); this.erro = erro; this.status = status; }
}
const falha = (e, d, s) => { throw new ErroOAuth(e, d, s); };

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function s256(verificador) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador)));
  let s = ""; for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Redirect aceito: https público, ou http só em loopback (ferramentas locais).
export function redirectValido(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.hash || x.username || x.password) return false;
  if (x.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
  return x.protocol === "https:";
}

export function normalizarEscopo(scope) {
  const pedidos = String(scope || "").split(/\s+/).filter((s) => ESCOPOS.includes(s));
  return pedidos.length ? [...new Set(["leitura", ...pedidos])] : [...ESCOPOS];
}

export function criarOAuth({ banco, agora = () => new Date().toISOString(), base, urlPainel, buscar = globalThis.fetch }) {
  const depois = (ms) => new Date(Date.parse(agora()) + ms).toISOString();

  function metadadosRecurso() {
    return { resource: base, authorization_servers: [base], scopes_supported: ESCOPOS, bearer_methods_supported: ["header"], resource_name: "Jarvis Social" };
  }
  function metadadosServidor() {
    return {
      issuer: base,
      authorization_endpoint: base + "/oauth/authorize",
      token_endpoint: base + "/oauth/token",
      registration_endpoint: base + "/oauth/register",
      scopes_supported: ESCOPOS,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      // campos que alguns clientes exigem em openid-configuration
      subject_types_supported: ["public"],
      service_documentation: "https://github.com/Carlosjr81/Jarvis-Social/blob/main/docs/INTEGRACAO-ASSISTENTES.md",
    };
  }

  async function registrar(c = {}) {
    const uris = Array.isArray(c.redirect_uris) ? c.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(redirectValido)) falha("invalid_redirect_uri", "redirect_uris: use 1 a 10 endereços https.");
    const auth = c.token_endpoint_auth_method || "none";
    if (auth !== "none") falha("invalid_client_metadata", "Só clientes públicos (token_endpoint_auth_method none, com PKCE).");
    const nome = String(c.client_name || "Assistente").replace(/[\u0000-\u001f<>]/g, "").slice(0, 80) || "Assistente";
    const cli = await banco.inserir("oauth_clientes", { nome, redirect_uris: uris, criado_em: agora() });
    return {
      client_id: cli.id, client_id_issued_at: Math.floor(Date.parse(cli.criado_em) / 1000), client_name: nome, redirect_uris: uris,
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    };
  }

  // client_id registrado aqui OU URL de um documento de metadados do cliente.
  async function cliente(clientId) {
    const id = String(clientId || "");
    if (/^https:\/\//.test(id)) {
      conferirDestino(id);
      let doc;
      try {
        const r = await buscar(id, { redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
        const txt = r.ok ? await r.text() : "";
        if (!r.ok || txt.length > 10000) throw 0;
        doc = JSON.parse(txt);
      } catch { falha("invalid_client", "Não consegui ler o documento do cliente."); }
      if (doc.client_id !== id) falha("invalid_client", "O documento do cliente não confere com o client_id.");
      const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(redirectValido) : [];
      if (!uris.length) falha("invalid_client", "O documento do cliente não tem redirect_uris válidos.");
      return { id, nome: String(doc.client_name || new URL(id).hostname).slice(0, 80), redirect_uris: uris };
    }
    if (!/^[0-9a-f-]{8,64}$/i.test(id)) falha("invalid_client", "Cliente desconhecido.");
    const c = await banco.obter("oauth_clientes", id).catch(() => null);
    if (!c) falha("invalid_client", "Cliente desconhecido: conecte de novo pelo assistente.");
    return c;
  }

  // GET /oauth/authorize. Erro de cliente/redirect: NUNCA redireciona (mostra a página).
  // Os demais erros voltam ao redirect do cliente, como manda o OAuth.
  async function autorizar(q) {
    const cli = await cliente(q.client_id);
    const redirect = q.redirect_uri || (cli.redirect_uris.length === 1 ? cli.redirect_uris[0] : "");
    if (!cli.redirect_uris.includes(redirect)) falha("invalid_request", "redirect_uri não registrado para este cliente.");
    const devolver = (erro, descricao) => ({ redirecionar: montarRetorno(redirect, { error: erro, error_description: descricao, state: q.state }) });
    if (q.response_type !== "code") return devolver("unsupported_response_type", "Use response_type=code.");
    if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return devolver("invalid_request", "PKCE S256 obrigatório.");
    if (q.resource && q.resource.replace(/\/$/, "") !== base) return devolver("invalid_target", "Recurso desconhecido.");
    if (!urlPainel) falha("server_error", "Painel não configurado (JS_URL_PAINEL).", 500);
    const p = await banco.inserir("oauth_pedidos", {
      client_id: String(q.client_id), cliente_nome: cli.nome, redirect_uri: redirect, code_challenge: q.code_challenge,
      escopos: normalizarEscopo(q.scope), state: q.state ? String(q.state).slice(0, 500) : null,
      criado_em: agora(), expira_em: depois(PRAZOS.pedido), usuario_id: null, org_id: null, codigo_hash: null, usado: false,
    });
    return { redirecionar: urlPainel.replace(/#.*$/, "") + "#autorizar/" + p.id };
  }

  function montarRetorno(redirect, params) {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries({ ...params, iss: base })) if (v != null && v !== "") u.searchParams.set(k, v);
    return u.toString();
  }

  // --- lado do painel (sessão do dono da conta; chamadas por /v1/oauth/...)
  async function pedidoValido(id) {
    const p = await banco.obter("oauth_pedidos", id).catch(() => null);
    if (!p || p.usado || p.codigo_hash) falha("pedido", "Pedido de conexão não encontrado ou já usado. Comece de novo pelo assistente.", 404);
    if (p.expira_em < agora()) falha("pedido", "O pedido de conexão venceu (15 min). Comece de novo pelo assistente.", 410);
    return p;
  }
  async function verPedido(id) {
    const p = await pedidoValido(id);
    return { pedido: { id: p.id, cliente: p.cliente_nome, destino: new URL(p.redirect_uri).hostname, escopos: p.escopos } };
  }
  async function aprovar(ctx, id, { escopo } = {}) {
    const p = await pedidoValido(id);
    const escopos = escopo === "leitura" ? ["leitura"] : p.escopos;
    const codigo = "jsc_" + hex(24);
    const feito = await banco.atualizar("oauth_pedidos", p.id, { usuario_id: ctx.usuario.id, org_id: ctx.org.id, escopos, codigo_hash: await sha256Hex(codigo), expira_em: depois(PRAZOS.codigo) }, { codigo_hash: { nulo: true } });
    if (!feito) falha("pedido", "Pedido já usado.", 409);
    return { redirecionar_para: montarRetorno(p.redirect_uri, { code: codigo, state: p.state }) };
  }
  async function negar(id) {
    const p = await pedidoValido(id);
    await banco.atualizar("oauth_pedidos", p.id, { usado: true });
    return { redirecionar_para: montarRetorno(p.redirect_uri, { error: "access_denied", error_description: "Conexão recusada no Jarvis Social.", state: p.state }) };
  }

  // --- POST /oauth/token
  async function emitir(linha, extra = {}) {
    const acesso = "js_" + hex(24), refresh = "jsr_" + hex(24);
    const mud = { hash: await sha256Hex(acesso), prefixo: acesso.slice(0, 10), expira_em: depois(PRAZOS.acesso), refresh_hash: await sha256Hex(refresh), refresh_expira_em: depois(PRAZOS.refresh), ...extra };
    const k = linha.id ? await banco.atualizar("tokens_api", linha.id, mud, { refresh_hash: linha.refresh_hash }) : await banco.inserir("tokens_api", { ...linha, ...mud });
    if (!k) falha("invalid_grant", "Token de renovação já usado.");
    return { access_token: acesso, token_type: "Bearer", expires_in: Math.round(PRAZOS.acesso / 1000), refresh_token: refresh, scope: k.escopos.join(" ") };
  }
  async function token(c = {}) {
    if (c.grant_type === "authorization_code") {
      if (!c.code || !c.code_verifier) falha("invalid_request", "Faltam code e code_verifier.");
      const [p] = await banco.listar("oauth_pedidos", { codigo_hash: await sha256Hex(String(c.code)) });
      if (!p || p.expira_em < agora()) falha("invalid_grant", "Código inválido ou vencido.");
      if (p.usado) { // código repetido: derruba o que ele emitiu (RFC 6749 §4.1.2)
        for (const k of await banco.listar("tokens_api", { oauth_pedido_id: p.id })) await banco.atualizar("tokens_api", k.id, { revogado: true, revogado_em: agora() });
        falha("invalid_grant", "Código já usado.");
      }
      if (c.client_id && String(c.client_id) !== p.client_id) falha("invalid_grant", "Código de outro cliente.");
      if (c.redirect_uri && c.redirect_uri !== p.redirect_uri) falha("invalid_grant", "redirect_uri diferente do pedido.");
      if ((await s256(String(c.code_verifier))) !== p.code_challenge) falha("invalid_grant", "PKCE não confere.");
      if (!(await banco.atualizar("oauth_pedidos", p.id, { usado: true }, { usado: false }))) falha("invalid_grant", "Código já usado.");
      return emitir({
        org_id: p.org_id, usuario_id: p.usuario_id, nome: `${p.cliente_nome} (conectado)`, escopos: p.escopos, criado_em: agora(),
        ultimo_uso: null, revogado: false, oauth_client_id: p.client_id, oauth_pedido_id: p.id,
      });
    }
    if (c.grant_type === "refresh_token") {
      if (!/^jsr_[0-9a-f]{48}$/.test(String(c.refresh_token || ""))) falha("invalid_grant", "Token de renovação inválido.");
      const [k] = await banco.listar("tokens_api", { refresh_hash: await sha256Hex(c.refresh_token) });
      if (!k || k.revogado || !k.refresh_expira_em || k.refresh_expira_em < agora()) falha("invalid_grant", "Conexão revogada ou vencida: conecte de novo.");
      if (c.client_id && String(c.client_id) !== k.oauth_client_id) falha("invalid_grant", "Token de outro cliente.");
      return emitir(k);
    }
    falha("unsupported_grant_type", "Use authorization_code ou refresh_token.");
  }

  return { metadadosRecurso, metadadosServidor, registrar, autorizar, verPedido, aprovar, negar, token, cliente };
}
