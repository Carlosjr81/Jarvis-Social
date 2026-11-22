// Monta a API com as peças reais do servidor (Supabase), a partir das
// variáveis de ambiente. Usado pelas funções `api` e `mcp`.
import { criarApi } from "./api.js";
import { BancoPostgrest } from "./banco.js";
import { ArmazenamentoSupabase } from "./armazenamento.js";
import { criarInstagram, CONFIG_IG } from "./instagram.js";

export function criarApiDoServidor(env, f = globalThis.fetch) {
  const URL_SB = env("SUPABASE_URL"), CHAVE = env("SUPABASE_SERVICE_ROLE_KEY");
  const lista = (k) => env(k).split(",").map((s) => s.trim()).filter(Boolean);
  return criarApi({
    banco: new BancoPostgrest({ url: URL_SB, chave: CHAVE }),
    armazenamento: new ArmazenamentoSupabase({ url: URL_SB, chave: CHAVE }),
    instagram: criarInstagram({ config: { ...CONFIG_IG, versao: env("JS_META_VERSAO") || CONFIG_IG.versao } }),
    segredos: {
      appId: env("JS_META_APP_ID"), appSecret: env("JS_META_APP_SECRET"),
      redirectUri: `${URL_SB}/functions/v1/api/v1/instagram/retorno`,
      chaveCifra: env("JS_CHAVE_CIFRA"), urlPainel: env("JS_URL_PAINEL"), emailsDono: lista("JS_EMAIL_DONO"),
    },
    limites: { videoBytes: Number(env("JS_LIMITE_VIDEO_MB") || 50) * 1048576 },
    // "Teste de publicação imediato": acorda a função worker com o segredo dela.
    async cutucarWorker() {
      const r = await f(`${URL_SB}/functions/v1/worker`, { method: "POST", headers: { "x-jarvis-worker": env("JS_SEGREDO_WORKER") } });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, reivindicados: j.reivindicados, resultados: (j.resultados || []).map((x) => x.resultado) };
    },
    // Ações que só o Auth do Supabase faz: link de nova senha e apagar o login (LGPD).
    autenticacao: {
      async enviarLinkSenha(email) {
        const r = await f(`${URL_SB}/auth/v1/recover`, { method: "POST", headers: { apikey: CHAVE, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
        if (!r.ok) throw new Error("não enviou o link de senha: " + r.status);
      },
      async apagarUsuario(id) {
        const r = await f(`${URL_SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } });
        if (!r.ok && r.status !== 404) throw new Error("não apagou o login: " + r.status);
      },
    },
  });
}
