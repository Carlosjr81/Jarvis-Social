// API versionada do Jarvis Social (/v1). Mesma lógica no servidor (Supabase
// Edge Function) e na DEMONSTRAÇÃO do navegador (banco em memória, Instagram
// simulado). O painel, a conversa e qualquer cliente externo usam esta API:
// é a única fonte da verdade.
//
// Tenant: SEMPRE derivado da sessão (membros do usuário). Um `org_id` enviado
// pelo cliente só escolhe entre as organizações de que ele já é membro.
import { FUSO_PADRAO, localParaUtc, utcParaLocal, formatarLocal, somarDias, fusoValido, ErroHorario } from "./tempo.js";
import { politicaPadrao, validarPolitica, proximoSlotLivre, preverMudanca, gerarSlots } from "./frequencia.js";
import { ESTADOS, EDITAVEIS, CANCELAVEIS, transicao, ErroEstado } from "./estados.js";
import { interpretar, AJUDA } from "./comandos.js";
import { ErroBanco } from "./banco.js";
import { cifrar, sha256Hex } from "./cifra.js";
import { criarAcesso, ErroAcesso } from "./api-acesso.js";
import { baixar, ErroImportar } from "./importar.js";
import { criarOAuth, ErroOAuth } from "./oauth.js";

export const VERSAO_API = "2026-11-22a";
const PAPEIS_EDICAO = ["dono", "admin", "editor"];
const PAPEIS_ADMIN = ["dono", "admin"];
export const LIMITE_LEGENDA = 2200;
export const LIMITE_HASHTAGS = 30;
const MIMES = { video: ["video/mp4", "video/quicktime"], capa: ["image/jpeg", "image/png"] };
const EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "image/jpeg": "jpg", "image/png": "png" };

export class ErroApi extends Error {
  constructor(status, codigo, mensagem, extra = {}) { super(mensagem); this.status = status; this.codigo = codigo; this.extra = extra; }
}
const falha = (s, c, m, e) => { throw new ErroApi(s, c, m, e); };

export function validarLegenda(legenda) {
  const l = String(legenda ?? "");
  const erros = [];
  if ([...l].length > LIMITE_LEGENDA) erros.push(`A legenda passou de ${LIMITE_LEGENDA} caracteres.`);
  const tags = l.match(/(^|\s)#[^\s#]+/g) || [];
  if (tags.length > LIMITE_HASHTAGS) erros.push(`Mais de ${LIMITE_HASHTAGS} hashtags.`);
  return { ok: !erros.length, erros, caracteres: [...l].length, hashtags: tags.length };
}

function canonico(o) {
  if (Array.isArray(o)) return `[${o.map(canonico).join(",")}]`;
  if (o && typeof o === "object") return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonico(o[k])).join(",")}}`;
  return JSON.stringify(o ?? null);
}

export function horariosPadrao(n, atuais = []) {
  if (atuais.length === n) return atuais;
  const fixos = { 1: ["10:00"], 2: ["10:00", "18:00"], 3: ["09:00", "13:00", "19:00"] };
  if (fixos[n]) return fixos[n];
  const ini = 8 * 60, fim = 21 * 60, passo = (fim - ini) / (n - 1);
  return Array.from({ length: n }, (_, i) => { const m = Math.round((ini + passo * i) / 5) * 5; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });
}

export function criarApi({ banco, armazenamento, instagram, agora = () => new Date().toISOString(), segredos = {}, modo = "producao", limites = {}, autenticacao = null, cutucarWorker = null, buscar = globalThis.fetch }) {
  const demonstracao = modo === "demonstracao";
  const acesso = criarAcesso({ banco, agora, segredos, demonstracao, autenticacao });
  const LIM = { videoBytes: 50 * 1024 * 1024, capaBytes: 8 * 1024 * 1024, antecedenciaMin: 2, ...limites };

  // ------------------------------------------------------------ contexto
  async function contexto(usuario, orgPedida) {
    if (!usuario || !usuario.id) falha(401, "nao_autenticado", "Entre na sua conta.");
    const membros = await banco.listar("membros", { usuario_id: usuario.id });
    if (!membros.length) falha(403, "sem_organizacao", "Crie seu espaço para começar.");
    const alvo = usuario.org_token || orgPedida; // chave de integração vale só para o espaço dela
    const m = alvo ? membros.find((x) => x.org_id === alvo) : membros[0];
    if (!m) falha(404, "nao_encontrado", "Organização não encontrada."); // não revela se existe
    const org = await banco.obter("organizacoes", m.org_id);
    return { usuario, membro: m, org, papel: m.papel, membros };
  }
  const exigir = (ctx, papeis) => { if (!papeis.includes(ctx.papel)) falha(403, "sem_permissao", "Seu papel não permite esta ação."); };

  async function postDaOrg(ctx, id) {
    const p = id && (await banco.obter("posts", id));
    if (!p || p.org_id !== ctx.org.id) falha(404, "nao_encontrado", "Publicação não encontrada.");
    return p;
  }
  async function midiaDaOrg(ctx, id, tipo) {
    const m = id && (await banco.obter("midias", id));
    if (!m || m.org_id !== ctx.org.id || (tipo && m.tipo !== tipo)) falha(404, "midia_nao_encontrada", `Mídia (${tipo || "arquivo"}) não encontrada.`);
    if (m.estado !== "pronta") falha(409, "midia_pendente", "O envio deste arquivo ainda não terminou.");
    return m;
  }

  async function registrar(evento) { try { await banco.inserir("eventos", evento); } catch { /* evento perdido não desfaz a mudança; a versão protege */ } }

  // Grava uma transição condicionada à versão e ao estado lidos. null = alguém mudou antes.
  async function aplicar(post, para, opcoes) {
    const { mudancas, evento } = transicao(post, para, { agora: agora(), ...opcoes });
    const novo = await banco.atualizar("posts", post.id, mudancas, { versao: post.versao, estado: post.estado });
    if (!novo) falha(409, "versao_desatualizada", "Esta publicação mudou em outro lugar. Recarregue e tente de novo.");
    await registrar(evento);
    return novo;
  }

  async function criarJob(post) {
    // Jobs anteriores deste post ficam obsoletos (o worker também confere a versão).
    for (const j of await banco.listar("jobs", { post_id: post.id, estado: { in: ["pendente", "executando"] } })) {
      await banco.atualizar("jobs", j.id, { estado: "obsoleto" }, { estado: j.estado });
    }
    if (post.estado !== "scheduled") return null;
    return banco.inserir("jobs", { org_id: post.org_id, post_id: post.id, versao_post: post.versao, estado: "pendente", executar_em: post.agendado_utc, lease_ate: null, dono: null, tentativas: 0, criado_em: agora() });
  }

  async function ocupados(orgId, excetoId) {
    const ps = await banco.listar("posts", { org_id: orgId, estado: { in: ["scheduled", "paused", "preparing", "processing", "publishing", "retry_wait", "needs_reconciliation"] } });
    return ps.filter((p) => p.id !== excetoId && p.agendado_utc).map((p) => p.agendado_utc);
  }

  async function resolverHorario(ctx, { data, hora, proximo_livre, publicar_agora }, excetoId) {
    const fuso = ctx.org.fuso || FUSO_PADRAO;
    // "Publicar agora" (teste imediato): o horário é este instante e o worker é acordado.
    if (publicar_agora) return { agendado_utc: agora(), origem_horario: "manual", fuso };
    if (proximo_livre) {
      const s = proximoSlotLivre(ctx.org.politica || politicaPadrao(fuso), await ocupados(ctx.org.id, excetoId), agora());
      if (!s) falha(409, "sem_horario_livre", "Não há horário livre na frequência atual.");
      return { agendado_utc: s, origem_horario: "frequencia", fuso };
    }
    if (!data || !hora) falha(400, "falta_data_hora", "Informe data e horário.", { falta: !data ? "data" : "hora" });
    let iso;
    try { iso = localParaUtc(data, hora, fuso); } catch (e) { if (e instanceof ErroHorario) falha(400, e.codigo, e.message); throw e; }
    if (Date.parse(iso) < Date.parse(agora()) + LIM.antecedenciaMin * 60e3) falha(400, "horario_passado", `Esse horário já passou ou está a menos de ${LIM.antecedenciaMin} min. Escolha um horário futuro.`);
    return { agendado_utc: iso, origem_horario: "manual", fuso };
  }

  // A conta onde publicar: a escolhida no pedido, senão a padrão do espaço, senão a primeira ativa.
  async function contaPadrao(ctx, contaId) {
    if (contaId) {
      const c = await banco.obter("conexoes", contaId);
      if (!c || c.org_id !== ctx.org.id || c.estado === "revogada") falha(404, "conta_nao_encontrada", "Conta do Instagram não encontrada neste espaço.");
      return c;
    }
    const cs = await banco.listar("conexoes", { org_id: ctx.org.id, estado: { in: ["ativa", "reconectar"] } });
    return cs.find((c) => c.id === ctx.org.conta_padrao_id) || cs.find((c) => c.estado === "ativa") || cs[0] || null;
  }

  function semSegredo(c) { if (!c) return null; const { token_cifrado, ...resto } = c; return resto; }

  async function recibo(post, ctx) {
    const fuso = post.fuso || ctx.org.fuso || FUSO_PADRAO;
    const conta = post.conta_id ? await banco.obter("conexoes", post.conta_id) : null;
    const confirmacao = demonstracao || post.simulado || (conta && conta.simulado) ? "demonstracao"
      : post.estado === "published" && post.permalink ? "publicacao_concluida"
      : post.estado === "scheduled" ? "agendamento_confirmado_no_jarvis"
      : "nao_confirmado";
    return {
      post_id: post.id, versao: post.versao, estado: post.estado, estado_texto: ESTADOS[post.estado], teste: !!post.teste,
      confirmacao,
      aviso: confirmacao === "demonstracao" ? "DEMONSTRAÇÃO: nada foi enviado ao Instagram."
        : confirmacao === "agendamento_confirmado_no_jarvis" ? "Gravado no servidor do Jarvis. O Instagram não tem fila nativa pela API: o Jarvis publica no horário e só então haverá permalink."
        : null,
      agendado_utc: post.agendado_utc, agendado_local: post.agendado_utc ? formatarLocal(post.agendado_utc, fuso) : null, fuso,
      rede: "instagram", perfil: conta ? "@" + conta.usuario_rede : null, conta_conectada: !!(conta && conta.estado === "ativa"),
      fonte: post.fonte || null,
      container_id: post.container_id || null, media_id: post.media_id || null, permalink: post.permalink || null, publicado_em: post.publicado_em || null,
      ultimo_erro: post.ultimo_erro || null,
      link_interno: `${segredos.urlPainel || ""}#post/${post.id}`,
    };
  }

  async function vistaPost(post, ctx) {
    const fuso = post.fuso || ctx.org.fuso || FUSO_PADRAO;
    return { ...post, local: post.agendado_utc ? utcParaLocal(post.agendado_utc, fuso) : null, estado_texto: ESTADOS[post.estado], recibo: await recibo(post, ctx) };
  }

  // ------------------------------------------------------------ operações
  const op = {};

  op.eu = async (ctx) => {
    const conexoes = (await banco.listar("conexoes", { org_id: ctx.org.id })).map(semSegredo);
    const problemas = await banco.listar("posts", { org_id: ctx.org.id, estado: { in: ["failed", "needs_reconciliation"] } }, { ordem: "atualizado_em", desc: true, limite: 20 });
    const alertas = [];
    if (!conexoes.some((c) => c.estado === "ativa")) alertas.push({ tipo: "conexao", texto: "Instagram não conectado: as publicações agendadas não serão enviadas até conectar.", acao: "ajustes" });
    for (const c of conexoes.filter((c) => c.estado === "reconectar")) alertas.push({ tipo: "conexao", texto: `Reconecte @${c.usuario_rede}: a autorização expirou ou foi revogada.`, acao: "ajustes" });
    if (ctx.org.fila_pausada) alertas.push({ tipo: "pausa", texto: "A fila está pausada: nada será publicado até retomar.", acao: "retomar" });
    for (const p of problemas) alertas.push({ tipo: p.estado, texto: `${ESTADOS[p.estado]}: ${p.ultimo_erro || "sem detalhe"}`, post_id: p.id });
    return {
      modo, versao_api: VERSAO_API, agora: agora(),
      usuario: { id: ctx.usuario.id, email: ctx.usuario.email },
      organizacoes: await Promise.all(ctx.membros.map(async (m) => ({ id: m.org_id, papel: m.papel, nome: (await banco.obter("organizacoes", m.org_id) || {}).nome }))),
      org: ctx.org, papel: ctx.papel, conexoes, alertas,
      instagram_configurado: demonstracao || !!(await acesso.credenciaisMeta()),
      redirect_uri_meta: segredos.redirectUri || null,
    };
  };

  op.criarOrganizacao = async (usuario, corpo) => {
    if (!usuario || !usuario.id) falha(401, "nao_autenticado", "Entre na sua conta.");
    const fuso = corpo.fuso || FUSO_PADRAO;
    if (!fusoValido(fuso)) falha(400, "fuso_invalido", "Fuso desconhecido.");
    const org = await banco.inserir("organizacoes", {
      nome: String(corpo.nome || "Meu espaço").slice(0, 80), fuso, fila_pausada: false, politica: politicaPadrao(fuso),
      politica_atraso: "aguardar", tolerancia_atraso_min: 60, exige_aprovacao: false, piloto_automatico: corpo.piloto_automatico !== false, criado_em: agora(), criado_por: usuario.id,
    });
    await banco.inserir("membros", { org_id: org.id, usuario_id: usuario.id, papel: "dono", criado_em: agora() });
    return { org };
  };

  op.ajustarOrganizacao = async (ctx, c) => {
    exigir(ctx, PAPEIS_ADMIN);
    const m = {};
    if (c.nome != null) m.nome = String(c.nome).slice(0, 80);
    if (c.fuso != null) { if (!fusoValido(c.fuso)) falha(400, "fuso_invalido", "Fuso desconhecido."); m.fuso = c.fuso; }
    if (c.politica_atraso != null) { if (!["aguardar", "publicar", "reagendar"].includes(c.politica_atraso)) falha(400, "invalido", "Política de atraso inválida."); m.politica_atraso = c.politica_atraso; }
    if (c.tolerancia_atraso_min != null) m.tolerancia_atraso_min = Math.max(0, Math.min(1440, +c.tolerancia_atraso_min || 0));
    if (c.piloto_automatico !== undefined) m.piloto_automatico = !!c.piloto_automatico;
    if (c.conta_padrao_id !== undefined) m.conta_padrao_id = c.conta_padrao_id ? (await contaPadrao(ctx, c.conta_padrao_id)).id : null;
    return { org: await banco.atualizar("organizacoes", ctx.org.id, m) };
  };

  // --- mídias
  op.criarMidia = async (ctx, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    const tipo = c.tipo;
    if (!MIMES[tipo]) falha(400, "tipo_invalido", "Tipo deve ser video ou capa.");
    if (!MIMES[tipo].includes(c.mime)) falha(400, "formato_invalido", tipo === "video" ? "Envie o vídeo em MP4 ou MOV." : "Envie a capa em JPG ou PNG.");
    const tam = +c.tamanho;
    const max = tipo === "video" ? LIM.videoBytes : LIM.capaBytes;
    if (!(tam > 0)) falha(400, "tamanho_invalido", "Arquivo vazio.");
    if (tam > max) falha(413, "arquivo_grande", `Arquivo maior que o limite atual de ${Math.round(max / 1048576)} MB do armazenamento.`);
    if (c.sha256) {
      const iguais = await banco.listar("midias", { org_id: ctx.org.id, sha256: c.sha256, tamanho: tam, estado: "pronta" });
      if (iguais.length) return { midia: iguais[0], reaproveitada: true, upload: null };
    }
    const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    const midia = await banco.inserir("midias", {
      id, org_id: ctx.org.id, tipo, nome: String(c.nome || tipo).slice(0, 200), mime: c.mime, tamanho: tam, sha256: c.sha256 || null,
      caminho: `${ctx.org.id}/${id}.${EXT[c.mime]}`, estado: "aguardando_upload", miniatura: typeof c.miniatura === "string" && c.miniatura.length < 60000 ? c.miniatura : null,
      duracao_seg: c.duracao_seg || null, largura: c.largura || null, altura: c.altura || null, criado_por: ctx.usuario.id, criado_em: agora(),
    });
    return { midia, upload: await armazenamento.criarUploadAssinado(midia.caminho) };
  };

  op.finalizarMidia = async (ctx, id) => {
    exigir(ctx, PAPEIS_EDICAO);
    const m = await banco.obter("midias", id);
    if (!m || m.org_id !== ctx.org.id) falha(404, "midia_nao_encontrada", "Mídia não encontrada.");
    if (m.estado === "pronta") return { midia: m };
    const info = await armazenamento.info(m.caminho);
    if (!info) falha(409, "upload_ausente", "O arquivo ainda não chegou ao armazenamento. Tente enviar de novo.");
    if (info.tamanho !== m.tamanho) falha(409, "upload_incompleto", `Chegaram ${info.tamanho} de ${m.tamanho} bytes. Envie de novo.`);
    return { midia: await banco.atualizar("midias", m.id, { estado: "pronta", finalizado_em: agora() }) };
  };

  op.listarMidias = async (ctx) => ({ midias: await banco.listar("midias", { org_id: ctx.org.id }, { ordem: "criado_em", desc: true, limite: 200 }) });

  // --- posts
  op.criarPost = async (ctx, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    if (!c.chave_idempotencia || String(c.chave_idempotencia).length > 100) falha(400, "falta_chave", "Envie chave_idempotencia (um identificador único por pedido).");
    const pedido = { conta_id: c.conta_id, video_id: c.video_id, capa_id: c.capa_id, legenda: c.legenda ?? "", data: c.data, hora: c.hora, proximo_livre: !!c.proximo_livre, publicar_agora: !!c.publicar_agora, agendar: !!c.agendar || !!c.publicar_agora, fonte: c.fonte, teste: !!c.teste };
    const hash = await sha256Hex(canonico(pedido));
    const existentes = await banco.listar("posts", { org_id: ctx.org.id, chave_idempotencia: c.chave_idempotencia });
    if (existentes.length) {
      if (existentes[0].hash_pedido !== hash) falha(409, "chave_reutilizada", "Esta chave de idempotência já foi usada com outro conteúdo.");
      return { post: await vistaPost(existentes[0], ctx), repetido: true };
    }
    const lg = validarLegenda(pedido.legenda);
    if (!lg.ok) falha(400, "legenda_invalida", lg.erros.join(" "));
    const video = await midiaDaOrg(ctx, c.video_id, "video");
    const capa = c.capa_id ? await midiaDaOrg(ctx, c.capa_id, "capa") : null;
    const conta = await contaPadrao(ctx, c.conta_id);
    let horario = { agendado_utc: null, origem_horario: null, fuso: ctx.org.fuso || FUSO_PADRAO };
    if (pedido.agendar) horario = await resolverHorario(ctx, pedido);
    const agoraIso = agora();
    let post;
    try {
      post = await banco.inserir("posts", {
        org_id: ctx.org.id, conta_id: conta ? conta.id : null, video_id: video.id, capa_id: capa ? capa.id : null,
        legenda: pedido.legenda, ...horario, estado: pedido.agendar ? "scheduled" : "draft", versao: 1,
        chave_idempotencia: c.chave_idempotencia, hash_pedido: hash, container_id: null, media_id: null, permalink: null,
        publicado_em: null, tentativas: 0, ultimo_erro: null, fonte: c.fonte || null, simulado: demonstracao, teste: !!c.teste, segurar: !pedido.agendar && !!c.segurar,
        criado_por: ctx.usuario.id, criado_em: agoraIso, atualizado_em: agoraIso,
      });
    } catch (e) {
      if (e instanceof ErroBanco && e.codigo === "conflito_unico") return op.criarPost(ctx, c); // corrida: lê o vencedor
      throw e;
    }
    await registrar({ post_id: post.id, org_id: post.org_id, de: null, para: post.estado, versao: 1, motivo: "criado", ator: ctx.usuario.id, criado_em: agoraIso });
    await criarJob(post);
    return { post: await vistaPost(post, ctx) };
  };

  op.editarPost = async (ctx, id, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    const post = await postDaOrg(ctx, id);
    if (c.versao !== post.versao) falha(409, "versao_desatualizada", "Esta publicação mudou em outro lugar. Recarregue.", { versao_atual: post.versao });
    if (!EDITAVEIS.includes(post.estado)) falha(409, "nao_editavel", `Não dá para editar no estado "${ESTADOS[post.estado]}".`);
    const extra = { container_id: null };
    if (c.legenda !== undefined) { const lg = validarLegenda(c.legenda); if (!lg.ok) falha(400, "legenda_invalida", lg.erros.join(" ")); extra.legenda = c.legenda; }
    if (c.capa_id !== undefined) extra.capa_id = c.capa_id ? (await midiaDaOrg(ctx, c.capa_id, "capa")).id : null;
    if (c.video_id !== undefined) extra.video_id = (await midiaDaOrg(ctx, c.video_id, "video")).id;
    if (c.fonte !== undefined) extra.fonte = c.fonte;
    if (c.conta_id !== undefined) extra.conta_id = (await contaPadrao(ctx, c.conta_id)).id;
    let para = post.estado;
    if (["failed", "retry_wait"].includes(post.estado)) para = "draft";
    if (c.data || c.hora || c.proximo_livre) {
      Object.assign(extra, await resolverHorario(ctx, c, post.id));
      if (para === "draft" && c.agendar !== false && post.estado !== "draft") para = "scheduled";
    }
    if (para === "scheduled" && Date.parse(extra.agendado_utc || post.agendado_utc) < Date.parse(agora())) falha(400, "horario_passado", "O horário desta publicação já passou: escolha um novo.");
    const novo = await aplicar(post, para, { subirVersao: true, motivo: "editado", ator: ctx.usuario.id, extra });
    await criarJob(novo);
    return { post: await vistaPost(novo, ctx) };
  };

  op.agendarPost = async (ctx, id, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    const post = await postDaOrg(ctx, id);
    if (c.versao !== undefined && c.versao !== post.versao) falha(409, "versao_desatualizada", "Recarregue: a publicação mudou.");
    if (!["draft", "awaiting_approval", "paused", "failed", "scheduled"].includes(post.estado)) falha(409, "nao_agendavel", `Não dá para agendar no estado "${ESTADOS[post.estado]}".`);
    const temNovo = c.data || c.hora || c.proximo_livre;
    let extra = { container_id: null, ultimo_erro: null, tentativas: 0 };
    if (temNovo) Object.assign(extra, await resolverHorario(ctx, c, post.id));
    else if (!post.agendado_utc || Date.parse(post.agendado_utc) < Date.parse(agora()) + LIM.antecedenciaMin * 60e3) {
      falha(400, "horario_passado", "Escolha um horário futuro.", { sugestao: proximoSlotLivre(ctx.org.politica || politicaPadrao(), await ocupados(ctx.org.id, post.id), agora()) });
    }
    const novo = await aplicar(post, "scheduled", { subirVersao: true, motivo: c.motivo || "agendado", ator: ctx.usuario.id, extra });
    await criarJob(novo);
    return { post: await vistaPost(novo, ctx) };
  };

  op.pausarPost = async (ctx, id, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    const post = await postDaOrg(ctx, id);
    if (c.versao !== undefined && c.versao !== post.versao) falha(409, "versao_desatualizada", "Recarregue: a publicação mudou.");
    if (!["scheduled", "retry_wait", "preparing", "processing"].includes(post.estado)) falha(409, "nao_pausavel", `Não dá para pausar no estado "${ESTADOS[post.estado]}".`);
    const novo = await aplicar(post, "paused", { subirVersao: true, motivo: "pausado pelo dono", ator: ctx.usuario.id });
    await criarJob(novo);
    return { post: await vistaPost(novo, ctx) };
  };

  op.retomarPost = async (ctx, id, c) => {
    const post = await postDaOrg(ctx, id);
    if (post.estado !== "paused") falha(409, "nao_pausado", "Esta publicação não está pausada.");
    return op.agendarPost(ctx, id, { ...c, motivo: "retomado" });
  };

  op.cancelarPost = async (ctx, id, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    const post = await postDaOrg(ctx, id);
    if (c.versao !== undefined && c.versao !== post.versao) falha(409, "versao_desatualizada", "Recarregue: a publicação mudou.");
    if (!CANCELAVEIS.includes(post.estado)) falha(409, "nao_cancelavel", post.estado === "publishing" ? "O pedido de publicação já foi enviado ao Instagram; aguarde a conferência." : `Não dá para cancelar no estado "${ESTADOS[post.estado]}".`);
    const novo = await aplicar(post, "cancelled", { subirVersao: true, motivo: c.motivo || "cancelado pelo dono", ator: ctx.usuario.id });
    await criarJob(novo);
    return { post: await vistaPost(novo, ctx) };
  };

  op.listarPosts = async (ctx, q) => {
    const fuso = ctx.org.fuso || FUSO_PADRAO;
    const f = { org_id: ctx.org.id };
    if (q.estado) f.estado = { in: String(q.estado).split(",") };
    if (q.conta_id) f.conta_id = q.conta_id;
    let posts;
    if (q.de || q.ate) {
      const de = q.de ? localParaUtc(q.de, "00:00", fuso) : "0000";
      const ate = q.ate ? localParaUtc(somarDias(q.ate, 1), "00:00", fuso) : "9999";
      posts = await banco.listar("posts", { ...f, agendado_utc: { gte: de, lt: ate } }, { ordem: "agendado_utc" });
      if (q.incluir_rascunhos) posts = posts.concat(await banco.listar("posts", { ...f, agendado_utc: null }, { ordem: "criado_em", desc: true }));
    } else posts = await banco.listar("posts", f, { ordem: "agendado_utc", limite: 500 });
    return { fuso, posts: await Promise.all(posts.map((p) => vistaPost(p, ctx))) };
  };

  op.obterPost = async (ctx, id) => {
    const post = await postDaOrg(ctx, id);
    const eventos = await banco.listar("eventos", { post_id: post.id }, { ordem: "criado_em" });
    return { post: await vistaPost(post, ctx), eventos: eventos.filter((e) => e.org_id === ctx.org.id) };
  };

  // --- frequência
  op.previaFrequencia = async (ctx, politica) => {
    let pol;
    try { pol = validarPolitica({ ...(ctx.org.politica || politicaPadrao(ctx.org.fuso || FUSO_PADRAO)), fuso: ctx.org.fuso || FUSO_PADRAO, ...politica }); } catch (e) { falha(400, "politica_invalida", e.message); }
    const posts = await banco.listar("posts", { org_id: ctx.org.id, estado: { in: ["scheduled", "paused", "preparing", "processing", "publishing", "retry_wait", "needs_reconciliation", "published"] } });
    const prev = preverMudanca(posts, pol, agora());
    const fuso = pol.fuso;
    const mudancas = prev.mudancas.map((m) => ({ ...m, de_local: formatarLocal(m.de, fuso, { comFuso: false }), para_local: m.para ? formatarLocal(m.para, fuso, { comFuso: false }) : null }));
    const hash = (await sha256Hex(canonico({ pol, mudancas: prev.mudancas }))).slice(0, 16);
    return { politica: pol, mudancas, afetados: prev.afetados, hash_previa: hash };
  };

  op.aplicarFrequencia = async (ctx, politica, hashPrevia) => {
    exigir(ctx, PAPEIS_ADMIN);
    const prev = await op.previaFrequencia(ctx, politica);
    if (prev.mudancas.length && prev.hash_previa !== hashPrevia) falha(409, "previa_desatualizada", "Confira a prévia antes de aplicar: ela muda publicações já programadas.", { previa: prev });
    await banco.atualizar("organizacoes", ctx.org.id, { politica: prev.politica });
    const aplicadas = [], puladas = [];
    for (const m of prev.mudancas) {
      if (!m.para) { puladas.push(m); continue; }
      const post = await banco.obter("posts", m.post_id);
      try {
        const novo = await aplicar(post, post.estado, { subirVersao: true, motivo: "frequência alterada", ator: ctx.usuario.id, extra: { agendado_utc: m.para } });
        await criarJob(novo); aplicadas.push(m);
      } catch (e) { if (e instanceof ErroApi) puladas.push({ ...m, motivo: e.message }); else throw e; }
    }
    return { politica: prev.politica, aplicadas, puladas };
  };

  op.pausarFila = async (ctx, pausar) => {
    exigir(ctx, PAPEIS_EDICAO);
    return { org: await banco.atualizar("organizacoes", ctx.org.id, { fila_pausada: pausar }) };
  };

  // --- comandos em português
  op.comando = async (ctx, c) => {
    const fuso = ctx.org.fuso || FUSO_PADRAO;
    const int = interpretar(c.texto, agora(), fuso);
    const r = (texto, extra = {}) => ({ interpretacao: int, resposta: texto, ...extra });
    if (int.falta && !(int.acao === "agendar" && int.falta === "video")) return r(int.pergunta, { pergunta: true });
    switch (int.acao) {
      case "agendar": {
        let postId = c.post_id;
        if (!postId) {
          const rasc = await banco.listar("posts", { org_id: ctx.org.id, estado: "draft", criado_por: ctx.usuario.id }, { ordem: "criado_em", desc: true, limite: 1 });
          if (!rasc.length) return r("Qual vídeo? Envie pelo botão Novo Reel (ele vira rascunho) e repita o pedido.", { pergunta: true, falta: "video" });
          postId = rasc[0].id;
        }
        const { post } = await op.agendarPost(ctx, postId, int.proximoLivre ? { proximo_livre: true } : { data: int.data, hora: int.hora });
        const rc = post.recibo;
        return r(`${rc.confirmacao === "demonstracao" ? "DEMONSTRAÇÃO — " : ""}Agendado no Jarvis para ${rc.agendado_local}${rc.perfil ? ` em ${rc.perfil}` : " (Instagram ainda não conectado)"}. Estado: ${rc.estado_texto}.`, { post });
      }
      case "listar_agenda": {
        const { posts } = await op.listarPosts(ctx, { de: int.de, ate: int.ate });
        const ativos = posts.filter((p) => p.estado !== "cancelled");
        if (!ativos.length) return r(`Nada programado de ${int.de.split("-").reverse().join("/")} a ${int.ate.split("-").reverse().join("/")}.`, { posts: [] });
        return r(ativos.map((p) => `• ${formatarLocal(p.agendado_utc, fuso, { comFuso: false })} — ${p.estado_texto}${p.permalink ? " " + p.permalink : ""} — ${(p.legenda || "").slice(0, 50)}`).join("\n") + `\n(${fuso})`, { posts: ativos });
      }
      case "frequencia": {
        const atual = ctx.org.politica || politicaPadrao(fuso);
        const horarios = int.horarios.length ? int.horarios : horariosPadrao(int.quantidade, atual.horarios);
        if (int.horarios.length && int.quantidade && int.horarios.length !== int.quantidade) return r(`Você pediu ${int.quantidade} por dia e citou ${int.horarios.length} horário(s). Quais são os ${int.quantidade} horários?`, { pergunta: true });
        const politica = { ...atual, horarios };
        const prev = await op.previaFrequencia(ctx, politica);
        if (c.confirmar) {
          const res = await op.aplicarFrequencia(ctx, politica, c.hash_previa);
          return r(`Frequência alterada: ${horarios.length} por dia, às ${horarios.join(", ")} (${fuso}). ${res.aplicadas.length} publicação(ões) remarcada(s).`, { resultado: res });
        }
        const lista = prev.mudancas.map((m) => `• ${m.de_local} → ${m.para_local || "sem horário"}`).join("\n");
        return r(`Nova frequência: ${horarios.length} por dia, às ${horarios.join(", ")} (${fuso}).${prev.mudancas.length ? `\nMuda ${prev.mudancas.length} publicação(ões) já programada(s):\n${lista}` : "\nNenhuma publicação já programada muda."}\nConfirma?`, { previa: prev, confirmar: true });
      }
      case "pausar_fila": await op.pausarFila(ctx, true); return r("Fila pausada: nada será publicado até você pedir para retomar.");
      case "retomar_fila": await op.pausarFila(ctx, false); return r("Fila retomada. Publicações cujo horário passou seguem a política de atraso (padrão: aguardar sua decisão).");
      case "listar_falhas": {
        const ps = await banco.listar("posts", { org_id: ctx.org.id, estado: { in: ["failed", "needs_reconciliation", "retry_wait"] } }, { ordem: "atualizado_em", desc: true, limite: 10 });
        if (!ps.length) return r("Nenhuma falha registrada.");
        return r(ps.map((p) => `• ${ESTADOS[p.estado]} (${p.agendado_utc ? formatarLocal(p.agendado_utc, fuso, { comFuso: false }) : "sem data"}): ${p.ultimo_erro || "sem detalhe"}`).join("\n"), { posts: ps });
      }
      case "cancelar": {
        if (!c.post_id) return r("Qual publicação? Abra-a na Agenda e toque em Cancelar.", { pergunta: true });
        const { post } = await op.cancelarPost(ctx, c.post_id, {});
        return r("Cancelada.", { post });
      }
      default: return r("Não entendi. Exemplos:\n" + AJUDA.map((a) => "• " + a).join("\n"), { ajuda: AJUDA });
    }
  };

  // --- importar por link (o que os assistentes usam, como no Metricool)
  op.importarMidia = async (ctx, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    const tipo = c.tipo === "capa" ? "capa" : "video";
    const max = tipo === "video" ? LIM.videoBytes : LIM.capaBytes;
    let arq;
    try { arq = await baixar(c.url, { fetch: buscar, maxBytes: max }); } catch (e) { if (e instanceof ErroImportar) falha(e.codigo === "arquivo_grande" ? 413 : 400, e.codigo, e.message); throw e; }
    if (!MIMES[tipo].includes(arq.mime)) falha(400, "formato_invalido", tipo === "video" ? "O link não é um vídeo MP4/MOV." : "O link não é uma imagem JPG/PNG.");
    const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", arq.bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const iguais = await banco.listar("midias", { org_id: ctx.org.id, sha256: h, tamanho: arq.bytes.length, estado: "pronta" });
    if (iguais.length) return { midia: iguais[0], reaproveitada: true };
    const id = crypto.randomUUID();
    const caminho = `${ctx.org.id}/${id}.${EXT[arq.mime]}`;
    await armazenamento.enviar(caminho, arq.bytes, arq.mime);
    const midia = await banco.inserir("midias", { id, org_id: ctx.org.id, tipo, nome: String(c.nome || "importado de link").slice(0, 200), mime: arq.mime, tamanho: arq.bytes.length, sha256: h,
      caminho, estado: "pronta", miniatura: null, origem_url: String(c.url).slice(0, 500), criado_por: ctx.usuario.id, criado_em: agora(), finalizado_em: agora() });
    return { midia };
  };
  // Um passo só: link (ou id) do vídeo + legenda + quando = Reel programado (ou publicado agora).
  op.reel = async (ctx, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    if (!c.video_id && !c.video_url) falha(400, "falta_video", "Informe video_url (link do vídeo) ou video_id (da biblioteca).");
    const quando = c.publicar_agora ? "agora" : c.proximo_livre ? "livre" : `${c.data || ""} ${c.hora || ""}`;
    const chave = c.chave_idempotencia || "reel-" + (await sha256Hex(canonico({ v: c.video_url || c.video_id, k: c.capa_url || c.capa_id, l: c.legenda || "", q: quando, conta: c.conta_id || "" }))).slice(0, 32);
    const ja = await banco.listar("posts", { org_id: ctx.org.id, chave_idempotencia: chave });
    if (ja.length) return { post: await vistaPost(ja[0], ctx), repetido: true };
    const video = c.video_id ? { id: c.video_id } : (await op.importarMidia(ctx, { url: c.video_url, tipo: "video", nome: c.nome })).midia;
    const capa = c.capa_id ? { id: c.capa_id } : c.capa_url ? (await op.importarMidia(ctx, { url: c.capa_url, tipo: "capa" })).midia : null;
    const r = await op.criarPost(ctx, { video_id: video.id, capa_id: capa ? capa.id : undefined, conta_id: c.conta_id, legenda: c.legenda || "", data: c.data, hora: c.hora,
      proximo_livre: !!c.proximo_livre, publicar_agora: !!c.publicar_agora, agendar: c.rascunho ? false : true, fonte: c.fonte, chave_idempotencia: chave });
    if (c.publicar_agora && cutucarWorker) { try { await cutucarWorker(); } catch { /* o relógio do servidor pega em 1 min */ } }
    return r;
  };

  // --- a grade de publicação: os próximos horários da frequência, livres ou ocupados
  op.grade = async (ctx, q) => {
    const fuso = ctx.org.fuso || FUSO_PADRAO;
    const dias = Math.max(1, Math.min(60, +q.dias || 14));
    const t0 = agora(), t1 = new Date(Date.parse(t0) + dias * 864e5).toISOString();
    const pol = ctx.org.politica || politicaPadrao(fuso);
    const slots = gerarSlots(pol, t0, t1);
    const posts = (await banco.listar("posts", { org_id: ctx.org.id, agendado_utc: { gte: t0, lt: t1 } }, { ordem: "agendado_utc" })).filter((p) => p.estado !== "cancelled");
    const porHora = new Map(posts.map((p) => [new Date(p.agendado_utc).toISOString(), p]));
    const resumo = (p) => p && { id: p.id, estado: p.estado, estado_texto: ESTADOS[p.estado], legenda: (p.legenda || "").slice(0, 80), conta_id: p.conta_id };
    const grade = slots.map((u) => ({ utc: u, ...utcParaLocal(u, fuso), post: resumo(porHora.get(u)) || null }));
    const foraDaGrade = posts.filter((p) => !slots.includes(new Date(p.agendado_utc).toISOString())).map((p) => ({ utc: p.agendado_utc, ...utcParaLocal(p.agendado_utc, fuso), post: resumo(p) }));
    const rascunhos = (await banco.listar("posts", { org_id: ctx.org.id, estado: "draft" })).filter((p) => !p.segurar).length;
    return { fuso, politica: pol, dias, livres: grade.filter((g) => !g.post).length, ocupados: grade.filter((g) => g.post).length, rascunhos_esperando: rascunhos, fila_pausada: !!ctx.org.fila_pausada, grade, fora_da_grade: foraDaGrade };
  };
  // Encaixa rascunhos (com vídeo) nos próximos horários livres, na ordem em que foram criados.
  op.preencherGrade = async (ctx, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    let lista = await banco.listar("posts", { org_id: ctx.org.id, estado: "draft" }, { ordem: "criado_em" });
    if (Array.isArray(c.post_ids) && c.post_ids.length) lista = c.post_ids.map((id) => lista.find((p) => p.id === id)).filter(Boolean);
    else lista = lista.filter((p) => !p.segurar); // rascunho "segurado" só entra quando pedido pelo id
    lista = lista.filter((p) => p.video_id).slice(0, Math.max(1, Math.min(50, +c.limite || 50)));
    const feitos = [], erros = [];
    for (const p of lista) {
      try { const r = await op.agendarPost(ctx, p.id, { proximo_livre: true, motivo: "grade preenchida" }); feitos.push({ post_id: p.id, agendado_local: r.post.recibo.agendado_local, perfil: r.post.recibo.perfil }); }
      catch (e) { if (e instanceof ErroApi) erros.push({ post_id: p.id, erro: e.message }); else throw e; }
    }
    return { programados: feitos, erros };
  };

  // --- chaves de integração (ChatGPT, Claude, outros clientes da API)
  op.criarChave = async (ctx, c) => {
    exigir(ctx, PAPEIS_EDICAO);
    if (ctx.usuario.via_token) falha(403, "so_sessao", "Chaves só são criadas pelo painel, com login.");
    const escopos = c.escopo === "leitura" ? ["leitura"] : ["leitura", "programar"];
    const dias = [30, 90, 365].includes(+c.dias) ? +c.dias : 90;
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const segredo = "js_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const chave = await banco.inserir("tokens_api", {
      org_id: ctx.org.id, usuario_id: ctx.usuario.id, nome: String(c.nome || "Assistente").slice(0, 60), prefixo: segredo.slice(0, 10),
      hash: await sha256Hex(segredo), escopos, criado_em: agora(), expira_em: new Date(Date.parse(agora()) + dias * 864e5).toISOString(), ultimo_uso: null, revogado: false,
    });
    const { hash, ...publica } = chave;
    return { chave: publica, segredo, aviso: "Copie agora: esta chave não aparece de novo. Quem tiver a chave programa no seu Instagram; revogue se vazar." };
  };
  op.listarChaves = async (ctx) => ({ chaves: (await banco.listar("tokens_api", { org_id: ctx.org.id }, { ordem: "criado_em", desc: true })).map(({ hash, ...x }) => x) });
  op.revogarChave = async (ctx, id) => {
    exigir(ctx, PAPEIS_EDICAO);
    const k = await banco.obter("tokens_api", id);
    if (!k || k.org_id !== ctx.org.id) falha(404, "chave", "Chave não encontrada.");
    const { hash, ...x } = await banco.atualizar("tokens_api", id, { revogado: true, revogado_em: agora() });
    return { chave: x };
  };

  // Acorda o worker na hora (teste imediato), sem esperar o relógio de 1 min.
  // No máximo uma vez a cada 15 s por espaço; o worker só faz o que já está vencido.
  const ultimoCutucao = new Map();
  op.cutucar = async (ctx) => {
    exigir(ctx, PAPEIS_EDICAO);
    if (!cutucarWorker) return { cutucado: false, motivo: "O relógio do servidor (1 min) cuida disso." };
    const t = Date.parse(agora());
    if (!demonstracao && t - (ultimoCutucao.get(ctx.org.id) || 0) < 15000) return { cutucado: false, motivo: "aguarde alguns segundos" };
    ultimoCutucao.set(ctx.org.id, t);
    const r = await cutucarWorker();
    return { cutucado: true, resultado: r };
  };

  // --- Instagram (OAuth oficial)
  op.conectarInstagram = async (ctx, corpo = {}) => {
    exigir(ctx, PAPEIS_ADMIN);
    if (demonstracao) {
      // Na demonstração a "conexão" é simulada, com o @ que o dono escolher.
      const nome = String(corpo.usuario_rede || "carlos.jr.81").replace(/^@/, "").trim().toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 30) || "carlos.jr.81";
      const ja = (await banco.listar("conexoes", { org_id: ctx.org.id })).find((c) => c.usuario_rede === nome);
      if (ja) { await banco.atualizar("conexoes", ja.id, { estado: "ativa", atualizado_em: agora() }); return { url: null, simulado: true, conexao: semSegredo(ja) }; }
      const nova = await banco.inserir("conexoes", { org_id: ctx.org.id, rede: "instagram", ig_user_id: "sim-" + nome, usuario_rede: nome, estado: "ativa", token_cifrado: null, token_expira_em: "2099-01-01T00:00:00.000Z", permissoes: [], simulado: true, atualizado_em: agora() });
      if (!ctx.org.conta_padrao_id) await banco.atualizar("organizacoes", ctx.org.id, { conta_padrao_id: nova.id });
      return { url: null, simulado: true, conexao: semSegredo(nova) };
    }
    const meta = await acesso.credenciaisMeta();
    if (!meta || !segredos.redirectUri) falha(503, "instagram_nao_configurado", "O app da Meta ainda não foi configurado: Ajustes › Instagram › Configurar o app da Meta (só o dono).");
    const estado = await banco.inserir("estados_oauth", { org_id: ctx.org.id, usuario_id: ctx.usuario.id, expira_em: new Date(Date.parse(agora()) + 10 * 60e3).toISOString(), usado: false });
    return { url: instagram.urlAutorizacao({ appId: meta.appId, redirectUri: segredos.redirectUri, estado: estado.id }) };
  };

  op.retornoInstagram = async (q) => {
    const voltar = (resultado) => ({ redirecionar: `${segredos.urlPainel || "/"}#ajustes?instagram=${encodeURIComponent(resultado)}` });
    if (q.error) return voltar("recusado");
    const est = q.state && (await banco.obter("estados_oauth", q.state));
    if (!est || est.usado || est.expira_em < agora()) return voltar("expirado");
    const marcado = await banco.atualizar("estados_oauth", est.id, { usado: true }, { usado: false });
    if (!marcado) return voltar("expirado");
    try {
      const meta = await acesso.credenciaisMeta();
      if (!meta) return voltar("erro");
      const t = await instagram.trocarCodigo({ appId: meta.appId, appSecret: meta.appSecret, redirectUri: segredos.redirectUri, codigo: q.code, agoraMs: Date.parse(agora()) });
      const perfil = await instagram.perfil({ token: t.token });
      const dados = { org_id: est.org_id, rede: "instagram", ig_user_id: String(perfil.user_id || t.igUserId), usuario_rede: perfil.username, tipo_conta: perfil.account_type || null, estado: "ativa", token_cifrado: await cifrar(t.token, segredos.chaveCifra), token_expira_em: t.expiraEm, permissoes: t.permissoes, conectado_por: est.usuario_id, atualizado_em: agora() };
      const existe = await banco.listar("conexoes", { org_id: est.org_id, ig_user_id: dados.ig_user_id });
      let salva;
      if (existe.length) salva = await banco.atualizar("conexoes", existe[0].id, dados); else salva = await banco.inserir("conexoes", dados);
      const org = await banco.obter("organizacoes", est.org_id);
      if (org && !org.conta_padrao_id) await banco.atualizar("organizacoes", org.id, { conta_padrao_id: salva.id });
      return voltar("conectado");
    } catch (e) {
      return voltar("erro");
    }
  };

  op.desconectarInstagram = async (ctx, id) => {
    exigir(ctx, PAPEIS_ADMIN);
    const c = await banco.obter("conexoes", id);
    if (!c || c.org_id !== ctx.org.id) falha(404, "conta_nao_encontrada", "Conta não encontrada.");
    if (ctx.org.conta_padrao_id === id) await banco.atualizar("organizacoes", ctx.org.id, { conta_padrao_id: null });
    return { conexao: semSegredo(await banco.atualizar("conexoes", id, { estado: "revogada", token_cifrado: null, atualizado_em: agora() })) };
  };

  // ------------------------------------------------------------ roteador HTTP
  // Uma chave de integração vira um "usuário" limitado: só o espaço dela, só os escopos dela.
  const ROTAS_DA_CHAVE = ["eu", "posts", "reels", "grade", "frequencia", "fila", "comandos", "midias", "saude"];
  async function usuarioDaChave(segredo) {
    if (!/^js_[0-9a-f]{48}$/.test(String(segredo || ""))) falha(401, "chave_invalida", "Chave de integração inválida.");
    const [k] = await banco.listar("tokens_api", { hash: await sha256Hex(segredo) });
    if (!k || k.revogado) falha(401, "chave_invalida", "Chave de integração inválida ou revogada.");
    if (k.expira_em && k.expira_em < agora()) falha(401, "chave_vencida", "Chave de integração vencida: crie outra no painel.");
    const conta = await banco.obter("contas", k.usuario_id);
    if (!k.ultimo_uso || Date.parse(agora()) - Date.parse(k.ultimo_uso) > 60e3) await banco.atualizar("tokens_api", k.id, { ultimo_uso: agora() });
    return { id: k.usuario_id, email: conta ? conta.email : "", email_confirmado: true, via_token: true, escopos: k.escopos || [], org_token: k.org_id, chave_id: k.id };
  }

  // OAuth do conector MCP (ChatGPT/Claude conectam como no Metricool): oauth.js.
  const oauth = criarOAuth({ banco, agora, base: segredos.baseMcp || "", urlPainel: segredos.urlPainel, buscar });

  async function tratar({ metodo, caminho, consulta = {}, corpo = {}, usuario = null, token = null }) {
    try {
      if (token && !usuario) usuario = await usuarioDaChave(token);
      const partes = caminho.replace(/^\/+|\/+$/g, "").split("/");
      if (partes[0] === "api") partes.shift();
      if (partes[0] !== "v1") falha(404, "rota", "Use /v1/...");
      const [, r1, r2, r3] = partes;
      const M = metodo.toUpperCase();
      const org = consulta.org_id || corpo.org_id;
      const ctx = () => contexto(usuario, org);
      let res;
      if (usuario && usuario.via_token) {
        if (!ROTAS_DA_CHAVE.includes(r1)) falha(403, "fora_do_escopo", "Esta ação só pode ser feita no painel, com login.");
        if (M !== "GET" && !(r1 === "frequencia" && r2 === "previa") && !usuario.escopos.includes("programar")) falha(403, "so_leitura", "Esta chave é só de leitura.");
        if (r1 === "midias" && M !== "GET" && r2 !== "importar") falha(403, "fora_do_escopo", "O assistente envia vídeo por link (midias/importar ou reels); upload de arquivo é pelo painel.");
      }
      const livre = r1 === "saude" || (r1 === "instagram" && r2 === "retorno") || r1 === "conta" || r1 === "admin";
      if (!livre) await acesso.exigirLiberado(usuario);
      if (r1 === "saude") res = { ok: true, modo, versao_api: VERSAO_API, agora: agora() };
      else if (r1 === "conta") res = await acesso.rotaConta(M, r2, corpo, usuario);
      else if (r1 === "admin") res = await acesso.rotaAdmin(M, partes.slice(2), corpo, consulta, usuario);
      else if (r1 === "instagram" && r2 === "retorno" && M === "GET") res = await op.retornoInstagram(consulta);
      else if (r1 === "organizacoes" && M === "POST") res = await op.criarOrganizacao(usuario, corpo);
      else if (r1 === "eu" && M === "GET") res = await op.eu(await ctx());
      else if (r1 === "organizacao" && M === "PUT") res = await op.ajustarOrganizacao(await ctx(), corpo);
      else if (r1 === "midias" && r2 === "importar" && M === "POST") res = await op.importarMidia(await ctx(), corpo);
      else if (r1 === "reels" && !r2 && M === "POST") res = await op.reel(await ctx(), corpo);
      else if (r1 === "midias" && !r2 && M === "POST") res = await op.criarMidia(await ctx(), corpo);
      else if (r1 === "midias" && !r2 && M === "GET") res = await op.listarMidias(await ctx());
      else if (r1 === "midias" && r3 === "finalizar" && M === "POST") res = await op.finalizarMidia(await ctx(), r2);
      else if (r1 === "posts" && !r2 && M === "POST") res = await op.criarPost(await ctx(), corpo);
      else if (r1 === "posts" && !r2 && M === "GET") res = await op.listarPosts(await ctx(), consulta);
      else if (r1 === "posts" && r2 && !r3 && M === "GET") res = await op.obterPost(await ctx(), r2);
      else if (r1 === "posts" && r2 && !r3 && M === "PATCH") res = await op.editarPost(await ctx(), r2, corpo);
      else if (r1 === "posts" && r3 === "agendar" && M === "POST") res = await op.agendarPost(await ctx(), r2, corpo);
      else if (r1 === "posts" && r3 === "pausar" && M === "POST") res = await op.pausarPost(await ctx(), r2, corpo);
      else if (r1 === "posts" && r3 === "retomar" && M === "POST") res = await op.retomarPost(await ctx(), r2, corpo);
      else if (r1 === "posts" && r3 === "cancelar" && M === "POST") res = await op.cancelarPost(await ctx(), r2, corpo);
      else if (r1 === "frequencia" && !r2 && M === "GET") { const c = await ctx(); res = { politica: c.org.politica || politicaPadrao(c.org.fuso) }; }
      else if (r1 === "frequencia" && r2 === "previa" && M === "POST") res = await op.previaFrequencia(await ctx(), corpo.politica || {});
      else if (r1 === "frequencia" && !r2 && M === "PUT") res = await op.aplicarFrequencia(await ctx(), corpo.politica || {}, corpo.hash_previa);
      else if (r1 === "fila" && (r2 === "pausar" || r2 === "retomar") && M === "POST") res = await op.pausarFila(await ctx(), r2 === "pausar");
      else if (r1 === "grade" && !r2 && M === "GET") res = await op.grade(await ctx(), consulta);
      else if (r1 === "grade" && r2 === "preencher" && M === "POST") res = await op.preencherGrade(await ctx(), corpo);
      else if (r1 === "chaves" && !r2 && M === "GET") res = await op.listarChaves(await ctx());
      else if (r1 === "chaves" && !r2 && M === "POST") res = await op.criarChave(await ctx(), corpo);
      else if (r1 === "chaves" && r3 === "revogar" && M === "POST") res = await op.revogarChave(await ctx(), r2);
      else if (r1 === "oauth" && r2 === "pedidos" && r3 && !partes[4] && M === "GET") res = (await ctx(), await oauth.verPedido(r3));
      else if (r1 === "oauth" && r2 === "pedidos" && r3 && partes[4] === "aprovar" && M === "POST") { const c = await ctx(); exigir(c, PAPEIS_EDICAO); res = await oauth.aprovar(c, r3, corpo); }
      else if (r1 === "oauth" && r2 === "pedidos" && r3 && partes[4] === "negar" && M === "POST") { await ctx(); res = await oauth.negar(r3); }
      else if (r1 === "worker" && r2 === "cutucar" && M === "POST") res = await op.cutucar(await ctx());
      else if (r1 === "comandos" && M === "POST") res = await op.comando(await ctx(), corpo);
      else if (r1 === "instagram" && r2 === "conectar" && M === "POST") res = await op.conectarInstagram(await ctx(), corpo);
      else if (r1 === "instagram" && r3 === "desconectar" && M === "POST") res = await op.desconectarInstagram(await ctx(), r2);
      else falha(404, "rota", `Rota desconhecida: ${M} /${partes.join("/")}`);
      if (res && res.redirecionar) return { status: 302, corpo: null, redirecionar: res.redirecionar };
      return { status: 200, corpo: res };
    } catch (e) {
      if (e instanceof ErroOAuth) return { status: e.status, corpo: { erro: e.erro, mensagem: e.message } };
      if (e instanceof ErroAcesso) return { status: e.status, corpo: { erro: e.codigo, mensagem: e.message, ...e.extra } };
      if (e instanceof ErroApi) return { status: e.status, corpo: { erro: e.codigo, mensagem: e.message, ...e.extra } };
      if (e instanceof ErroEstado) return { status: 409, corpo: { erro: e.codigo, mensagem: e.message } };
      if (e && e.codigo === "politica_invalida") return { status: 400, corpo: { erro: e.codigo, mensagem: e.message } };
      return { status: 500, corpo: { erro: "interno", mensagem: "Erro interno. Tente de novo; se repetir, veja o registro do servidor." }, excecao: e };
    }
  }

  return { tratar, op, acesso, oauth };
}
