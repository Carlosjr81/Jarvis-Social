// Edge Function `api` (Deno, Supabase). Só faz a ponte HTTP: autenticação,
// CORS e JSON. Toda a regra mora em ../_compartilhado/api.js (testada no Node).
import { criarApiDoServidor } from "../_compartilhado/servidor.js";

const env = (k: string) => Deno.env.get(k) || "";
const URL_SB = env("SUPABASE_URL");
const CHAVE = env("SUPABASE_SERVICE_ROLE_KEY");
const ORIGENS = env("JS_ORIGENS_PERMITIDAS").split(",").map((s) => s.trim()).filter(Boolean);
const api = criarApiDoServidor(env);

function cors(origem: string | null) {
  const ok = origem && (ORIGENS.includes(origem) || ORIGENS.includes("*"));
  return {
    "Access-Control-Allow-Origin": ok ? origem! : (ORIGENS[0] || ""),
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Vary": "Origin",
  };
}

async function usuarioDoToken(auth: string | null) {
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${URL_SB}/auth/v1/user`, { headers: { apikey: CHAVE, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email, email_confirmado: !!u.email_confirmed_at, nome: (u.user_metadata && (u.user_metadata.nome || u.user_metadata.full_name)) || "" } : null;
}

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });
  const url = new URL(req.url);
  const caminho = url.pathname.replace(/^.*?\/api(?=\/|$)/, "") || "/";
  // Destino do link de confirmação do e-mail. Fica FORA de carlosjr81.github.io
  // porque lá o link era capturado por outro app instalado (Treino Livre).
  if (caminho === "/confirmado") {
    const erro = url.searchParams.get("error_description") || "";
    const txt = erro ? `Jarvis Social\n\nNão deu para confirmar: ${erro}\n\nAbra o painel e toque em Entrar; se pedir, reenvie a confirmação.\nhttps://carlosjr81.github.io/Jarvis-Social/`
      : "Jarvis Social\n\nE-mail confirmado ✓\n\nVolte ao painel do Jarvis Social e toque em Entrar com o seu e-mail e senha.\nhttps://carlosjr81.github.io/Jarvis-Social/";
    return new Response(txt, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  let corpo = {};
  if (!["GET", "HEAD"].includes(req.method)) {
    const txt = await req.text();
    if (txt.length > 200_000) return new Response(JSON.stringify({ erro: "grande", mensagem: "Pedido grande demais." }), { status: 413, headers: { ...c, "Content-Type": "application/json" } });
    try { corpo = txt ? JSON.parse(txt) : {}; } catch { return new Response(JSON.stringify({ erro: "json", mensagem: "JSON inválido." }), { status: 400, headers: { ...c, "Content-Type": "application/json" } }); }
  }
  const auth = req.headers.get("authorization") || "";
  // Chave de integração (ChatGPT/Claude): "Bearer js_...". Senão, o login do painel.
  const token = auth.startsWith("Bearer js_") ? auth.slice(7) : null;
  const usuario = token ? null : await usuarioDoToken(auth);
  const r = await api.tratar({ metodo: req.method, caminho, consulta: Object.fromEntries(url.searchParams), corpo, usuario, token });
  if (r.excecao) console.error("api:", r.excecao);
  if (r.redirecionar) return new Response(null, { status: 302, headers: { ...c, Location: r.redirecionar } });
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { ...c, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
});
