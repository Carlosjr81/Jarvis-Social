// O servidor HTTP do conector MCP (Streamable HTTP, respostas JSON) com o
// OAuth do oauth.js. Usa Request/Response padrão: roda igual no Deno
// (Edge Function `mcp`) e no Node (testes).
//
// Dois jeitos de conectar:
//  - OAuth (como o Metricool no ChatGPT): endereço <base>, autenticação OAuth.
//  - Sem autenticação: endereço <base>/<chave js_...> (a chave criada no painel).
import { criarMcp } from "./mcp.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
const json = (corpo, status = 200, extra = {}) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra } });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pagina = (titulo, texto, status) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titulo)}</title><body style="font-family:system-ui;background:#0b0b14;color:#f3f3f7;padding:24px"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></body>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export function criarServidorMcp({ api, base }) {
  const mcp = criarMcp({ api });
  const { oauth } = api;
  const metadadosRecurso = base + "/.well-known/oauth-protected-resource";
  const desafio = (extra = "") => ({ "WWW-Authenticate": `Bearer resource_metadata="${metadadosRecurso}", scope="leitura programar"${extra}` });
  const erroOAuth = (e) => {
    if (e && e.erro) return json({ error: e.erro, error_description: e.message }, e.erro === "invalid_client" ? 401 : e.status || 400);
    throw e;
  };

  async function lerCorpo(req) {
    const tipo = req.headers.get("content-type") || "";
    const txt = await req.text();
    if (tipo.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(txt));
    try { return JSON.parse(txt || "{}"); } catch { return Object.fromEntries(new URLSearchParams(txt)); }
  }

  return async function atender(req) {
    const url = new URL(req.url);
    const caminho = url.pathname.replace(/\/+$/, "");
    const M = req.method.toUpperCase();
    if (M === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // --- descoberta (o cliente lê isto antes de pedir login)
    if (caminho.includes("/.well-known/oauth-protected-resource")) return json(oauth.metadadosRecurso());
    if (caminho.includes("/.well-known/oauth-authorization-server") || caminho.includes("/.well-known/openid-configuration")) return json(oauth.metadadosServidor());

    // --- OAuth
    try {
      if (caminho.endsWith("/oauth/register") && M === "POST") return json(await oauth.registrar(await lerCorpo(req)), 201);
      if (caminho.endsWith("/oauth/token") && M === "POST") return json(await oauth.token(await lerCorpo(req)), 200, { Pragma: "no-cache" });
      if (caminho.endsWith("/oauth/authorize") && M === "GET") {
        try { const r = await oauth.autorizar(Object.fromEntries(url.searchParams)); return new Response(null, { status: 302, headers: { Location: r.redirecionar, "Cache-Control": "no-store" } }); }
        catch (e) { if (e && e.erro) return pagina("Não deu para conectar", e.message, e.status || 400); throw e; }
      }
    } catch (e) { return erroOAuth(e); }

    // --- o MCP
    const ultimo = caminho.split("/").pop() || "";
    const auth = req.headers.get("authorization") || "";
    const token = ultimo.startsWith("js_") ? ultimo : /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
    if (M === "GET" || M === "DELETE") return new Response("Use POST (MCP por HTTP, respostas JSON).", { status: 405, headers: { Allow: "POST", ...CORS } });
    if (M !== "POST") return new Response(null, { status: 405, headers: CORS });
    if (!token) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Conecte o Jarvis Social: falta autorização." } }, 401, desafio());
    const conferida = await api.tratar({ metodo: "GET", caminho: "/v1/eu", token });
    if (conferida.status === 401) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: conferida.corpo.mensagem } }, 401, desafio(`, error="invalid_token", error_description="${String(conferida.corpo.mensagem).replace(/"/g, "'")}"`));
    let corpo;
    try { corpo = JSON.parse(await req.text()); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, 400); }
    const r = await mcp.tratar(corpo, token); // aceita lote também
    return r === null || (Array.isArray(r) && !r.length) ? new Response(null, { status: 202, headers: CORS }) : json(r);
  };
}
