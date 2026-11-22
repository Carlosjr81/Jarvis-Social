// Edge Function `mcp`: o conector do Jarvis Social para o Claude e o ChatGPT.
// URL: https://<ref>.supabase.co/functions/v1/mcp/<chave>  (ou Authorization: Bearer <chave>)
// A chave é criada no painel (Ajustes › Integrações). Chave inválida = 401.
import { criarMcp } from "../_compartilhado/mcp.js";
import { criarApiDoServidor } from "../_compartilhado/servidor.js";

const api = criarApiDoServidor((k: string) => Deno.env.get(k) || "");
const mcp = criarMcp({ api });
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const doCaminho = url.pathname.split("/").filter(Boolean).pop() || "";
  const auth = req.headers.get("authorization") || "";
  const token = doCaminho.startsWith("js_") ? doCaminho : auth.startsWith("Bearer js_") ? auth.slice(7) : "";
  if (req.method === "GET") return new Response("Use POST (MCP por HTTP).", { status: 405, headers: { Allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const conferida = await api.tratar({ metodo: "GET", caminho: "/v1/eu", token });
  if (conferida.status === 401) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: conferida.corpo.mensagem } }, 401);
  let corpo;
  try { corpo = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, 400); }
  const r = await mcp.tratar(corpo, token);
  return r === null ? new Response(null, { status: 202 }) : json(r);
});
