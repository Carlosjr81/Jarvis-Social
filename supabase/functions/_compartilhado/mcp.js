// Conector MCP do Jarvis Social (Model Context Protocol, transporte HTTP com
// JSON-RPC). É o que o Claude (claude.ai › Conectores) e o ChatGPT (modo de
// conectores) usam para gerenciar a grade de Reels conversando com o dono.
// Cada ferramenta chama a MESMA API do painel (api.tratar) com a chave de
// integração: mesmas regras, mesmo isolamento, mesma fonte da verdade.
import { VERSAO_API } from "./api.js";

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const S = (props, req = []) => ({ type: "object", properties: props, required: req, additionalProperties: false });
const DATA = { type: "string", description: "Data local AAAA-MM-DD (fuso do espaço, padrão America/Sao_Paulo)" };
const HORA = { type: "string", description: "Hora local HH:MM" };
const ID = { type: "string", description: "id da publicação (post_id)" };

export const FERRAMENTAS = [
  { name: "ver_grade", description: "Mostra a grade de publicação futura: cada horário da frequência configurada nos próximos dias, livre ou ocupado (e por qual post), mais os posts fora da grade e quantos rascunhos esperam horário. Use primeiro para saber o que está programado.", inputSchema: S({ dias: { type: "integer", minimum: 1, maximum: 60, description: "quantos dias à frente (padrão 14)" } }),
    chamar: (a) => ["GET", "/v1/grade", null, { dias: a.dias || 14 }] },
  { name: "ver_agenda", description: "Lista as publicações (Reels) entre duas datas, com estado, horário local, conta e recibo.", inputSchema: S({ de: DATA, ate: DATA }),
    chamar: (a) => ["GET", "/v1/posts", null, { de: a.de, ate: a.ate, incluir_rascunhos: "1" }] },
  { name: "listar_rascunhos", description: "Rascunhos (vídeos já enviados pelo painel, ainda sem horário). São eles que o assistente programa.", inputSchema: S({}),
    chamar: () => ["GET", "/v1/posts", null, { estado: "draft" }] },
  { name: "listar_videos", description: "Vídeos e capas da biblioteca (enviados pelo painel). Use o id do vídeo para criar um rascunho.", inputSchema: S({}),
    chamar: () => ["GET", "/v1/midias"] },
  { name: "ver_publicacao", description: "Detalhes, histórico e recibo de uma publicação (inclui o permalink quando publicada de verdade).", inputSchema: S({ post_id: ID }, ["post_id"]),
    chamar: (a) => ["GET", `/v1/posts/${encodeURIComponent(a.post_id)}`] },
  { name: "criar_rascunho", description: "Cria um rascunho a partir de um vídeo da biblioteca, com legenda (e capa e conta opcionais). Não programa: depois use programar ou preencher_grade.", inputSchema: S({ video_id: { type: "string" }, capa_id: { type: "string" }, legenda: { type: "string", maxLength: 2200 }, conta_id: { type: "string" }, chave: { type: "string", description: "identificador único deste pedido (repetir o mesmo não duplica)" } }, ["video_id", "legenda"]),
    chamar: (a) => ["POST", "/v1/posts", { video_id: a.video_id, capa_id: a.capa_id, conta_id: a.conta_id, legenda: a.legenda, agendar: false, chave_idempotencia: a.chave || "mcp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }] },
  { name: "programar", description: "Programa uma publicação: com data e hora locais, ou no próximo horário livre da grade (proximo_livre: true).", inputSchema: S({ post_id: ID, data: DATA, hora: HORA, proximo_livre: { type: "boolean" } }, ["post_id"]),
    chamar: (a) => ["POST", `/v1/posts/${encodeURIComponent(a.post_id)}/agendar`, { data: a.data, hora: a.hora, proximo_livre: !!a.proximo_livre }] },
  { name: "preencher_grade", description: "Encaixa os rascunhos com vídeo nos próximos horários livres da grade, na ordem em que foram criados (ou na ordem de post_ids).", inputSchema: S({ post_ids: { type: "array", items: { type: "string" } }, limite: { type: "integer", minimum: 1, maximum: 50 } }),
    chamar: (a) => ["POST", "/v1/grade/preencher", { post_ids: a.post_ids, limite: a.limite }] },
  { name: "editar_publicacao", description: "Muda legenda e/ou data e hora de uma publicação ainda não enviada.", inputSchema: S({ post_id: ID, legenda: { type: "string", maxLength: 2200 }, data: DATA, hora: HORA }, ["post_id"]),
    chamar: null, especial: "editar" },
  { name: "pausar_publicacao", description: "Pausa uma publicação programada.", inputSchema: S({ post_id: ID }, ["post_id"]), chamar: (a) => ["POST", `/v1/posts/${encodeURIComponent(a.post_id)}/pausar`, {}] },
  { name: "retomar_publicacao", description: "Retoma uma publicação pausada (se o horário passou, informe data e hora novas com editar_publicacao).", inputSchema: S({ post_id: ID }, ["post_id"]), chamar: (a) => ["POST", `/v1/posts/${encodeURIComponent(a.post_id)}/retomar`, {}] },
  { name: "cancelar_publicacao", description: "Cancela uma publicação (não será enviada). Peça confirmação ao dono antes.", inputSchema: S({ post_id: ID }, ["post_id"]), chamar: (a) => ["POST", `/v1/posts/${encodeURIComponent(a.post_id)}/cancelar`, {}] },
  { name: "pausar_fila", description: "Pausa TODAS as próximas publicações do espaço.", inputSchema: S({}), chamar: () => ["POST", "/v1/fila/pausar", {}] },
  { name: "retomar_fila", description: "Retoma a fila de publicações.", inputSchema: S({}), chamar: () => ["POST", "/v1/fila/retomar", {}] },
  { name: "previa_frequencia", description: "Mostra o que mudaria na grade com uma nova frequência (horários por dia e dias da semana). Sempre mostre a prévia ao dono antes de aplicar.", inputSchema: S({ horarios: { type: "array", items: HORA }, dias: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, description: "1 = segunda ... 7 = domingo" } }, ["horarios"]),
    chamar: (a) => ["POST", "/v1/frequencia/previa", { politica: { horarios: a.horarios, dias: a.dias || [1, 2, 3, 4, 5, 6, 7] } }] },
  { name: "aplicar_frequencia", description: "Aplica a nova frequência. Exige o hash_previa devolvido por previa_frequencia (garante que o dono viu o que muda).", inputSchema: S({ horarios: { type: "array", items: HORA }, dias: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } }, hash_previa: { type: "string" } }, ["horarios"]),
    chamar: (a) => ["PUT", "/v1/frequencia", { politica: { horarios: a.horarios, dias: a.dias || [1, 2, 3, 4, 5, 6, 7] }, hash_previa: a.hash_previa }] },
  { name: "comando", description: "Executa um pedido em português do dono (ex.: 'Programe este vídeo amanhã às 10h', 'Mostre minha agenda da semana', 'Altere para dois vídeos por dia'). Se a resposta pedir confirmação, repita com confirmar: true e o hash_previa.", inputSchema: S({ texto: { type: "string" }, post_id: ID, confirmar: { type: "boolean" }, hash_previa: { type: "string" } }, ["texto"]),
    chamar: (a) => ["POST", "/v1/comandos", { texto: a.texto, post_id: a.post_id, confirmar: a.confirmar, hash_previa: a.hash_previa }] },
];

export const INSTRUCOES = `Você gerencia a grade de Reels do Instagram do dono pelo Jarvis Social.
Regras: comece por ver_grade; use datas no fuso do espaço (America/Sao_Paulo); antes de mudar a frequência, mostre previa_frequencia e só aplique com o OK do dono; antes de cancelar, confirme. Diga sempre o estado exato: "agendado no Jarvis" não é "publicado"; publicado só com permalink. Vídeos novos entram pelo painel (Novo Reel ou Biblioteca); você programa o que já está lá.`;

export function criarMcp({ api }) {
  const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
  const erro = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  async function chamarFerramenta(f, args, token) {
    let r;
    if (f.especial === "editar") {
      const atual = await api.tratar({ metodo: "GET", caminho: `/v1/posts/${encodeURIComponent(args.post_id)}`, token });
      if (atual.status !== 200) r = atual;
      else r = await api.tratar({ metodo: "PATCH", caminho: `/v1/posts/${encodeURIComponent(args.post_id)}`, corpo: { versao: atual.corpo.post.versao, legenda: args.legenda, data: args.data, hora: args.hora }, token });
    } else {
      const [metodo, caminho, corpo, consulta] = f.chamar(args || {});
      r = await api.tratar({ metodo, caminho, corpo: corpo || {}, consulta: consulta || {}, token });
    }
    const falhou = r.status >= 400;
    const texto = falhou ? `Erro (${r.corpo.erro}): ${r.corpo.mensagem}` : JSON.stringify(r.corpo, null, 1);
    return { content: [{ type: "text", text: texto }], structuredContent: falhou ? undefined : r.corpo, isError: falhou };
  }

  async function uma(msg, token) {
    const { id, method, params = {} } = msg || {};
    const notificacao = id === undefined || id === null;
    if (!method) return notificacao ? null : erro(id ?? null, -32600, "Pedido inválido");
    if (method === "initialize") {
      const v = VERSOES.includes(params.protocolVersion) ? params.protocolVersion : VERSOES[0];
      return ok(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "jarvis-social", version: VERSAO_API }, instructions: INSTRUCOES });
    }
    if (notificacao) return null; // notifications/initialized e outras: sem resposta
    if (method === "ping") return ok(id, {});
    if (method === "tools/list") return ok(id, { tools: FERRAMENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === "tools/call") {
      const f = FERRAMENTAS.find((x) => x.name === params.name);
      if (!f) return erro(id, -32602, "Ferramenta desconhecida: " + params.name);
      try { return ok(id, await chamarFerramenta(f, params.arguments || {}, token)); }
      catch (e) { return ok(id, { content: [{ type: "text", text: "Erro interno ao executar a ferramenta." }], isError: true }); }
    }
    return erro(id, -32601, "Método não suportado: " + method);
  }

  // corpo JSON-RPC (objeto ou lote) -> resposta (objeto, lote ou null = 202 sem corpo)
  async function tratar(corpo, token) {
    if (Array.isArray(corpo)) { const rs = (await Promise.all(corpo.map((m) => uma(m, token)))).filter(Boolean); return rs.length ? rs : null; }
    return uma(corpo, token);
  }
  return { tratar, FERRAMENTAS };
}
