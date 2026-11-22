import { teste, igual, verdade, rodar } from "./base.mjs";
import { ambiente, A, B } from "./ambiente.mjs";
import { criarMcp, FERRAMENTAS } from "../supabase/functions/_compartilhado/mcp.js";

let n = 0; const chave = () => "in" + (++n);
async function comChave(e, usuario, escopo = "programar") {
  const r = await e.chamar(usuario, "POST", "/v1/chaves", { nome: "Claude", escopo, dias: 90 });
  igual(r.status, 200, JSON.stringify(r.corpo));
  return r.corpo.segredo;
}
const viaChave = (e, token, metodo, caminho, corpo, consulta) => e.api.tratar({ metodo, caminho, corpo: corpo || {}, consulta: consulta || {}, token });

teste("chave criada no painel aparece uma vez; a lista não mostra o segredo nem o hash", async () => {
  const e = ambiente(); await e.preparar(A);
  const r = (await e.chamar(A, "POST", "/v1/chaves", { nome: "ChatGPT" })).corpo;
  verdade(/^js_[0-9a-f]{48}$/.test(r.segredo)); igual(r.chave.escopos, ["leitura", "programar"]);
  const lista = JSON.stringify((await e.chamar(A, "GET", "/v1/chaves")).corpo);
  verdade(!lista.includes(r.segredo) && !lista.includes('"hash"'), "lista vaza segredo/hash");
});

teste("chave vale só para o espaço dela e só nas rotas do produto", async () => {
  const e = ambiente(); await e.preparar(A); const b = await e.preparar(B);
  const t = await comChave(e, A);
  const eu = await viaChave(e, t, "GET", "/v1/eu", null, { org_id: b.org.id });
  igual(eu.status, 200); verdade(eu.corpo.org.id !== b.org.id, "org_id de outro espaço ignorado");
  for (const [m, c] of [["GET", "/v1/chaves"], ["POST", "/v1/chaves"], ["GET", "/v1/conta"], ["GET", "/v1/admin/contas"], ["POST", "/v1/instagram/conectar"], ["POST", "/v1/midias"]]) {
    igual((await viaChave(e, t, m, c, {})).corpo.erro, "fora_do_escopo", `${m} ${c}`);
  }
  igual((await viaChave(e, "js_" + "0".repeat(48), "GET", "/v1/eu")).status, 401);
  igual((await viaChave(e, "qualquer", "GET", "/v1/eu")).status, 401);
});

teste("chave só de leitura não muda nada; revogada e vencida param na hora", async () => {
  const e = ambiente(); const { video } = await e.preparar(A);
  const tl = await comChave(e, A, "leitura");
  igual((await viaChave(e, tl, "POST", "/v1/posts", { video_id: video.id, legenda: "x", chave_idempotencia: chave() })).corpo.erro, "so_leitura");
  igual((await viaChave(e, tl, "POST", "/v1/frequencia/previa", { politica: { horarios: ["10:00"] } })).status, 200, "prévia é leitura");
  const t = await comChave(e, A);
  const id = (await e.chamar(A, "GET", "/v1/chaves")).corpo.chaves.find((k) => k.escopos.includes("programar")).id;
  await e.chamar(A, "POST", `/v1/chaves/${id}/revogar`);
  igual((await viaChave(e, t, "GET", "/v1/eu")).corpo.erro, "chave_invalida");
  e.avancar(91 * 1440);
  igual((await viaChave(e, tl, "GET", "/v1/eu")).corpo.erro, "chave_vencida");
});

teste("conta do dono bloqueada: a chave também para", async () => {
  const e = ambiente({ emailsDono: ["dono@x"] }); await e.preparar(A);
  const t = await comChave(e, A);
  await e.banco.atualizar("contas", "a", { status: "bloqueado" });
  igual((await viaChave(e, t, "GET", "/v1/grade")).corpo.erro, "acesso_bloqueado");
});

teste("grade: horários livres e ocupados; preencher encaixa os rascunhos sem repetir horário", async () => {
  const e = ambiente(); const { video } = await e.preparar(A);
  await e.chamar(A, "PUT", "/v1/frequencia", { politica: { horarios: ["10:00", "18:00"], dias: [1, 2, 3, 4, 5, 6, 7] } });
  await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, legenda: "já", proximo_livre: true, agendar: true, chave_idempotencia: chave() });
  for (let i = 0; i < 3; i++) await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, legenda: "r" + i, chave_idempotencia: chave() });
  const t = await comChave(e, A);
  let g = (await viaChave(e, t, "GET", "/v1/grade", null, { dias: 3 })).corpo;
  igual([g.grade.length, g.ocupados, g.rascunhos_esperando], [6, 1, 3]);
  igual(g.grade[0].hora, "18:00"); igual(g.grade[0].post.legenda, "já");
  const p = (await viaChave(e, t, "POST", "/v1/grade/preencher", {})).corpo;
  igual(p.programados.map((x) => x.agendado_local.slice(6, 25)), ["23/11/2026 às 10:00", "23/11/2026 às 18:00", "24/11/2026 às 10:00"]);
  g = (await viaChave(e, t, "GET", "/v1/grade", null, { dias: 3 })).corpo;
  igual([g.ocupados, g.rascunhos_esperando], [4, 0]);
});

teste("MCP: initialize, lista de ferramentas e chamadas pela chave", async () => {
  const e = ambiente(); const { video } = await e.preparar(A);
  const t = await comChave(e, A); const mcp = criarMcp({ api: e.api });
  const ini = await mcp.tratar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude" } } }, t);
  igual([ini.result.protocolVersion, ini.result.serverInfo.name], ["2025-06-18", "jarvis-social"]);
  igual(await mcp.tratar({ jsonrpc: "2.0", method: "notifications/initialized" }, t), null, "notificação sem resposta");
  const lista = (await mcp.tratar({ jsonrpc: "2.0", id: 2, method: "tools/list" }, t)).result.tools.map((x) => x.name);
  for (const nome of ["ver_grade", "preencher_grade", "programar", "comando", "previa_frequencia", "aplicar_frequencia"]) verdade(lista.includes(nome), "falta " + nome);
  const call = (id, name, args) => mcp.tratar({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, t);
  const ras = await call(3, "criar_rascunho", { video_id: video.id, legenda: "pelo Claude" });
  verdade(!ras.result.isError, ras.result.content[0].text);
  const pid = ras.result.structuredContent.post.id;
  const pr = await call(4, "programar", { post_id: pid, data: "2026-11-25", hora: "09:30" });
  igual(pr.result.structuredContent.post.recibo.agendado_local, "qua., 25/11/2026 às 09:30 (America/Sao_Paulo)");
  const ed = await call(5, "editar_publicacao", { post_id: pid, legenda: "nova legenda" });
  igual(ed.result.structuredContent.post.legenda, "nova legenda");
  const cmd = await call(6, "comando", { texto: "Mostre minha agenda da semana" });
  verdade(cmd.result.structuredContent.resposta.includes("25/11/2026 às 09:30"), cmd.result.content[0].text);
  const ruim = await call(7, "cancelar_publicacao", { post_id: "nao-existe" });
  verdade(ruim.result.isError && ruim.result.content[0].text.includes("não encontrada"));
  igual((await call(8, "inexistente", {})).error.code, -32602);
  const lote = await mcp.tratar([{ jsonrpc: "2.0", id: 9, method: "ping" }, { jsonrpc: "2.0", method: "notifications/cancelled" }], t);
  igual(lote.length, 1);
});

teste("MCP: prévia da frequência antes de aplicar (hash obrigatório quando algo muda)", async () => {
  const e = ambiente(); const { video } = await e.preparar(A);
  await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, legenda: "a", proximo_livre: true, agendar: true, chave_idempotencia: chave() });
  const t = await comChave(e, A); const mcp = criarMcp({ api: e.api });
  const call = (id, name, args) => mcp.tratar({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, t);
  const sem = await call(1, "aplicar_frequencia", { horarios: ["08:00", "20:00"] });
  verdade(sem.result.isError && sem.result.content[0].text.includes("prévia"));
  const pv = (await call(2, "previa_frequencia", { horarios: ["08:00", "20:00"] })).result.structuredContent;
  const ap = await call(3, "aplicar_frequencia", { horarios: ["08:00", "20:00"], hash_previa: pv.hash_previa });
  verdade(!ap.result.isError, ap.result.content[0].text);
});

teste("todas as ferramentas têm descrição e esquema de entrada", () => {
  for (const f of FERRAMENTAS) verdade(f.description.length > 20 && f.inputSchema.type === "object", f.name);
});

rodar("integração: chaves, grade de publicação e conector MCP (ChatGPT e Claude)");
