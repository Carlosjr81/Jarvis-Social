// Jarvis Social — painel para celular (sem etapa de build).
// Dois modos, sempre rotulados na tela:
//  - SERVIDOR: config.js preenchido; tudo vai para a API no Supabase.
//  - DEMONSTRAÇÃO: a MESMA API roda dentro do navegador, com banco local e
//    Instagram simulado. Nada sai do aparelho e nada é publicado.
import { CONFIG } from "./config.js";
import { criarApi } from "./supabase/functions/_compartilhado/api.js";
import { BancoMemoria } from "./supabase/functions/_compartilhado/banco.js";
import { ArmazenamentoMemoria } from "./supabase/functions/_compartilhado/armazenamento.js";
import { criarInstagramSimulado } from "./supabase/functions/_compartilhado/instagram.js";
import { criarWorker } from "./supabase/functions/_compartilhado/worker.js";
import { ESTADOS } from "./supabase/functions/_compartilhado/estados.js";
import { formatarLocal, partesLocais, somarDias, NOMES_DIA_LONGO, FUSO_PADRAO } from "./supabase/functions/_compartilhado/tempo.js";
import { AJUDA } from "./supabase/functions/_compartilhado/comandos.js";
import { sugerirEmail, PRAZOS_ACESSO, NOMES_SITUACAO } from "./supabase/functions/_compartilhado/acesso.js";

export const VERSAO_PAINEL = "2026-11-22i";
const CH = { sessao: "jarvis-social:sessao", demo: "jarvis-social:demo", modo: "jarvis-social:modo", rascunho: "jarvis-social:rascunho", email: "jarvis-social:email" };
const ls = {
  ler(k, padrao = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento local */ } },
  apagar(k) { try { localStorage.removeItem(k); } catch {} },
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const novaChave = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// ------------------------------------------------------------------ cliente
const servidorConfigurado = !!(CONFIG.supabaseUrl && CONFIG.supabaseAnon);
let modo = servidorConfigurado && ls.ler(CH.modo) !== "demonstracao" ? "servidor" : "demonstracao";

function clienteDemonstracao() {
  const banco = new BancoMemoria(ls.ler(CH.demo, {}), (t) => ls.gravar(CH.demo, t));
  // A conta simulada das primeiras versões passa a ser a do dono.
  for (const c of banco._tab("conexoes")) if (c.usuario_rede === "conta_simulada") Object.assign(c, { usuario_rede: "carlos.jr.81", ig_user_id: "sim-carlos.jr.81" });
  const arm = new ArmazenamentoMemoria();
  for (const m of banco._tab("midias")) arm.receber(m.caminho, m.tamanho, m.mime);
  const ig = criarInstagramSimulado();
  // Na demonstração o worker roda aqui mesmo, com esperas curtas (2 s) para o teste imediato andar rápido.
  const rodarWorkerLocal = () => criarWorker({ banco, armazenamento: arm, instagram: ig, dono: "demo-" + Date.now(), segredos: { emailsDono: ["demonstracao@local"] }, esperaStatusSeg: 2 }).rodar();
  const api = criarApi({ banco, armazenamento: arm, instagram: ig, modo: "demonstracao", segredos: { urlPainel: location.href.split("#")[0], emailsDono: ["demonstracao@local"] },
    cutucarWorker: async () => { const r = await rodarWorkerLocal(); return { reivindicados: r.reivindicados, resultados: r.resultados.map((x) => x.resultado) }; } });
  // Na demonstração você é o dono: dá para ver o painel de usuários e simular cadastros.
  const usuario = { id: "demo", email: "demonstracao@local", email_confirmado: true, nome: "Carlos Jr." };
  return {
    modo: "demonstracao", usuario: () => usuario,
    async chamar(metodo, caminho, corpo, consulta) {
      const r = await api.tratar({ metodo, caminho, corpo: corpo || {}, consulta: consulta || {}, usuario });
      if (r.excecao) console.error(r.excecao);
      if (r.status >= 400) throw Object.assign(new Error(r.corpo.mensagem), r.corpo, { status: r.status });
      return r.corpo;
    },
    async enviarArquivo(upload, arquivo, aoProgredir, midia) {
      for (let p = 0; p <= 100; p += 25) { aoProgredir(p / 100); await new Promise((r) => setTimeout(r, 60)); }
      arm.receber(midia.caminho, arquivo.size, arquivo.type);
    },
    async rodarWorker() { return criarWorker({ banco, armazenamento: arm, instagram: ig, dono: "demo-" + Date.now(), segredos: { emailsDono: ["demonstracao@local"] } }).rodar(); },
    sair() { ls.apagar(CH.demo); },
  };
}

function clienteServidor() {
  const base = CONFIG.supabaseUrl.replace(/\/$/, "");
  let sessao = ls.ler(CH.sessao);
  async function auth(caminho, corpo) {
    const r = await fetch(`${base}/auth/v1/${caminho}`, { method: "POST", headers: { apikey: CONFIG.supabaseAnon, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "Não deu para entrar.");
    return j;
  }
  function guardar(j) { sessao = { access_token: j.access_token, refresh_token: j.refresh_token, expira: Date.now() + (j.expires_in || 3600) * 1000, email: j.user && j.user.email }; ls.gravar(CH.sessao, sessao); }
  async function token() {
    if (!sessao) return null;
    if (Date.now() > sessao.expira - 60e3) {
      try { guardar(await auth("token?grant_type=refresh_token", { refresh_token: sessao.refresh_token })); }
      catch { sessao = null; ls.apagar(CH.sessao); return null; }
    }
    return sessao.access_token;
  }
  return {
    modo: "servidor",
    usuario: () => sessao && { email: sessao.email },
    async entrar(email, senha) { guardar(await auth("token?grant_type=password", { email, password: senha })); },
    async cadastrar(email, senha, nome) { const j = await auth("signup", { email, password: senha, data: { nome } }); if (j.access_token) guardar(j); return j; },
    async esqueci(email) { await auth("recover", { email }); },
    async chamar(metodo, caminho, corpo, consulta) {
      const t = await token();
      const q = consulta ? "?" + new URLSearchParams(Object.entries(consulta).filter(([, v]) => v != null)).toString() : "";
      let r;
      try {
        r = await fetch(`${base}/functions/v1/api${caminho}${q}`, { method: metodo, headers: { apikey: CONFIG.supabaseAnon, "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: corpo && metodo !== "GET" ? JSON.stringify(corpo) : undefined, cache: "no-store" });
      } catch { throw Object.assign(new Error("Sem conexão com o servidor. Nada foi confirmado; tente de novo."), { erro: "rede" }); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.mensagem || `Erro ${r.status}`), j, { status: r.status });
      return j;
    },
    enviarArquivo(upload, arquivo, aoProgredir) {
      return new Promise((ok, falha) => {
        const x = new XMLHttpRequest();
        x.open(upload.metodo || "PUT", upload.url);
        x.setRequestHeader("Content-Type", arquivo.type);
        x.setRequestHeader("x-upsert", "true");
        x.upload.onprogress = (e) => e.lengthComputable && aoProgredir(e.loaded / e.total);
        x.onload = () => (x.status < 300 ? ok() : falha(new Error(`Envio recusado (${x.status}).`)));
        x.onerror = () => falha(new Error("A conexão caiu durante o envio."));
        x.send(arquivo);
      });
    },
    sair() { sessao = null; ls.apagar(CH.sessao); },
  };
}

let cli = modo === "servidor" ? clienteServidor() : clienteDemonstracao();
let eu = null;

// ------------------------------------------------------------------ rascunho (texto no localStorage, arquivos no IndexedDB)
const idb = {
  abrir: () => new Promise((ok, falha) => { const r = indexedDB.open("jarvis-social", 1); r.onupgradeneeded = () => r.result.createObjectStore("arquivos"); r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); }),
  async gravar(k, v) { try { const db = await idb.abrir(); await new Promise((ok) => { const t = db.transaction("arquivos", "readwrite"); t.objectStore("arquivos").put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch {} },
  async ler(k) { try { const db = await idb.abrir(); return await new Promise((ok) => { const r = db.transaction("arquivos").objectStore("arquivos").get(k); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch { return null; } },
  async apagar(k) { try { const db = await idb.abrir(); db.transaction("arquivos", "readwrite").objectStore("arquivos").delete(k); } catch {} },
};
function rascunhoNovo() { return { chave: novaChave(), passo: 0, legenda: "", data: "", hora: "", proximoLivre: false, videoMidia: null, capaMidia: null, enviando: false, postId: null, fonte: { autor: "", url: "" } }; }
let R = ls.ler(CH.rascunho) || rascunhoNovo();
let arquivos = { video: null, capa: null };
const salvarR = () => ls.gravar(CH.rascunho, R);

// ------------------------------------------------------------------ utilidades de tela
const fuso = () => (eu && eu.org && eu.org.fuso) || FUSO_PADRAO;
function faixaModo() {
  return cli.modo === "demonstracao"
    ? `<div class="faixa demo" role="status">DEMONSTRAÇÃO — tudo fica neste aparelho; nada é enviado ao Instagram. ${servidorConfigurado ? "" : "O servidor ainda não foi configurado."}</div>`
    : "";
}
function selo(p) { return `<span class="selo ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span>`; }
function confirmacaoTexto(rc) {
  return { demonstracao: "Demonstração (simulado)", agendamento_confirmado_no_jarvis: "Agendamento confirmado no servidor do Jarvis", publicacao_concluida: "Publicação concluída no Instagram", nao_confirmado: "Ainda não confirmado" }[rc.confirmacao] || rc.confirmacao;
}
function mensagemErro(e) { return esc(e && e.message ? e.message : String(e)); }
function abrirFolha(html) { $("#folha-conteudo").innerHTML = html; $("#folha").classList.remove("oculto"); const f = $("#folha-conteudo input, #folha-conteudo textarea, #folha-conteudo button"); f && f.focus(); }
function fecharFolha() { $("#folha").classList.add("oculto"); $("#folha-conteudo").innerHTML = ""; }
$("#folha").addEventListener("click", (e) => { if (e.target.id === "folha") fecharFolha(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharFolha(); });

function cartaoPost(p, { acoes = true } = {}) {
  const hora = p.agendado_utc ? formatarLocal(p.agendado_utc, p.fuso || fuso(), { comFuso: false }) : "sem data";
  const pode = (lista) => lista.includes(p.estado);
  return `<div class="cartao item" data-post="${esc(p.id)}">
    ${p._mini ? `<img class="miniatura" alt="" src="${esc(p._mini)}">` : `<div class="miniatura" aria-hidden="true"></div>`}
    <div class="texto">
      <p><strong>${esc(hora)}</strong> ${selo(p)}</p>
      ${p.recibo && p.recibo.perfil && contasUsaveis().length > 1 ? `<p class="fraco">${esc(p.recibo.perfil)}</p>` : ""}
      <p>${esc((p.legenda || "(sem legenda)").slice(0, 120))}</p>
      ${p.permalink ? (p.recibo && p.recibo.confirmacao === "demonstracao" ? `<p class="fraco">Publicação simulada (sem link real)</p>` : `<p><a href="${esc(p.permalink)}" target="_blank" rel="noopener">Ver no Instagram</a></p>`) : ""}
      ${p.ultimo_erro ? `<p class="fraco">Motivo: ${esc(p.ultimo_erro)}</p>` : ""}
      ${acoes ? `<div class="linha">
        <button data-acao="detalhe">Detalhes</button>
        ${pode(["draft", "scheduled", "paused", "failed", "retry_wait", "awaiting_approval"]) ? `<button data-acao="editar">Editar</button>` : ""}
        ${pode(["scheduled", "retry_wait", "processing", "preparing"]) ? `<button data-acao="pausar">Pausar</button>` : ""}
        ${pode(["paused"]) ? `<button data-acao="retomar">Retomar</button>` : ""}
        ${pode(["draft", "scheduled", "paused", "failed", "retry_wait", "awaiting_approval", "processing", "preparing", "needs_reconciliation"]) ? `<button class="perigo" data-acao="cancelar">Cancelar</button>` : ""}
      </div>` : ""}
    </div></div>`;
}

async function comMiniaturas(posts) {
  let midias = [];
  try { midias = (await cli.chamar("GET", "/v1/midias")).midias; } catch {}
  const mapa = new Map(midias.map((m) => [m.id, m.miniatura]));
  return posts.map((p) => ({ ...p, _mini: mapa.get(p.capa_id) || mapa.get(p.video_id) || null }));
}

// ------------------------------------------------------------------ ações nos posts (delegação)
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const card = b.closest("[data-post]");
  const id = card && card.dataset.post;
  const acao = b.dataset.acao;
  try {
    if (acao === "detalhe") { location.hash = "#post/" + id; return; }
    if (!id) return;
    const { post } = await cli.chamar("GET", `/v1/posts/${id}`);
    if (acao === "editar") return editarPost(post);
    if (acao === "cancelar" && !confirm("Cancelar esta publicação? Ela não será enviada.")) return;
    b.disabled = true;
    await cli.chamar("POST", `/v1/posts/${id}/${acao}`, { versao: post.versao });
    await mostrar();
  } catch (err) {
    if (err.erro === "horario_passado" && acao === "retomar") { const { post } = await cli.chamar("GET", `/v1/posts/${id}`); return editarPost(post, "O horário original já passou: escolha um novo."); }
    alert(err.message);
    b.disabled = false;
  }
});

function editarPost(post, aviso = "") {
  const l = post.agendado_utc ? partesLocais(post.agendado_utc, post.fuso || fuso()) : null;
  abrirFolha(`<h2>Editar publicação</h2>${aviso ? `<div class="faixa erro">${esc(aviso)}</div>` : ""}
    <label for="ed-leg">Legenda</label><textarea id="ed-leg" maxlength="2200">${esc(post.legenda)}</textarea>
    <div class="linha"><div style="flex:1"><label for="ed-data">Data</label><input id="ed-data" type="date" value="${l ? l.data : ""}"></div>
    <div style="flex:1"><label for="ed-hora">Horário</label><input id="ed-hora" type="time" value="${l ? l.horaTexto : ""}"></div></div>
    <p class="fraco">Fuso: ${esc(post.fuso || fuso())}</p>
    ${seletorConta("ed-conta", post.conta_id)}
    <div id="ed-msg"></div>
    <div class="linha"><button id="ed-cancelar">Fechar</button><button class="primario" id="ed-salvar">Salvar</button></div>`);
  $("#ed-cancelar").onclick = fecharFolha;
  $("#ed-salvar").onclick = async () => {
    const corpo = { versao: post.versao, legenda: $("#ed-leg").value };
    if ($("#ed-conta") && $("#ed-conta").value !== post.conta_id) corpo.conta_id = $("#ed-conta").value;
    const d = $("#ed-data").value, h = $("#ed-hora").value;
    if (d && h && (!l || d !== l.data || h !== l.horaTexto || post.estado === "paused")) { corpo.data = d; corpo.hora = h; }
    try {
      $("#ed-salvar").disabled = true;
      let r = await cli.chamar("PATCH", `/v1/posts/${post.id}`, corpo);
      if (r.post.estado === "paused" && corpo.data) r = await cli.chamar("POST", `/v1/posts/${post.id}/retomar`, { versao: r.post.versao });
      fecharFolha(); await mostrar();
    } catch (err) { $("#ed-msg").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; $("#ed-salvar").disabled = false; }
  };
}

// Contas do Instagram do espaço (para escolher onde publicar).
const contasUsaveis = () => (eu ? eu.conexoes.filter((c) => c.estado !== "revogada") : []);
const contaPadraoId = () => { const cs = contasUsaveis(); return (cs.find((c) => c.id === eu.org.conta_padrao_id) || cs.find((c) => c.estado === "ativa") || cs[0] || {}).id || ""; };
function seletorConta(id, atual) {
  const cs = contasUsaveis();
  if (!cs.length) return `<p class="fraco">Nenhuma conta do Instagram conectada. <a href="#ajustes">Conectar</a></p>`;
  return `<label for="${id}">Publicar em</label><select id="${id}">${cs.map((c) => `<option value="${esc(c.id)}" ${c.id === (atual || contaPadraoId()) ? "selected" : ""}>@${esc(c.usuario_rede)}${c.estado === "reconectar" ? " (reconectar)" : ""}${c.simulado ? " (simulada)" : ""}</option>`).join("")}</select>`;
}

// ------------------------------------------------------------------ telas
const telas = {};

// ------------------------------------------------------------------ porteiro (entrada, termos, espera, planos)
let contaEstado = null;
const pararEspera = { t: null };
// A cena da entrada: pôr do sol neon, palmeiras e chão em grade (só CSS e SVG).
const CENA_NEON = `<div class="cena" aria-hidden="true"><div class="titulo">JARVIS SOCIAL</div><div class="sol"></div><div class="chao"><svg viewBox="0 0 400 78" preserveAspectRatio="none"><g stroke="#FF4F8B" stroke-opacity=".75" stroke-width="1.5"><line x1="200" y1="0" x2="-400" y2="78"/><line x1="200" y1="0" x2="-340" y2="78"/><line x1="200" y1="0" x2="-280" y2="78"/><line x1="200" y1="0" x2="-220" y2="78"/><line x1="200" y1="0" x2="-160" y2="78"/><line x1="200" y1="0" x2="-100" y2="78"/><line x1="200" y1="0" x2="-40" y2="78"/><line x1="200" y1="0" x2="20" y2="78"/><line x1="200" y1="0" x2="80" y2="78"/><line x1="200" y1="0" x2="140" y2="78"/><line x1="200" y1="0" x2="200" y2="78"/><line x1="200" y1="0" x2="260" y2="78"/><line x1="200" y1="0" x2="320" y2="78"/><line x1="200" y1="0" x2="380" y2="78"/><line x1="200" y1="0" x2="440" y2="78"/><line x1="200" y1="0" x2="500" y2="78"/><line x1="200" y1="0" x2="560" y2="78"/><line x1="200" y1="0" x2="620" y2="78"/><line x1="200" y1="0" x2="680" y2="78"/><line x1="200" y1="0" x2="740" y2="78"/><line x1="200" y1="0" x2="800" y2="78"/></g><g stroke="#25F4EE" stroke-opacity=".8" stroke-width="1.5"><line x1="0" y1="2" x2="400" y2="2"/><line x1="0" y1="7" x2="400" y2="7"/><line x1="0" y1="17" x2="400" y2="17"/><line x1="0" y1="32" x2="400" y2="32"/><line x1="0" y1="52" x2="400" y2="52"/><line x1="0" y1="78" x2="400" y2="78"/></g></svg></div><svg class="palma e" viewBox="0 0 90 150" aria-hidden="true"><path d="M44 150 C46 110 47 80 50 52 L54 52 C52 82 51 112 52 150 Z"/><path d="M52 52 C30 30 10 36 0 52 C18 40 34 42 52 56 Z M52 52 C40 22 20 10 6 14 C26 20 40 34 50 58 Z M52 52 C62 22 80 14 90 20 C72 24 60 38 54 58 Z M52 52 C76 38 88 46 90 60 C78 48 64 48 54 56 Z M52 52 C50 26 56 6 66 0 C60 14 58 34 55 54 Z"/></svg><svg class="palma d" viewBox="0 0 90 150" aria-hidden="true"><path d="M44 150 C46 110 47 80 50 52 L54 52 C52 82 51 112 52 150 Z"/><path d="M52 52 C30 30 10 36 0 52 C18 40 34 42 52 56 Z M52 52 C40 22 20 10 6 14 C26 20 40 34 50 58 Z M52 52 C62 22 80 14 90 20 C72 24 60 38 54 58 Z M52 52 C76 38 88 46 90 60 C78 48 64 48 54 56 Z M52 52 C50 26 56 6 66 0 C60 14 58 34 55 54 Z"/></svg></div>`;
const topo = (mostrar) => { const t = document.getElementById("topo"); if (t) t.classList.toggle("oculto", !mostrar); };
function msgEm(seletor, texto, tipo = "erro") { const el = $(seletor); if (el) el.innerHTML = texto ? `<div class="faixa ${tipo}">${esc(texto)}</div>` : ""; }

telas.entrar = async (el, modoTela = ls.ler(CH.email) ? "entrar" : "criar") => {
  const criar = modoTela === "criar";
  topo(false);
  el.innerHTML = `${CENA_NEON}
    <p style="text-align:center;font-weight:700">Agende e publique seus Reels pelo celular.</p>
    <div class="chips" role="tablist"><button class="chip ${criar ? "ativo" : ""}" id="aba-criar">Criar conta</button><button class="chip ${!criar ? "ativo" : ""}" id="aba-entrar">Entrar</button></div>
    <div class="cartao"><form id="f-entrar" novalidate>
      ${criar ? `<label for="nome">Seu nome</label><input id="nome" autocomplete="name" required>` : ""}
      <label for="email">E-mail</label><input id="email" type="email" autocomplete="email" inputmode="email" value="${esc(ls.ler(CH.email) || "")}" required>
      <div id="sugestao"></div>
      <label for="senha">Senha ${criar ? "(mínimo 8)" : ""}</label>
      <div class="linha"><input id="senha" type="password" autocomplete="${criar ? "new-password" : "current-password"}" minlength="8" required style="flex:1"><button type="button" id="mostrar" style="flex:0 0 auto">Mostrar</button></div>
      <div id="msg"></div>
      <button class="primario grande" type="submit" style="margin-top:12px">${criar ? "Criar minha conta" : "Entrar"}</button>
      ${!criar ? `<button type="button" id="esqueci" style="margin-top:8px;width:100%">Esqueci a senha</button>` : `<p class="fraco">Depois do cadastro, o acesso é liberado pelo administrador.</p>`}
    </form></div>
    <div class="cartao"><p>Quer só conhecer as telas?</p><button id="b-demo">Abrir demonstração (nada é publicado)</button></div>`;
  $("#aba-criar").onclick = () => telas.entrar(el, "criar");
  $("#aba-entrar").onclick = () => telas.entrar(el, "entrar");
  $("#mostrar").onclick = () => { const i = $("#senha"); i.type = i.type === "password" ? "text" : "password"; $("#mostrar").textContent = i.type === "password" ? "Mostrar" : "Ocultar"; };
  $("#email").oninput = () => { const sug = sugerirEmail($("#email").value); $("#sugestao").innerHTML = sug ? `<button type="button" class="chip" id="usar-sug">Você quis dizer ${esc(sug)}?</button>` : ""; if (sug) $("#usar-sug").onclick = () => { $("#email").value = sug; $("#sugestao").innerHTML = ""; }; };
  $("#esqueci") && ($("#esqueci").onclick = async () => {
    const email = $("#email").value.trim(); if (!email) return msgEm("#msg", "Digite o e-mail primeiro.");
    try { await cli.esqueci(email); msgEm("#msg", `Se ${email} tiver conta, o link para criar uma senha nova chegou no e-mail.`, "ok"); } catch (err) { msgEm("#msg", err.message); }
  });
  $("#f-entrar").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim().toLowerCase(), senha = $("#senha").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msgEm("#msg", "E-mail inválido.");
    if (senha.length < 8) return msgEm("#msg", "A senha precisa de pelo menos 8 caracteres.");
    try {
      ls.gravar(CH.email, email);
      if (criar) {
        const nome = $("#nome").value.trim(); if (!nome) return msgEm("#msg", "Diga o seu nome.");
        const j = await cli.cadastrar(email, senha, nome);
        if (!j.access_token) return msgEm("#msg", `Pronto, ${nome}! Confirme o cadastro pelo link enviado para ${email} e depois toque em Entrar.`, "ok");
      } else await cli.entrar(email, senha);
      await iniciar();
    } catch (err) {
      const m = String(err.message || "");
      if (criar && /registered|already/i.test(m)) { telas.entrar(el, "entrar"); return msgEm("#msg", "Este e-mail já tem conta. Entre com a senha."); }
      if (/confirm/i.test(m)) return msgEm("#msg", "Confirme o e-mail pelo link que enviamos e tente de novo.");
      msgEm("#msg", /invalid/i.test(m) ? "E-mail ou senha não conferem." : m);
    }
  };
  $("#b-demo").onclick = () => { ls.gravar(CH.modo, "demonstracao"); location.reload(); };
};

function telaSair() { return `<button id="sair-porteiro" style="width:100%;margin-top:12px">Sair</button>`; }
function ligarSair() { $("#sair-porteiro") && ($("#sair-porteiro").onclick = () => { cli.sair(); location.reload(); }); }

telas.termos = async (el, est) => {
  const T = est.termos.texto;
  el.innerHTML = `<h1>${esc(T.titulo)}</h1>${cli.modo === "demonstracao" ? faixaModo() : ""}
    <div class="cartao"><h3>O combinado em 1 minuto</h3><ul>${T.resumo.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <details><summary>Ler os termos completos</summary>${T.secoes.map(([t, x]) => `<h3>${esc(t)}</h3><p>${esc(x)}</p>`).join("")}<p class="fraco">Versão ${esc(T.versao)}</p></details></div>
    <div class="cartao">${T.caixas.map((c, i) => `<label style="display:flex;gap:10px;font-weight:500"><input type="checkbox" data-caixa="${i}">${esc(c)}</label>`).join("")}
    <div id="msg"></div><button class="primario grande" id="aceitar" style="margin-top:12px">Aceito</button>${telaSair()}</div>`;
  ligarSair();
  $("#aceitar").onclick = async () => {
    const caixas = [...el.querySelectorAll("[data-caixa]")].map((c) => c.checked);
    if (!caixas.every(Boolean)) return msgEm("#msg", "Marque as caixas para continuar.");
    try { await cli.chamar("POST", "/v1/conta/termos", { versao: T.versao, caixas, navegador: navigator.userAgent }); await iniciar(); } catch (err) { msgEm("#msg", err.message); }
  };
};

telas.aguardando = async (el, est) => {
  el.innerHTML = `<h1>Pronto${est.conta.nome ? ", " + esc(est.conta.nome.split(" ")[0]) : ""}!</h1>
    <div class="cartao"><p>Seu cadastro foi recebido e está <strong>aguardando a liberação</strong> do administrador.</p>
    <p class="fraco">Esta tela confere sozinha a cada 30 segundos: quando liberar, o painel abre.</p>
    ${est.aviso_dono ? `<div class="faixa">${esc(est.aviso_dono)}</div>` : ""}
    <p>Enquanto isso, siga <a href="https://www.instagram.com/carlos.jr.81/" target="_blank" rel="noopener">@carlos.jr.81</a>.</p>${telaSair()}</div>`;
  ligarSair();
  clearTimeout(pararEspera.t); pararEspera.t = setTimeout(iniciar, 30000);
};

telas.bloqueado = async (el, est) => {
  el.innerHTML = `<h1>Acesso bloqueado</h1><div class="cartao"><p>Seu acesso ao Jarvis Social está bloqueado.</p>
    ${est.conta.motivo ? `<p><strong>Motivo:</strong> ${esc(est.conta.motivo)}</p>` : ""}<p class="fraco">Fale com @carlos.jr.81 no Instagram.</p>${telaSair()}</div>`;
  ligarSair();
};

telas.vencido = async (el, est) => {
  el.innerHTML = `<h1>Seu acesso venceu</h1><div class="cartao"><p>O prazo do seu acesso terminou em ${esc(new Date(est.conta.ate).toLocaleDateString("pt-BR"))}.</p>
    <p class="fraco">Peça a renovação a @carlos.jr.81. Suas publicações agendadas esperam a liberação; nada é apagado.</p>${telaSair()}</div>`;
  ligarSair();
  clearTimeout(pararEspera.t); pararEspera.t = setTimeout(iniciar, 60000);
};

const reais = (v) => "R$ " + (+v || 0).toFixed(2).replace(".", ",");
telas.planos = async (el, est, { dentro = false } = {}) => {
  const cob = est.cobranca;
  let meus = [];
  try { meus = (await cli.chamar("GET", "/v1/conta/pagamentos")).pagamentos; } catch {}
  el.innerHTML = `${dentro ? faixaModo() : ""}<h1>${est.situacao === "pagar" ? "Escolha um plano" : "Planos e pagamentos"}</h1>
    <div class="cartao"><p><strong>Seu plano:</strong> ${esc(est.plano.texto)}</p>
    ${est.situacao === "pagar" ? `<p>O período de teste terminou. Escolha um plano para continuar; suas publicações agendadas esperam.</p>` : ""}</div>
    ${cob.ligada ? cob.planos.map((p) => `<div class="cartao"><h3>${esc(p.nome)} — ${reais(p.preco)}</h3><p class="fraco">${p.dias ? p.dias + " dias de acesso" : "Acesso sem prazo"}</p>
      <button class="primario" data-plano="${esc(p.id)}" style="width:100%">Quero este</button></div>`).join("") : `<p class="fraco">Não há cobrança ativa agora.</p>`}
    <div id="pix"></div>
    ${meus.length ? `<div class="cartao"><h3>Meus pagamentos</h3>${meus.map((p) => `<p>${esc(new Date(p.criado_em).toLocaleDateString("pt-BR"))} · ${esc(p.plano)} · ${reais(p.valor)} · <strong>${esc({ informado: "aguardando confirmação", confirmado: "confirmado", recusado: "recusado", devolvido: "devolvido" }[p.status])}</strong>${p.motivo ? " · " + esc(p.motivo) : ""}<br><small>código ${esc(p.txid)}</small></p>`).join("")}</div>` : ""}
    ${dentro ? "" : telaSair()}`;
  ligarSair();
  el.querySelectorAll("[data-plano]").forEach((b) => (b.onclick = () => {
    const p = cob.planos.find((x) => x.id === b.dataset.plano);
    $("#pix").innerHTML = `<div class="cartao"><h3>${esc(p.nome)} — ${reais(p.preco)}</h3><p class="fraco">${esc(cob.condicoes)}</p>
      <label style="display:flex;gap:10px;font-weight:500"><input type="checkbox" id="cond">Li e aceito as condições do plano.</label>
      <div id="msg"></div><button class="primario grande" id="gerar">Gerar o Pix</button></div>`;
    $("#pix").scrollIntoView({ behavior: "smooth" });
    $("#gerar").onclick = async () => {
      if (!$("#cond").checked) return msgEm("#msg", "Aceite as condições.");
      try {
        const r = await cli.chamar("POST", "/v1/conta/pagamentos", { plano: p.id, condicoes: true });
        $("#pix").innerHTML = `<div class="cartao"><h3>Pague pelo Pix</h3>
          ${r.pix ? `<p>Copie o código e cole no app do seu banco (Pix › Copia e cola):</p><textarea readonly id="codigo-pix" style="min-height:110px">${esc(r.pix)}</textarea>
          <button class="primario" id="copiar" style="width:100%">Copiar o código Pix</button>` : ""}
          ${r.link ? `<p><a class="botao" href="${esc(r.link)}" target="_blank" rel="noopener">Pagar pelo link</a></p>` : ""}
          ${!r.pix && !r.link ? `<div class="faixa erro">O administrador ainda não cadastrou a chave Pix. Fale com @carlos.jr.81.</div>` : ""}
          <p class="fraco">Código do pagamento: <strong>${esc(r.pagamento.txid)}</strong>. Depois de pagar, o administrador confere no extrato e libera; esta tela confere sozinha.</p></div>`;
        $("#copiar") && ($("#copiar").onclick = async () => { try { await navigator.clipboard.writeText(r.pix); $("#copiar").textContent = "Copiado!"; } catch { $("#codigo-pix").select(); } });
        clearTimeout(pararEspera.t); if (!dentro) pararEspera.t = setTimeout(iniciar, 30000);
      } catch (err) { msgEm("#msg", err.message); }
    };
  }));
  if (!dentro && est.situacao === "pagar") { clearTimeout(pararEspera.t); pararEspera.t = setTimeout(iniciar, 30000); }
};

function mostrarRecado(est) {
  if (!est.recado) return;
  abrirFolha(`<h2>Recado do administrador</h2><p style="white-space:pre-wrap">${esc(est.recado.texto)}</p><button class="primario grande" id="recado-ok">Entendi</button>`);
  $("#recado-ok").onclick = async () => { fecharFolha(); try { await cli.chamar("POST", "/v1/conta/recado-visto"); } catch {} };
}

telas.novoEspaco = async (el) => {
  el.innerHTML = `<h1>Seu espaço</h1><div class="cartao"><form id="f-org">
    <label for="nome">Nome do espaço</label><input id="nome" value="carlos.jr.81" required>
    <label for="fz">Fuso</label><input id="fz" value="${FUSO_PADRAO}" required>
    <div id="msg"></div><button class="primario grande" style="margin-top:12px">Criar espaço</button></form></div>`;
  $("#f-org").onsubmit = async (e) => { e.preventDefault(); try { await cli.chamar("POST", "/v1/organizacoes", { nome: $("#nome").value, fuso: $("#fz").value }); await iniciar(); } catch (err) { $("#msg").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; } };
};

telas.inicio = async (el) => {
  const hoje = partesLocais(new Date(), fuso()).data;
  const { posts } = await cli.chamar("GET", "/v1/posts", null, { de: hoje, ate: somarDias(hoje, 6) });
  const proximos = await comMiniaturas(posts.filter((p) => !["cancelled"].includes(p.estado)).slice(0, 5));
  const ad = contaEstado && contaEstado.avisos_dono;
  el.innerHTML = `${faixaModo()}<h1>Início</h1>
    ${ad && ad.aguardando ? `<a class="faixa" href="#usuarios" style="display:block">${ad.aguardando} cadastro(s) esperando a sua liberação ▶</a>` : ""}
    ${ad && ad.pagamentos ? `<a class="faixa" href="#usuarios" style="display:block">${ad.pagamentos} pagamento(s) para confirmar ▶</a>` : ""}
    ${contaEstado && contaEstado.plano.tipo === "teste" ? `<a class="faixa" href="#planos" style="display:block">Período de teste ${esc(contaEstado.plano.texto.replace("Em teste", "").trim())}. Ver planos ▶</a>` : ""}
    ${await cartaoConfiguracao()}
    ${eu.alertas.map((a) => `<div class="faixa ${a.tipo === "pausa" ? "" : "erro"}">${esc(a.texto)} ${a.post_id ? `<a href="#post/${esc(a.post_id)}">ver</a>` : a.acao === "ajustes" ? `<a href="#ajustes">resolver</a>` : a.acao === "retomar" ? `<button data-fila="retomar">Retomar</button>` : ""}</div>`).join("")}
    <a class="botao primario grande" href="#criar" style="display:flex;align-items:center;justify-content:center;text-decoration:none">＋ Novo Reel</a>
    <div class="linha" style="margin-top:8px"><button id="lancar-propaganda">📣 Lançar propaganda</button><button id="teste-imediato">🧪 Teste imediato</button></div>
    <div class="cartao"><form id="f-cmd"><label for="cmd">Diga o que fazer</label>
      <input id="cmd" placeholder="Ex.: Mostre minha agenda da semana" autocomplete="off" enterkeyhint="send">
      <button class="primario" style="margin-top:8px;width:100%">Enviar</button></form>
      <div id="cmd-resp"></div>
      <details><summary class="fraco">Exemplos</summary><ul>${AJUDA.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details></div>
    <h2>Próximos 7 dias</h2>
    ${proximos.length ? proximos.map((p) => cartaoPost(p)).join("") : `<p class="fraco">Nada programado. Toque em Novo Reel.</p>`}`;
  el.querySelectorAll("[data-fila]").forEach((b) => (b.onclick = async () => { await cli.chamar("POST", "/v1/fila/retomar"); await iniciar(); }));
  $("#teste-imediato").onclick = abrirTestePublicacao;
  $("#lancar-propaganda").onclick = abrirPropaganda;
  $("#f-cmd").onsubmit = (e) => { e.preventDefault(); executarComando($("#cmd").value, {}); };
};

async function executarComando(texto, extra) {
  const alvo = $("#cmd-resp");
  try {
    const r = await cli.chamar("POST", "/v1/comandos", { texto, ...extra });
    alvo.innerHTML = `<div class="faixa ${r.pergunta ? "" : "ok"}"><pre class="resposta">${esc(r.resposta)}</pre>
      ${r.confirmar ? `<div class="linha"><button class="primario" id="cmd-sim">Confirmar</button><button id="cmd-nao">Não</button></div>` : ""}</div>`;
    if (r.confirmar) {
      $("#cmd-sim").onclick = () => executarComando(texto, { confirmar: true, hash_previa: r.previa.hash_previa });
      $("#cmd-nao").onclick = () => (alvo.innerHTML = "");
    }
    if (!r.pergunta && !r.confirmar && r.interpretacao.acao !== "listar_agenda") { eu = await cli.chamar("GET", "/v1/eu"); }
  } catch (err) { alvo.innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
}

// --- Criar (Novo Reel): vídeo → capa → legenda → data/hora → revisar → programar
const PASSOS = ["Vídeo", "Capa", "Legenda", "Data e hora", "Revisar"];
telas.criar = async (el) => {
  if (!arquivos.video && R.videoNome) arquivos.video = await idb.ler("video");
  if (!arquivos.capa && R.capaNome) arquivos.capa = await idb.ler("capa");
  const p = R.passo;
  const url = (f) => (f ? URL.createObjectURL(f) : "");
  let corpo = "";
  if (p === 0) corpo = `<label for="in-video">Escolha o vídeo (MP4 ou MOV)</label>
      <input id="in-video" type="file" accept="video/mp4,video/quicktime,video/*">
      ${arquivos.video ? `<div class="previa"><video src="${url(arquivos.video)}" controls playsinline muted></video></div><p class="fraco">${esc(arquivos.video.name)} — ${(arquivos.video.size / 1048576).toFixed(1)} MB</p>` : R.videoMidia ? `<p>Vídeo já enviado: ${esc(R.videoNome || "")}</p>` : ""}`;
  if (p === 1) corpo = `<label for="in-capa">Capa (JPG ou PNG) — opcional</label>
      <input id="in-capa" type="file" accept="image/jpeg,image/png">
      ${arquivos.capa ? `<div class="previa"><img alt="Prévia da capa" src="${url(arquivos.capa)}"><div class="grade" aria-hidden="true"></div></div>
      <p class="fraco">O tracejado marca a zona aproximada do recorte da grade do perfil (3:4). Confira no app do Instagram: a Meta muda essas regras.</p>` : `<p class="fraco">Sem capa, o Instagram escolhe um quadro do vídeo.</p>`}
      ${arquivos.capa ? `<button id="tirar-capa">Remover capa</button>` : ""}`;
  if (p === 2) corpo = `<label for="in-leg">Legenda</label><textarea id="in-leg" maxlength="2200" placeholder="Escreva a legenda…">${esc(R.legenda)}</textarea>
      <p class="fraco" id="contagem"></p>
      <details><summary>Fonte do conteúdo (opcional)</summary>
      <label for="in-autor">Autor da fonte</label><input id="in-autor" value="${esc(R.fonte.autor)}" placeholder="@vikingthales">
      <label for="in-url">Link do vídeo-base</label><input id="in-url" type="url" inputmode="url" value="${esc(R.fonte.url)}"></details>`;
  if (p === 3) {
    const hoje = partesLocais(new Date(), fuso()).data;
    corpo = `<label><input type="checkbox" id="in-fila" ${R.proximoLivre ? "checked" : ""}> Usar o próximo horário livre da frequência</label>
      <div id="manual" class="${R.proximoLivre ? "oculto" : ""}"><div class="linha"><div style="flex:1"><label for="in-data">Data</label><input id="in-data" type="date" min="${hoje}" value="${esc(R.data)}"></div>
      <div style="flex:1"><label for="in-hora">Horário</label><input id="in-hora" type="time" value="${esc(R.hora)}"></div></div></div>
      <p class="fraco">Fuso: ${esc(fuso())}</p>`;
  }
  if (p === 4) corpo = `<dl class="recibo"><dt>Vídeo</dt><dd>${esc(R.videoNome || "—")}</dd><dt>Capa</dt><dd>${esc(R.capaNome || "automática")}</dd>
      <dt>Quando</dt><dd>${R.proximoLivre ? "próximo horário livre" : esc(R.data && R.hora ? `${R.data.split("-").reverse().join("/")} às ${R.hora}` : "—")} (${esc(fuso())})</dd>
      <dt>Legenda</dt><dd>${esc(R.legenda || "(vazia)")}</dd></dl>
      ${seletorConta("in-conta", R.contaId)}
      <div id="progresso"></div><div id="msg"></div>
      <button class="primario grande" id="programar">Programar</button>
      <button class="grande" id="salvar-rascunho" style="margin-top:8px">Salvar como rascunho</button>`;
  el.innerHTML = `${faixaModo()}<h1>Novo Reel</h1>
    <div class="passos" aria-hidden="true">${PASSOS.map((_, i) => `<span class="${i <= p ? "feito" : ""}"></span>`).join("")}</div>
    <h2>${p + 1}. ${PASSOS[p]}</h2>
    <div class="cartao">${corpo}</div>
    <div class="linha">${p > 0 ? `<button id="voltar">Voltar</button>` : ""}${p < 4 ? `<button class="primario" id="avancar">Avançar</button>` : ""}</div>
    <p><button id="descartar" class="perigo" style="margin-top:16px">Descartar rascunho</button></p>`;

  const ir = (n) => { R.passo = n; salvarR(); mostrar(); };
  $("#voltar") && ($("#voltar").onclick = () => ir(p - 1));
  $("#descartar").onclick = async () => { if (!confirm("Descartar este rascunho?")) return; R = rascunhoNovo(); arquivos = { video: null, capa: null }; salvarR(); await idb.apagar("video"); await idb.apagar("capa"); mostrar(); };
  if (p === 0) {
    $("#in-video").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; arquivos.video = f; R.videoNome = f.name; R.videoMidia = null; salvarR(); await idb.gravar("video", f); mostrar(); };
    $("#avancar").onclick = () => (arquivos.video || R.videoMidia ? ir(1) : alert("Escolha o vídeo."));
  }
  if (p === 1) {
    $("#in-capa").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; arquivos.capa = f; R.capaNome = f.name; R.capaMidia = null; salvarR(); await idb.gravar("capa", f); mostrar(); };
    $("#tirar-capa") && ($("#tirar-capa").onclick = async () => { arquivos.capa = null; R.capaNome = null; R.capaMidia = null; salvarR(); await idb.apagar("capa"); mostrar(); });
    $("#avancar").onclick = () => ir(2);
  }
  if (p === 2) {
    const conta = () => { const v = $("#in-leg").value; const tags = (v.match(/(^|\s)#[^\s#]+/g) || []).length; $("#contagem").textContent = `${[...v].length}/2200 caracteres · ${tags}/30 hashtags`; };
    conta();
    $("#in-leg").oninput = () => { R.legenda = $("#in-leg").value; salvarR(); conta(); };
    ["in-autor", "in-url"].forEach((i) => ($("#" + i).oninput = () => { R.fonte = { autor: $("#in-autor").value, url: $("#in-url").value }; salvarR(); }));
    $("#avancar").onclick = () => ir(3);
  }
  if (p === 3) {
    $("#in-fila").onchange = (e) => { R.proximoLivre = e.target.checked; salvarR(); $("#manual").classList.toggle("oculto", R.proximoLivre); };
    $("#in-data").oninput = (e) => { R.data = e.target.value; salvarR(); };
    $("#in-hora").oninput = (e) => { R.hora = e.target.value; salvarR(); };
    $("#avancar").onclick = () => (R.proximoLivre || (R.data && R.hora) ? ir(4) : alert("Escolha data e horário, ou o próximo horário livre."));
  }
  if (p === 4) {
    $("#in-conta") && ($("#in-conta").onchange = (e) => { R.contaId = e.target.value; salvarR(); });
    $("#programar").onclick = () => enviarRascunho(true);
    $("#salvar-rascunho").onclick = () => enviarRascunho(false);
  }
};

async function sha256(arquivo) {
  const h = await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function miniaturaDe(arquivo) {
  return new Promise((ok) => {
    const ehVideo = arquivo.type.startsWith("video/");
    const el = document.createElement(ehVideo ? "video" : "img");
    const u = URL.createObjectURL(arquivo);
    const desenhar = () => {
      try {
        const w = ehVideo ? el.videoWidth : el.naturalWidth, h = ehVideo ? el.videoHeight : el.naturalHeight;
        const c = document.createElement("canvas"); const esc_ = 180 / Math.max(w, h); c.width = Math.round(w * esc_); c.height = Math.round(h * esc_);
        c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
        ok({ miniatura: c.toDataURL("image/jpeg", 0.7), largura: w, altura: h, duracao_seg: ehVideo ? Math.round(el.duration * 10) / 10 : null });
      } catch { ok({}); } finally { URL.revokeObjectURL(u); }
    };
    if (ehVideo) { el.muted = true; el.preload = "auto"; el.onloadeddata = () => { el.currentTime = Math.min(1, (el.duration || 1) / 2); }; el.onseeked = desenhar; }
    else el.onload = desenhar;
    el.onerror = () => ok({});
    setTimeout(() => ok({}), 8000);
    el.src = u;
  });
}

async function enviarMidia(tipo, arquivo, barra) {
  const meta = await miniaturaDe(arquivo);
  const { midia, upload } = await cli.chamar("POST", "/v1/midias", { tipo, nome: arquivo.name, mime: arquivo.type, tamanho: arquivo.size, sha256: await sha256(arquivo), ...meta });
  if (upload) {
    await cli.enviarArquivo(upload, arquivo, (f) => (barra.style.width = Math.round(f * 100) + "%"), midia);
    return (await cli.chamar("POST", `/v1/midias/${midia.id}/finalizar`)).midia;
  }
  barra.style.width = "100%";
  return midia;
}

async function enviarRascunho(agendar) {
  const prog = $("#progresso"), msg = $("#msg");
  const botoes = [$("#programar"), $("#salvar-rascunho")];
  botoes.forEach((b) => (b.disabled = true));
  msg.innerHTML = "";
  try {
    R.enviando = true; salvarR();
    if (!R.videoMidia) {
      prog.innerHTML = `<p>Enviando o vídeo…</p><div class="barra-prog"><div id="bv"></div></div>`;
      if (!arquivos.video) throw new Error("O arquivo do vídeo não está mais neste aparelho. Volte ao passo 1 e escolha de novo.");
      R.videoMidia = (await enviarMidia("video", arquivos.video, $("#bv"))).id; salvarR();
    }
    if (arquivos.capa && !R.capaMidia) {
      prog.insertAdjacentHTML("beforeend", `<p>Enviando a capa…</p><div class="barra-prog"><div id="bc"></div></div>`);
      R.capaMidia = (await enviarMidia("capa", arquivos.capa, $("#bc"))).id; salvarR();
    }
    // A chave do rascunho torna o pedido idempotente: repetir (rede caiu, app
    // voltou do segundo plano) devolve o mesmo post em vez de duplicar.
    const fonte = R.fonte.autor || R.fonte.url ? R.fonte : undefined;
    const contaEscolhida = ($("#in-conta") && $("#in-conta").value) || undefined;
    const pedido = { video_id: R.videoMidia, capa_id: R.capaMidia || undefined, conta_id: contaEscolhida, legenda: R.legenda, agendar, chave_idempotencia: R.chave + (agendar ? ":a" : ":r"), fonte,
      ...(agendar ? (R.proximoLivre ? { proximo_livre: true } : { data: R.data, hora: R.hora }) : {}) };
    const { post } = await cli.chamar("POST", "/v1/posts", pedido);
    // Só confirma depois de LER de volta o que ficou gravado no servidor.
    const lido = (await cli.chamar("GET", `/v1/posts/${post.id}`)).post;
    R = rascunhoNovo(); arquivos = { video: null, capa: null }; salvarR(); await idb.apagar("video"); await idb.apagar("capa");
    location.hash = "#post/" + lido.id;
  } catch (err) {
    R.enviando = false; salvarR();
    msg.innerHTML = `<div class="faixa erro">${mensagemErro(err)}<br>Nada foi confirmado. O rascunho continua salvo: toque em Programar de novo.</div>`;
    botoes.forEach((b) => (b.disabled = false));
  }
}

telas.agenda = async (el, filtro = ls.ler("jarvis-social:filtro", "ativos")) => {
  const hoje = partesLocais(new Date(), fuso()).data;
  const { posts } = await cli.chamar("GET", "/v1/posts", null, { de: somarDias(hoje, -7), ate: somarDias(hoje, 60), incluir_rascunhos: "1" });
  const F = { ativos: (p) => !["cancelled"].includes(p.estado), agendados: (p) => p.estado === "scheduled", pausados: (p) => p.estado === "paused", falhas: (p) => ["failed", "needs_reconciliation", "retry_wait"].includes(p.estado), publicados: (p) => p.estado === "published", rascunhos: (p) => p.estado === "draft", cancelados: (p) => p.estado === "cancelled" };
  const filtroConta = ls.ler("jarvis-social:filtroConta", "");
  const lista = await comMiniaturas(posts.filter(F[filtro] || F.ativos).filter((p) => !filtroConta || p.conta_id === filtroConta));
  const grupos = new Map();
  for (const p of lista) { const d = p.agendado_utc ? partesLocais(p.agendado_utc, fuso()).data : "sem data"; if (!grupos.has(d)) grupos.set(d, []); grupos.get(d).push(p); }
  const titulo = (d) => d === "sem data" ? "Sem data (rascunhos)" : d === hoje ? "Hoje" : d === somarDias(hoje, 1) ? "Amanhã" : `${NOMES_DIA_LONGO[partesLocais(d + "T12:00:00Z", "UTC").diaSemana]}, ${d.split("-").reverse().join("/")}`;
  el.innerHTML = `${faixaModo()}<h1>Agenda</h1><p class="fraco">Horários em ${esc(fuso())}. Esta é a fila do Jarvis; ela não aparece na tela "programados" do app do Instagram.</p>
    <div class="chips" role="group" aria-label="Filtro">${Object.keys(F).map((k) => `<button class="chip ${k === filtro ? "ativo" : ""}" data-filtro="${k}" aria-pressed="${k === filtro}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
    ${contasUsaveis().length > 1 ? `<div class="chips" role="group" aria-label="Conta"><button class="chip ${!filtroConta ? "ativo" : ""}" data-fconta="">Todas as contas</button>${contasUsaveis().map((c) => `<button class="chip ${filtroConta === c.id ? "ativo" : ""}" data-fconta="${esc(c.id)}">@${esc(c.usuario_rede)}</button>`).join("")}</div>` : ""}
    <button id="ver-grade" style="width:100%;margin-bottom:8px">▦ Grade dos próximos 14 dias</button>
    ${eu.org.fila_pausada ? `<div class="faixa">Fila pausada. <button data-fila="retomar">Retomar</button></div>` : `<button data-fila="pausar" style="width:100%">Pausar todas as próximas publicações</button>`}
    ${lista.length ? [...grupos].map(([d, ps]) => `<div class="dia">${esc(titulo(d))}</div>${ps.map((p) => cartaoPost(p)).join("")}`).join("") : `<p class="fraco">Nada aqui.</p>`}`;
  $("#ver-grade").onclick = abrirGrade;
  el.querySelectorAll("[data-fconta]").forEach((b) => (b.onclick = () => { ls.gravar("jarvis-social:filtroConta", b.dataset.fconta); telas.agenda(el, filtro); }));
  el.querySelectorAll("[data-filtro]").forEach((b) => (b.onclick = () => { ls.gravar("jarvis-social:filtro", b.dataset.filtro); telas.agenda(el, b.dataset.filtro); }));
  el.querySelectorAll("[data-fila]").forEach((b) => (b.onclick = async () => { await cli.chamar("POST", `/v1/fila/${b.dataset.fila}`); eu = await cli.chamar("GET", "/v1/eu"); telas.agenda(el, filtro); }));
};

telas.post = async (el, id) => {
  const { post, eventos } = await cli.chamar("GET", `/v1/posts/${id}`);
  const rc = post.recibo;
  const [comMini] = await comMiniaturas([post]);
  el.innerHTML = `${faixaModo()}<h1>Publicação</h1>
    ${post.estado === "published" ? `<span class="carimbo">MISSÃO CUMPRIDA${rc.confirmacao === "demonstracao" ? " (simulada)" : ""}</span>` : ""}
    <div class="faixa ${rc.confirmacao === "publicacao_concluida" ? "ok" : rc.confirmacao === "demonstracao" ? "demo" : ""}"><strong>${esc(confirmacaoTexto(rc))}</strong>${rc.aviso ? `<br>${esc(rc.aviso)}` : ""}</div>
    ${cartaoPost(comMini)}
    <div class="cartao"><h3>Recibo</h3><dl class="recibo">
      <dt>Estado</dt><dd>${esc(rc.estado_texto)} (versão ${rc.versao})</dd>
      <dt>Quando</dt><dd>${esc(rc.agendado_local || "sem data")}</dd>
      <dt>Destino</dt><dd>Instagram ${esc(rc.perfil || "(conta não conectada)")}</dd>
      ${rc.fonte ? `<dt>Fonte</dt><dd>${esc(rc.fonte.autor || "")} ${rc.fonte.url ? `<a href="${esc(rc.fonte.url)}" target="_blank" rel="noopener">vídeo-base</a>` : ""}</dd>` : ""}
      <dt>Contêiner</dt><dd>${esc(rc.container_id || "—")}</dd>
      <dt>ID da mídia</dt><dd>${esc(rc.media_id || "—")}</dd>
      <dt>Permalink</dt><dd>${rc.permalink ? `<a href="${esc(rc.permalink)}" target="_blank" rel="noopener">${esc(rc.permalink)}</a>` : "—"}</dd>
      <dt>Código</dt><dd><small>${esc(post.id)}</small></dd></dl></div>
    <div class="cartao"><h3>Histórico</h3>${eventos.map((ev) => `<p><small>${esc(formatarLocal(ev.criado_em, fuso(), { comFuso: false }))}</small><br>${esc(ESTADOS[ev.para] || ev.para)} — ${esc(ev.motivo || "")}</p>`).join("")}</div>`;
};

telas.biblioteca = async (el) => {
  const { midias } = await cli.chamar("GET", "/v1/midias");
  el.innerHTML = `${faixaModo()}<h1>Biblioteca</h1>
    ${midias.length ? midias.map((m) => `<div class="cartao item">${m.miniatura ? `<img class="miniatura" alt="" src="${esc(m.miniatura)}">` : `<div class="miniatura"></div>`}
      <div class="texto"><p><strong>${esc(m.nome)}</strong></p><p class="fraco">${m.tipo === "video" ? "Vídeo" : "Capa"} · ${(m.tamanho / 1048576).toFixed(1)} MB${m.duracao_seg ? ` · ${m.duracao_seg}s` : ""}${m.largura ? ` · ${m.largura}×${m.altura}` : ""} · ${m.estado === "pronta" ? "pronto" : "envio incompleto"}</p>
      <p class="fraco">${esc(formatarLocal(m.criado_em, fuso(), { comFuso: false }))}</p></div></div>`).join("") : `<p class="fraco">Nenhum arquivo ainda.</p>`}`;
};

telas.ajustes = async (el) => {
  const pol = eu.org.politica;
  const status = new URLSearchParams(location.hash.split("?")[1] || "").get("instagram");
  const ativa = eu.conexoes.find((c) => c.estado === "ativa");
  el.innerHTML = `${faixaModo()}<h1>Ajustes</h1>
    ${status ? `<div class="faixa ${status === "conectado" ? "ok" : "erro"}">Instagram: ${esc({ conectado: "conectado", recusado: "autorização recusada", expirado: "o link expirou, tente de novo", erro: "não deu para concluir a conexão" }[status] || status)}</div>` : ""}
    <div class="cartao"><h2>Instagram</h2>
      ${eu.conexoes.filter((c) => c.estado !== "revogada").map((c) => `<div class="item" style="align-items:center;margin:8px 0"><div class="texto"><strong>@${esc(c.usuario_rede)}</strong>${c.id === contaPadraoId() ? ` <span class="selo published">padrão</span>` : ""}<br><small>${esc({ ativa: "conectada", reconectar: "precisa reconectar" }[c.estado])}${c.simulado ? " · simulada" : ""}</small></div>
        ${c.id !== contaPadraoId() ? `<button data-padrao="${esc(c.id)}">Tornar padrão</button>` : ""}<button data-desconectar="${esc(c.id)}">Desconectar</button></div>`).join("")}
      <p class="fraco">A conta padrão vem marcada em cada Novo Reel; dá para trocar na hora de programar e na edição.</p>
      ${eu.instagram_configurado ? `<button class="primario" id="conectar">${ativa ? "Conectar outra conta / reconectar" : "Conectar Instagram"}</button>` : contaEstado.dono ? "" : `<div class="faixa">O administrador ainda não configurou o app da Meta.</div>`}
      ${contaEstado.dono && cli.modo === "servidor" ? `<details ${eu.instagram_configurado ? "" : "open"}><summary><strong>${eu.instagram_configurado ? "App da Meta configurado ✓ (trocar)" : "Configurar o app da Meta (uma vez)"}</strong></summary>
        <ol class="fraco" style="padding-left:20px">
          <li>Abra <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noopener">developers.facebook.com › Criar app</a> e escolha o caso de uso do Instagram (gerenciar conteúdo).</li>
          <li>Em Instagram › Configuração da API com login do Instagram, adicione a sua conta e cole este endereço de redirecionamento:</li></ol>
        <textarea readonly style="min-height:70px">${esc(eu.redirect_uri_meta || "")}</textarea><button data-copiar="${esc(eu.redirect_uri_meta || "")}">Copiar endereço</button>
        <ol start="3" class="fraco" style="padding-left:20px"><li>Copie o ID do app do Instagram e a chave secreta e cole aqui:</li></ol>
        <label for="meta-id">ID do app do Instagram</label><input id="meta-id" inputmode="numeric" autocomplete="off">
        <label for="meta-sec">Chave secreta do app</label><input id="meta-sec" type="password" autocomplete="off">
        <div id="meta-msg"></div><button class="primario" id="meta-salvar" style="width:100%;margin-top:8px">Salvar e conectar o Instagram</button></details>` : ""}
      <p class="fraco">Conta profissional (criador ou empresa). A autorização é feita no próprio Instagram; o Jarvis nunca vê sua senha.</p></div>
    <div class="cartao"><h2>Integrações: ChatGPT e Claude</h2>
      <p class="fraco">Crie uma chave para o ChatGPT ou o Claude verem e preencherem a sua grade de Reels conversando com você. A chave vale só para este espaço; revogue quando quiser.</p>
      <div id="chaves"></div>
      <div class="linha"><input id="chave-nome" placeholder="Nome (ex.: Claude)" style="flex:1 1 100%">
        <select id="chave-escopo" style="flex:1"><option value="programar">Ler e programar</option><option value="leitura">Só ler</option></select>
        <select id="chave-dias" style="flex:1"><option value="90">90 dias</option><option value="30">30 dias</option><option value="365">1 ano</option></select></div>
      <button class="primario" id="criar-chave" style="width:100%;margin-top:8px">Criar chave</button>
      <div id="chave-nova"></div>
      <p class="fraco">Passo a passo para conectar: docs/INTEGRACAO-ASSISTENTES.md.</p></div>
    <div class="cartao"><h2>Frequência</h2>
      <p class="fraco">Sem limite do Jarvis: quantos horários quiser por dia. A cota oficial do Instagram é consultada antes de cada envio.</p>
      <label>Horários</label><div class="chips" id="horarios">${pol.horarios.map((h) => `<button class="chip ativo" data-tirar="${h}" aria-label="Remover ${h}">${h} ✕</button>`).join("")}</div>
      <div class="linha"><input id="nova-hora" type="time" style="flex:1"><button id="add-hora">Adicionar</button></div>
      <label>Dias</label><div class="chips">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="chip" style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" data-dia="${d}" ${pol.dias.includes(d) ? "checked" : ""}>${NOMES_DIA_LONGO[d].slice(0, 3)}</label>`).join("")}</div>
      <label style="display:flex;gap:10px"><input type="checkbox" id="piloto" ${eu.org.piloto_automatico ? "checked" : ""}>Piloto automático: rascunhos (seus ou do ChatGPT/Claude) entram sozinhos nos próximos horários livres</label>
      <label for="pausa">Pausar a frequência até (opcional)</label><input id="pausa" type="date" value="${esc(pol.pausadaAte || "")}">
      <div id="prev"></div>
      <button class="primario" id="ver-previa" style="width:100%;margin-top:8px">Ver prévia e aplicar</button></div>
    <div class="cartao"><h2>Horário perdido</h2>
      <label for="atraso">Se o servidor ficar fora e passar do horário</label>
      <select id="atraso"><option value="aguardar">Pausar e esperar minha decisão</option><option value="publicar">Publicar assim mesmo</option><option value="reagendar">Mover para o próximo horário livre</option></select>
      <label for="tol">Tolerância (minutos)</label><input id="tol" type="number" inputmode="numeric" min="0" max="1440" value="${eu.org.tolerancia_atraso_min}">
      <label for="fuso">Fuso do espaço</label><input id="fuso" value="${esc(eu.org.fuso)}">
      <button id="salvar-org" style="width:100%;margin-top:8px">Salvar</button></div>
    <div class="cartao"><h2>Sua conta</h2><p>${esc(contaEstado.conta.nome || "")} · ${esc(contaEstado.conta.email || (cli.usuario() || {}).email || "")}</p>
      <p><strong>Plano:</strong> ${esc(contaEstado.plano.texto)}</p>
      ${contaEstado.dono ? `<a class="botao primario" href="#usuarios" style="display:flex;justify-content:center;text-decoration:none;margin:8px 0">Painel de usuários${contaEstado.avisos_dono && (contaEstado.avisos_dono.aguardando + contaEstado.avisos_dono.pagamentos) ? ` (${contaEstado.avisos_dono.aguardando + contaEstado.avisos_dono.pagamentos})` : ""}</a>` : ""}
      ${contaEstado.cobranca.ligada && !contaEstado.dono ? `<a class="botao" href="#planos" style="display:flex;justify-content:center;text-decoration:none;margin:8px 0">Planos, renovar e meus pagamentos</a>` : ""}
      <p class="fraco">Termos aceitos: versão ${esc(contaEstado.conta.termos_versao || contaEstado.termos.versao)}${contaEstado.conta.termos_em ? " em " + esc(new Date(contaEstado.conta.termos_em).toLocaleDateString("pt-BR")) : ""}. <a href="#" id="ver-termos">Ler</a></p>
      ${cli.modo === "servidor" ? `<button id="trocar-senha">Trocar minha senha (link no e-mail)</button>` : ""}
      ${!contaEstado.dono && cli.modo === "servidor" ? `<button class="perigo" id="apagar-conta" style="margin-top:8px">Apagar minha conta</button>` : ""}
      ${cli.modo === "demonstracao" ? `<button id="rodar-worker">Simular o worker agora</button> <button class="perigo" id="zerar-demo">Apagar dados da demonstração</button>${servidorConfigurado ? ` <button id="ir-servidor">Usar o servidor</button>` : ""}` : `<button id="sair">Sair</button> <button id="ir-demo">Abrir demonstração</button>`}
      <p class="fraco">Painel ${VERSAO_PAINEL} · API ${esc(eu.versao_api)}</p></div>`;
  $("#atraso").value = eu.org.politica_atraso;
  desenharChaves();
  $("#piloto").onchange = async (e) => { try { await cli.chamar("PUT", "/v1/organizacao", { piloto_automatico: e.target.checked }); eu = await cli.chamar("GET", "/v1/eu"); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; } };
  $("#criar-chave").onclick = async () => {
    try {
      const r = await cli.chamar("POST", "/v1/chaves", { nome: $("#chave-nome").value || "Assistente", escopo: $("#chave-escopo").value, dias: +$("#chave-dias").value });
      const base = CONFIG.supabaseUrl ? CONFIG.supabaseUrl.replace(/\/$/, "") : "https://SEU_REF.supabase.co";
      $("#chave-nova").innerHTML = `<div class="faixa ok"><strong>Copie agora: a chave não aparece de novo.</strong>
        <label>Chave (ChatGPT: Ações › Autenticação › Chave de API › Bearer)</label><textarea readonly style="min-height:70px">${esc(r.segredo)}</textarea>
        <label>Endereço do conector (Claude: Conectores › Adicionar conector personalizado)</label><textarea readonly style="min-height:90px">${esc(base + "/functions/v1/mcp/" + r.segredo)}</textarea>
        <div class="linha"><button data-copiar="${esc(base + "/functions/v1/mcp/" + r.segredo)}">Copiar p/ Claude</button><a class="botao" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Abrir Conectores do Claude</a></div>
        <div class="linha" style="margin-top:6px"><button data-copiar="${esc(r.segredo)}">Copiar chave p/ GPT</button><button data-copiar="${esc(INSTRUCOES_GPT)}">Copiar instruções do GPT</button>
          <button data-copiar="${esc(new URL("openapi-chatgpt.json", location.href.split("#")[0]).toString())}">Copiar link do contrato (Ações)</button><a class="botao" href="https://chatgpt.com/gpts/editor" target="_blank" rel="noopener">Criar GPT</a></div>
        ${cli.modo === "demonstracao" ? "<p>Demonstração: a chave só existe neste aparelho; o conector funciona depois que o servidor estiver no ar.</p>" : ""}</div>`;
      desenharChaves();
  $("#piloto").onchange = async (e) => { try { await cli.chamar("PUT", "/v1/organizacao", { piloto_automatico: e.target.checked }); eu = await cli.chamar("GET", "/v1/eu"); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; } };
    } catch (err) { alert(err.message); }
  };
  const horarios = new Set(pol.horarios);
  el.querySelectorAll("[data-tirar]").forEach((b) => (b.onclick = () => { horarios.delete(b.dataset.tirar); b.remove(); }));
  $("#add-hora").onclick = () => { const v = $("#nova-hora").value; if (!v || horarios.has(v)) return; horarios.add(v); $("#horarios").insertAdjacentHTML("beforeend", `<button class="chip ativo" data-tirar="${v}">${v} ✕</button>`); $("#horarios").lastElementChild.onclick = (e) => { horarios.delete(v); e.target.remove(); }; };
  const politica = () => ({ horarios: [...horarios].sort(), dias: [...el.querySelectorAll("[data-dia]:checked")].map((c) => +c.dataset.dia), pausadaAte: $("#pausa").value || null, fuso: eu.org.fuso });
  $("#ver-previa").onclick = async () => {
    try {
      const pv = await cli.chamar("POST", "/v1/frequencia/previa", { politica: politica() });
      $("#prev").innerHTML = `<div class="faixa">${pv.politica.horarios.length} por dia: ${pv.politica.horarios.join(", ")}.<br>${pv.mudancas.length ? `Remarca ${pv.mudancas.length} publicação(ões) da fila automática:<ul>${pv.mudancas.map((m) => `<li>${esc(m.de_local)} → ${esc(m.para_local || "sem horário")}</li>`).join("")}</ul>` : "Nenhuma publicação já programada muda."} Horários escolhidos à mão não mudam.</div>
        <button class="primario" id="aplicar" style="width:100%">Aplicar</button>`;
      $("#aplicar").onclick = async () => { await cli.chamar("PUT", "/v1/frequencia", { politica: pv.politica, hash_previa: pv.hash_previa }); eu = await cli.chamar("GET", "/v1/eu"); $("#prev").innerHTML = `<div class="faixa ok">Frequência aplicada.</div>`; };
    } catch (err) { $("#prev").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
  };
  $("#salvar-org").onclick = async () => { try { await cli.chamar("PUT", "/v1/organizacao", { politica_atraso: $("#atraso").value, tolerancia_atraso_min: +$("#tol").value, fuso: $("#fuso").value }); eu = await cli.chamar("GET", "/v1/eu"); alert("Salvo."); } catch (err) { alert(err.message); } };
  $("#meta-salvar") && ($("#meta-salvar").onclick = async () => {
    try {
      await cli.chamar("PUT", "/v1/admin/meta", { app_id: $("#meta-id").value, app_secret: $("#meta-sec").value });
      const r = await cli.chamar("POST", "/v1/instagram/conectar"); if (r.url) location.href = r.url;
    } catch (err) { $("#meta-msg").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
  });
  el.querySelectorAll("[data-padrao]").forEach((b) => (b.onclick = async () => { await cli.chamar("PUT", "/v1/organizacao", { conta_padrao_id: b.dataset.padrao }); eu = await cli.chamar("GET", "/v1/eu"); mostrar(); }));
  $("#conectar") && ($("#conectar").onclick = async () => { try {
    let corpo = {};
    if (cli.modo === "demonstracao") { const n = prompt("Qual @ do Instagram? (demonstração: a conexão é simulada)", contasUsaveis().length ? "" : "carlos.jr.81"); if (!n) return; corpo = { usuario_rede: n }; }
    const r = await cli.chamar("POST", "/v1/instagram/conectar", corpo); if (r.url) location.href = r.url; else { eu = await cli.chamar("GET", "/v1/eu"); mostrar(); } } catch (err) { alert(err.message); } });
  el.querySelectorAll("[data-desconectar]").forEach((b) => (b.onclick = async () => { if (!confirm("Desconectar esta conta? As publicações agendadas não serão enviadas.")) return; await cli.chamar("POST", `/v1/instagram/${b.dataset.desconectar}/desconectar`); eu = await cli.chamar("GET", "/v1/eu"); mostrar(); }));
  $("#rodar-worker") && ($("#rodar-worker").onclick = async () => { const r = await cli.rodarWorker(); alert(`Worker simulado: ${r.reivindicados} tarefa(s). ${r.resultados.map((x) => x.resultado).join(", ")}`); eu = await cli.chamar("GET", "/v1/eu"); });
  $("#ver-termos").onclick = (e) => { e.preventDefault(); const T = contaEstado.termos.texto; abrirFolha(`<h2>${esc(T.titulo)}</h2>${T.secoes.map(([t, x]) => `<h3>${esc(t)}</h3><p>${esc(x)}</p>`).join("")}<p class="fraco">Versão ${esc(T.versao)}</p><button class="grande" id="fechar-termos">Fechar</button>`); $("#fechar-termos").onclick = fecharFolha; };
  $("#trocar-senha") && ($("#trocar-senha").onclick = async () => { try { await cli.esqueci(contaEstado.conta.email); alert("Link para criar a senha nova enviado para " + contaEstado.conta.email + "."); } catch (err) { alert(err.message); } });
  $("#apagar-conta") && ($("#apagar-conta").onclick = async () => {
    const t = prompt("Isto apaga sua conta, seus espaços, agendamentos e mídias. Não tem volta. Digite APAGAR para confirmar:");
    if (t !== "APAGAR") return;
    try { await cli.chamar("POST", "/v1/conta/apagar", { confirmar: "APAGAR" }); cli.sair(); location.reload(); } catch (err) { alert(err.message); }
  });
  $("#zerar-demo") && ($("#zerar-demo").onclick = () => { if (confirm("Apagar os dados da demonstração?")) { cli.sair(); location.reload(); } });
  $("#ir-servidor") && ($("#ir-servidor").onclick = () => { ls.apagar(CH.modo); location.reload(); });
  $("#ir-demo") && ($("#ir-demo").onclick = () => { ls.gravar(CH.modo, "demonstracao"); location.reload(); });
  $("#sair") && ($("#sair").onclick = () => { cli.sair(); location.hash = "#inicio"; location.reload(); });
};

// ------------------------------------------------------------------ teste de publicação imediato
// Um botão: baixa o Reel e a capa de teste (pasta teste/), envia, cria a
// publicação para AGORA, acorda o worker e acompanha cada etapa até o
// permalink. Na demonstração tudo é simulado e dito como tal.
function legendaTeste() {
  return `🧪 Teste de publicação — Jarvis Mídia Social

Este Reel foi publicado automaticamente pelo Jarvis Social para conferir a integração oficial com o Instagram: envio da mídia, criação do contêiner, processamento e publicação.

Teste feito em ${formatarLocal(new Date().toISOString(), fuso())}.
Pode ser ignorado ou apagado.

#teste #jarvissocial`;
}
const ETAPAS_TESTE = [["midia", "Baixar o vídeo e a capa de teste"], ["video", "Enviar o vídeo ao armazenamento"], ["capa", "Enviar a capa"], ["post", "Criar a publicação para agora"], ["worker", "Acordar o servidor"], ["rede", "Instagram: contêiner, processamento e publicação"]];
function abrirTestePublicacao() {
  const demo = cli.modo === "demonstracao";
  const cs = contasUsaveis();
  abrirFolha(`<h2>Teste de publicação imediato</h2>
    <div class="previa" style="max-width:180px"><img alt="Capa do teste" src="teste/capa-teste.jpg"></div>
    <p class="fraco">Reel de 6 s com a capa "Teste de publicação — Jarvis Mídia Social" e esta legenda:</p>
    <pre class="resposta cartao" style="font-size:14px">${esc(legendaTeste())}</pre>
    ${seletorConta("tp-conta")}
    <div class="faixa ${demo ? "demo" : "erro"}">${demo ? "DEMONSTRAÇÃO: todas as etapas são simuladas neste aparelho; nada vai ao Instagram." : "Isto publica DE VERDADE agora, no perfil escolhido. O Reel fica no perfil; apague pelo Instagram depois, se quiser."}</div>
    <div id="tp-etapas"></div><div id="tp-fim"></div>
    <button class="primario grande" id="tp-ir" ${cs.length ? "" : "disabled"}>${demo ? "Rodar o teste agora" : "Publicar o teste agora"}</button>
    <button class="grande" id="tp-fechar" style="margin-top:8px">Fechar</button>`);
  $("#tp-fechar").onclick = () => { fecharFolha(); mostrar(); };
  $("#tp-ir") && ($("#tp-ir").onclick = () => rodarTestePublicacao($("#tp-conta") && $("#tp-conta").value));
}
async function rodarTestePublicacao(contaId, op = {}) {
  const demo = cli.modo === "demonstracao";
  const conta = contasUsaveis().find((c) => c.id === contaId);
  const nomeCoisa = op.nome || "o Reel de teste";
  if (!demo && conta && !conta.simulado && !confirm(`Publicar ${nomeCoisa} agora em @${conta.usuario_rede}?`)) return;
  $("#tp-ir").disabled = true; $("#tp-conta") && ($("#tp-conta").disabled = true);
  const st = Object.fromEntries(ETAPAS_TESTE.map(([k]) => [k, "esperando"]));
  const detalhe = {};
  const desenhar = () => { $("#tp-etapas").innerHTML = `<div class="cartao">${ETAPAS_TESTE.map(([k, n]) => `<p>${{ esperando: "○", andando: "⏳", ok: "✅", erro: "❌" }[st[k]]} ${esc(n)}${detalhe[k] ? `<br><small class="fraco">${esc(detalhe[k])}</small>` : ""}</p>`).join("")}</div>`; };
  const etapa = (k, s, d) => { st[k] = s; if (d !== undefined) detalhe[k] = d; desenhar(); };
  desenhar();
  let atual = "midia";
  try {
    etapa("midia", "andando");
    const baixar = async (url, nome, tipo) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(`Não baixou ${url} (${r.status}).`); return new File([await r.blob()], nome, { type: tipo }); };
    const [video, capa] = op.arquivos ? [op.arquivos.video, op.arquivos.capa] : await Promise.all([baixar("teste/video-teste.mp4", "teste-jarvis.mp4", "video/mp4"), baixar("teste/capa-teste.jpg", "capa-teste-jarvis.jpg", "image/jpeg")]);
    etapa("midia", "ok", `${(video.size / 1048576).toFixed(1)} MB${capa ? ` + ${Math.round(capa.size / 1024)} KB` : " (capa automática)"}`);
    atual = "video"; etapa("video", "andando");
    const progresso = (k) => ({ style: { set width(x) { etapa(k, "andando", "enviado " + x); } } });
    const v = await enviarMidia("video", video, progresso("video"));
    etapa("video", "ok", v.id.slice(0, 8));
    atual = "capa"; etapa("capa", "andando");
    const c = capa ? await enviarMidia("capa", capa, progresso("capa")) : null;
    etapa("capa", "ok", capa ? undefined : "sem capa: o Instagram escolhe um quadro");
    atual = "post"; etapa("post", "andando");
    const { post } = await cli.chamar("POST", "/v1/posts", { video_id: v.id, capa_id: c ? c.id : undefined, conta_id: contaId || undefined, legenda: op.legenda != null ? op.legenda : legendaTeste(), publicar_agora: true, teste: op.teste !== false, chave_idempotencia: (op.teste === false ? "propaganda-" : "teste-") + novaChave() });
    etapa("post", "ok", `${post.recibo.perfil || "sem conta"} · ${post.estado_texto}`);
    atual = "worker"; etapa("worker", "andando");
    const cut = await cli.chamar("POST", "/v1/worker/cutucar");
    etapa("worker", "ok", cut.cutucado ? "servidor acordado" : cut.motivo);
    atual = "rede"; etapa("rede", "andando", "aguardando o servidor…");
    const inicio = Date.now(); let ultimoCut = Date.now(); let p = post;
    while (Date.now() - inicio < 8 * 60e3) {
      await new Promise((r) => setTimeout(r, demo ? 1500 : 5000));
      if (demo || Date.now() - ultimoCut > 16000) { ultimoCut = Date.now(); try { await cli.chamar("POST", "/v1/worker/cutucar"); } catch {} }
      p = (await cli.chamar("GET", `/v1/posts/${post.id}`)).post;
      etapa("rede", "andando", `${p.estado_texto}${p.container_id ? " · contêiner " + p.container_id : ""}${p.ultimo_erro ? " · " + p.ultimo_erro : ""} · ${Math.round((Date.now() - inicio) / 1000)} s`);
      if (["published", "failed", "cancelled", "paused"].includes(p.estado)) break;
    }
    const rc = p.recibo;
    if (p.estado === "published") {
      etapa("rede", "ok", `mídia ${rc.media_id}`);
      $("#tp-fim").innerHTML = `<span class="carimbo">MISSÃO CUMPRIDA${rc.confirmacao === "demonstracao" ? " (simulada)" : ""}</span><div class="faixa ${rc.confirmacao === "publicacao_concluida" ? "ok" : "demo"}"><strong>${esc(confirmacaoTexto(rc))}</strong>${rc.permalink ? `<br><a href="${esc(rc.permalink)}" target="_blank" rel="noopener">${rc.confirmacao === "demonstracao" ? "Link simulado (não abre)" : "Abrir no Instagram"}</a>` : ""}<br><a href="#post/${esc(p.id)}">Ver recibo completo</a></div>`;
    } else {
      etapa("rede", ["failed", "cancelled", "paused"].includes(p.estado) ? "erro" : "andando", `${p.estado_texto}${p.ultimo_erro ? ": " + p.ultimo_erro : ""}`);
      $("#tp-fim").innerHTML = `<div class="faixa erro">${p.estado === "failed" ? "O teste falhou. Motivo acima." : "Ainda não terminou em 8 min; o servidor continua sozinho."} <a href="#post/${esc(p.id)}">Acompanhar no recibo</a></div>`;
    }
  } catch (err) {
    etapa(atual, "erro", err.message);
    $("#tp-fim").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`;
  }
  $("#tp-ir").textContent = op.teste === false ? "Fechar e ver a agenda" : "Rodar outro teste"; $("#tp-ir").disabled = false;
  $("#tp-ir").onclick = op.teste === false ? () => { fecharFolha(); location.hash = "#agenda"; } : abrirTestePublicacao;
}

// ------------------------------------------------------------------ lançar a propaganda do Jarvis Social
// O vídeo da propaganda é montado no Jarvis (workflow "Propaganda Jarvis
// Social", com a voz aprovada) e baixado no celular: tem rosto e voz do dono,
// por isso não fica neste repositório público. Aqui é só escolher e lançar.
const LEGENDA_PROPAGANDA = `Atrasado, reunião, almoço correndo, academia… e o post de hoje? 😅

Com o Jarvis Social você escolhe o vídeo, a legenda e o horário pelo celular, e ele publica no Instagram na hora certa. Na correria, o Jarvis posta por você. 🚀

Quer usar? Comenta JARVIS ou chama no direct.

#jarvissocial #instagram #reels #produtividade #criadordeconteudo`;
function abrirPropaganda() {
  const demo = cli.modo === "demonstracao";
  abrirFolha(`<h2>📣 Lançar propaganda no Reels</h2>
    <p class="fraco">Escolha o vídeo da propaganda (o MP4 do Jarvis, salvo no celular) e, se quiser, a capa. A legenda já vem pronta.</p>
    <label for="pp-video">Vídeo da propaganda (MP4 ou MOV)</label><input id="pp-video" type="file" accept="video/mp4,video/quicktime,video/*">
    <label for="pp-capa">Capa (opcional, JPG ou PNG)</label><input id="pp-capa" type="file" accept="image/jpeg,image/png">
    <label for="pp-legenda">Legenda</label><textarea id="pp-legenda" maxlength="2200">${esc(LEGENDA_PROPAGANDA)}</textarea>
    ${seletorConta("tp-conta")}
    <div class="faixa ${demo ? "demo" : "erro"}">${demo ? "DEMONSTRAÇÃO: tudo simulado neste aparelho; nada vai ao Instagram." : "Publica DE VERDADE agora no perfil escolhido. Para programar outro horário, use o Novo Reel."}</div>
    <div id="tp-etapas"></div><div id="tp-fim"></div>
    <button class="primario grande" id="tp-ir">${demo ? "Lançar (simulado)" : "Lançar agora"}</button>
    <button class="grande" id="tp-fechar" style="margin-top:8px">Fechar</button>`);
  $("#tp-fechar").onclick = () => { fecharFolha(); mostrar(); };
  $("#tp-ir").onclick = () => {
    const video = $("#pp-video").files[0];
    if (!video) return alert("Escolha o vídeo da propaganda.");
    const capa = $("#pp-capa").files[0] || null;
    rodarTestePublicacao($("#tp-conta") && $("#tp-conta").value, { arquivos: { video, capa }, legenda: $("#pp-legenda").value, teste: false, nome: "a propaganda" });
  };
}

// ------------------------------------------------------------------ chaves de integração e grade
const INSTRUCOES_GPT = `Você gerencia a grade de Reels do Instagram do dono pelo Jarvis Social.
Comece por verGrade. Datas no fuso America/Sao_Paulo (AAAA-MM-DD e HH:MM).
Para Reel novo use agendarReel com o link do vídeo (Drive "qualquer pessoa com o link", Dropbox ou MP4 direto). Arquivo anexado não é link: peça o link do Drive.
Antes de mudar a frequência, mostre previaFrequencia e só aplique com o OK do dono. Antes de cancelar ou publicar agora, confirme.
"Agendado no Jarvis" não é "publicado"; publicado só com permalink. Responda em português, curto, com horários e estado de cada post.`;
// Botões "Copiar ..." em qualquer tela.
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copiar]"); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copiar); const t = b.textContent; b.textContent = "Copiado ✓"; setTimeout(() => (b.textContent = t), 1500); }
  catch { prompt("Copie:", b.dataset.copiar); }
});

// Lista de configuração (dono/admin): o que falta para tudo funcionar sozinho.
async function cartaoConfiguracao() {
  if (!contaEstado || !["dono", "admin"].includes(eu.papel)) return "";
  let chaves = [];
  try { chaves = (await cli.chamar("GET", "/v1/chaves")).chaves.filter((k) => !k.revogado); } catch {}
  const itens = [
    [cli.modo === "servidor", "Servidor no ar", "Siga o passo 1 de docs/DEPLOY.md (um token do Supabase no GitHub).", null],
    [!!eu.instagram_configurado, "App da Meta configurado", "Ajustes › Instagram › Configurar o app da Meta", "#ajustes"],
    [eu.conexoes.some((c) => c.estado === "ativa"), "Instagram conectado", "Ajustes › Instagram › Conectar", "#ajustes"],
    [!!eu.org.piloto_automatico, "Piloto automático ligado", "Ajustes › Frequência › Piloto automático", "#ajustes"],
    [chaves.length > 0, "ChatGPT/Claude conectado", "Ajustes › Integrações › Criar chave", "#ajustes"],
    [chaves.some((k) => k.ultimo_uso), "Assistente já usou a chave", "Peça ao assistente: 'mostre a grade de Reels'", null],
  ];
  const feitos = itens.filter((x) => x[0]).length;
  if (feitos === itens.length) return "";
  return `<details class="cartao" ${feitos < 3 ? "open" : ""}><summary><strong>Configuração: ${feitos} de ${itens.length}</strong></summary>
    ${itens.map(([ok, nome, como, link]) => `<p>${ok ? "✅" : "⬜"} <strong>${esc(nome)}</strong>${ok ? "" : `<br><small class="fraco">${link ? `<a href="${link}">${esc(como)}</a>` : esc(como)}</small>`}</p>`).join("")}</details>`;
}
async function desenharChaves() {
  const alvo = $("#chaves"); if (!alvo) return;
  try {
    const { chaves } = await cli.chamar("GET", "/v1/chaves");
    const data = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "nunca");
    alvo.innerHTML = chaves.length ? chaves.map((k) => `<div class="item" style="margin:8px 0;align-items:center"><div class="texto"><strong>${esc(k.nome)}</strong> <small>${esc(k.prefixo)}…</small><br>
      <small>${k.revogado ? "revogada" : `${k.escopos.includes("programar") ? "ler e programar" : "só ler"} · vence ${data(k.expira_em)} · último uso ${data(k.ultimo_uso)}`}</small></div>
      ${k.revogado ? "" : `<button class="perigo" data-revogar="${esc(k.id)}">Revogar</button>`}</div>`).join("") : `<p class="fraco">Nenhuma chave ainda.</p>`;
    alvo.querySelectorAll("[data-revogar]").forEach((b) => (b.onclick = async () => { if (!confirm("Revogar esta chave? O assistente perde o acesso na hora.")) return; await cli.chamar("POST", `/v1/chaves/${b.dataset.revogar}/revogar`); desenharChaves(); }));
  } catch (err) { alvo.innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
}

async function abrirGrade() {
  const g = await cli.chamar("GET", "/v1/grade", null, { dias: 14 });
  let dia = "";
  const linhas = g.grade.map((s) => { const cab = s.data !== dia ? `<div class="dia">${esc(NOMES_DIA_LONGO[s.diaSemana])}, ${s.data.split("-").reverse().join("/")}</div>` : ""; dia = s.data;
    return cab + `<p>${esc(s.hora)} — ${s.post ? `${selo(s.post)} ${esc(s.post.legenda || "(sem legenda)")}` : `<span class="fraco">livre</span>`}</p>`; }).join("");
  abrirFolha(`<h2>Grade dos próximos ${g.dias} dias</h2>
    <p>${g.politica.horarios.length} por dia (${esc(g.politica.horarios.join(", "))}) · <strong>${g.livres}</strong> livre(s) · <strong>${g.ocupados}</strong> ocupado(s) · ${g.rascunhos_esperando} rascunho(s) esperando</p>
    ${g.fila_pausada ? `<div class="faixa">A fila está pausada.</div>` : ""}
    ${g.rascunhos_esperando ? `<button class="primario" id="preencher" style="width:100%">Preencher a grade com os ${g.rascunhos_esperando} rascunho(s)</button><div id="preencher-msg"></div>` : ""}
    <div class="cartao">${linhas || `<p class="fraco">Sem horários na frequência atual.</p>`}</div>
    ${g.fora_da_grade.length ? `<h3>Fora da grade (horário escolhido à mão)</h3>${g.fora_da_grade.map((s) => `<p>${s.data.split("-").reverse().join("/")} ${esc(s.hora)} — ${selo(s.post)} ${esc(s.post.legenda)}</p>`).join("")}` : ""}
    <button class="grande" id="fechar-grade" style="margin-top:8px">Fechar</button>`);
  $("#fechar-grade").onclick = () => { fecharFolha(); mostrar(); };
  $("#preencher") && ($("#preencher").onclick = async () => {
    try { const r = await cli.chamar("POST", "/v1/grade/preencher", {}); fecharFolha(); await abrirGrade(); $("#folha-conteudo").insertAdjacentHTML("afterbegin", `<div class="faixa ok">${r.programados.length} programado(s)${r.erros.length ? `, ${r.erros.length} com erro` : ""}.</div>`); }
    catch (err) { $("#preencher-msg").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
  });
}

// ------------------------------------------------------------------ painel de usuários (só o dono)
const FILTROS_CONTA = [["todos", "Todas"], ["aguardando", "Aguardando"], ["liberados", "Liberados"], ["online", "Online"], ["sumidos", "Sumidos"], ["prazo", "Prazo"], ["bloqueados", "Bloqueados"], ["pagar", "Precisa pagar"], ["pagantes", "Pagantes"], ["cortesia", "Cortesia"], ["automaticos", "Automáticos"]];
function baixarArquivo(nome, texto) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" })); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
telas.usuarios = async (el, filtro = ls.ler("jarvis-social:filtroUsuarios", "todos"), busca = "") => {
  const [res, lst, pgs] = await Promise.all([
    cli.chamar("GET", "/v1/admin/resumo"),
    cli.chamar("GET", "/v1/admin/contas", null, { filtro, busca }),
    cli.chamar("GET", "/v1/admin/pagamentos"),
  ]);
  const N = res.numeros, cfg = res.config;
  const data = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
  const informados = pgs.pagamentos.filter((p) => p.status === "informado");
  el.innerHTML = `${faixaModo()}<h1>Painel de usuários</h1>
    <div class="chips">${[["aguardando", N.aguardando], ["liberados", N.liberados], ["online", N.online], ["bloqueados", N.bloqueados], ["prazo", N.prazo], ["pagar", N.pagar]].map(([f, v]) => `<button class="chip ${f === filtro ? "ativo" : ""}" data-f="${f}"><strong>${v}</strong>&nbsp;${esc(FILTROS_CONTA.find((x) => x[0] === f)[1])}</button>`).join("")}</div>
    ${informados.length ? `<div class="cartao"><h2>Pagamentos para confirmar (${informados.length})</h2>${informados.map((p) => `<div class="item" style="margin:8px 0"><div class="texto"><strong>${esc(p.nome || p.email)}</strong> · ${esc(p.plano)} · ${reais(p.valor)}<br><small>código ${esc(p.txid)} · ${data(p.criado_em)}</small></div></div>
      <div class="linha"><button class="primario" data-pg="${esc(p.id)}" data-pga="confirmar">Confirmar (achei no extrato)</button><button class="perigo" data-pg="${esc(p.id)}" data-pga="recusar">Recusar</button></div>`).join("")}</div>` : ""}
    <div class="cartao"><h2>Como entram as contas novas</h2>
      <label style="display:flex;gap:10px"><input type="checkbox" id="cfg-auto" ${cfg.auto ? "checked" : ""}>Aprovação automática (o cadastro já entra liberado)</label>
      ${N.aguardando ? `<button id="liberar-todos" style="width:100%;margin-top:8px">Liberar todos que aguardam (${N.aguardando})</button>` : ""}
      ${cli.modo === "demonstracao" ? `<button id="demo-cadastro" style="width:100%;margin-top:8px">Simular um cadastro novo (demonstração)</button>` : ""}</div>
    <div class="cartao"><h2>Cobrança</h2>
      <label style="display:flex;gap:10px"><input type="checkbox" id="cfg-cob" ${cfg.ligada ? "checked" : ""}>Cobrança ligada (quem não tem plano, cortesia ou teste vê a tela de planos)</label>
      <label for="cfg-teste">Dias de teste grátis</label><input id="cfg-teste" type="number" inputmode="numeric" min="0" max="60" value="${cfg.testeDias}">
      <h3>Planos</h3>${cfg.planos.map((p) => `<div class="linha" style="margin:6px 0" data-planoed="${esc(p.id)}"><label style="flex:1 1 100%;margin:0;display:flex;gap:8px"><input type="checkbox" data-k="ativo" ${p.ativo ? "checked" : ""}>${esc(p.nome)}</label>
        <label style="flex:1;margin:0;font-weight:500">R$<input data-k="preco" type="number" inputmode="decimal" step="0.01" min="0" value="${p.preco}" aria-label="Preço de ${esc(p.nome)}"></label>${p.id !== "vitalicio" ? `<label style="flex:1;margin:0;font-weight:500">dias<input data-k="dias" type="number" inputmode="numeric" min="1" value="${p.dias}" aria-label="Dias de ${esc(p.nome)}"></label>` : `<span class="fraco" style="flex:1">sem prazo</span>`}</div>`).join("")}
      <h3>Pix</h3><label for="cfg-pix">Chave Pix</label><input id="cfg-pix" value="${esc(cfg.pix.chave)}" autocomplete="off">
      <div class="linha"><div style="flex:1"><label for="cfg-pixnome">Nome</label><input id="cfg-pixnome" value="${esc(cfg.pix.nome)}"></div><div style="flex:1"><label for="cfg-pixcid">Cidade</label><input id="cfg-pixcid" value="${esc(cfg.pix.cidade)}"></div></div>
      <div id="cfg-msg"></div><button class="primario" id="cfg-salvar" style="width:100%;margin-top:8px">Salvar cobrança</button>
      <p class="fraco">Recebido no mês: ${reais(pgs.recebido_mes)} · no ano: ${reais(pgs.recebido_ano)}. <a href="#" id="csv-pg">Baixar pagamentos</a></p></div>
    <h2>Contas</h2>
    <div class="chips">${FILTROS_CONTA.map(([f, n]) => `<button class="chip ${f === filtro ? "ativo" : ""}" data-f="${f}">${esc(n)}</button>`).join("")}</div>
    <input id="busca" type="search" placeholder="Buscar nome, e-mail ou nota" value="${esc(busca)}"><button id="csv-contas" style="width:100%;margin-top:8px">Baixar planilha das contas</button>
    ${lst.contas.length ? lst.contas.map((c) => `<div class="cartao" data-conta="${esc(c.id)}"><p><strong>${esc(c.nome || "(sem nome)")}</strong> ${c.online ? `<span class="selo published">online</span>` : ""} <span class="selo ${c.situacao === "liberado" ? "scheduled" : c.situacao === "pendente" ? "paused" : "failed"}">${esc(NOMES_SITUACAO[c.situacao])}</span></p>
      <p class="fraco">${esc(c.email)} · cadastro ${data(c.criado_em)} · último acesso ${data(c.ultimo_acesso)} · ${c.acessos || 0} acesso(s)</p>
      <p>Plano: ${esc(c.plano_texto)}${c.ate ? ` · liberado até ${data(c.ate)}` : ""}${c.entrou_auto ? " · entrou pela aprovação automática" : ""}</p>
      ${c.motivo ? `<p class="fraco">Motivo do bloqueio: ${esc(c.motivo)}</p>` : ""}${c.nota ? `<p class="fraco">Nota: ${esc(c.nota)}</p>` : ""}
      <button data-gerir="${esc(c.id)}" style="width:100%">Gerenciar</button></div>`).join("") : `<p class="fraco">Nenhuma conta neste filtro.</p>`}`;

  const recarregar = (f = filtro, b = busca) => telas.usuarios(el, f, b);
  el.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { ls.gravar("jarvis-social:filtroUsuarios", b.dataset.f); recarregar(b.dataset.f, ""); }));
  let tb; $("#busca").oninput = (e) => { clearTimeout(tb); tb = setTimeout(() => recarregar(filtro, e.target.value), 400); };
  $("#csv-contas").onclick = async () => { const r = await cli.chamar("GET", "/v1/admin/contas", null, { filtro, busca, formato: "csv" }); baixarArquivo(r.nome, r.csv); };
  $("#csv-pg").onclick = async (e) => { e.preventDefault(); const r = await cli.chamar("GET", "/v1/admin/pagamentos", null, { formato: "csv" }); baixarArquivo(r.nome, r.csv); };
  $("#cfg-auto").onchange = async (e) => { await cli.chamar("PUT", "/v1/admin/config", { auto: e.target.checked }); };
  $("#liberar-todos") && ($("#liberar-todos").onclick = async () => { if (!confirm(`Liberar ${N.aguardando} conta(s) sem prazo?`)) return; await cli.chamar("POST", "/v1/admin/liberar-todos", {}); recarregar(); });
  $("#demo-cadastro") && ($("#demo-cadastro").onclick = async () => { await cli.chamar("POST", "/v1/admin/demo-cadastro", {}); recarregar("aguardando"); });
  $("#cfg-salvar").onclick = async () => {
    const ligar = $("#cfg-cob").checked;
    const planos = [...el.querySelectorAll("[data-planoed]")].map((d) => ({ id: d.dataset.planoed, ativo: d.querySelector('[data-k="ativo"]').checked, preco: +d.querySelector('[data-k="preco"]').value, ...(d.querySelector('[data-k="dias"]') ? { dias: +d.querySelector('[data-k="dias"]').value } : {}) }));
    if (ligar && !cfg.ligada && !confirm(`Ligar a cobrança? Quem não tem plano, cortesia ou teste (${$("#cfg-teste").value} dias a partir de hoje) passa a ver a tela de planos.`)) return;
    try {
      const r = await cli.chamar("PUT", "/v1/admin/config", { cobranca: ligar, teste_dias: +$("#cfg-teste").value, planos, pix_chave: $("#cfg-pix").value, pix_nome: $("#cfg-pixnome").value, pix_cidade: $("#cfg-pixcid").value });
      $("#cfg-msg").innerHTML = `<div class="faixa ok">Salvo.${r.config.ligada ? ` Contas que precisam de plano agora: ${r.contas_sem_plano_agora}.` : ""}${r.pix_exemplo ? `<br>Pix de R$ 1,00 para conferir no seu banco:<br><small style="word-break:break-all">${esc(r.pix_exemplo)}</small>` : r.config.ligada ? "<br>Sem chave Pix: quem for pagar não terá o código." : ""}</div>`;
    } catch (err) { $("#cfg-msg").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
  };
  el.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = async () => {
    const acao = b.dataset.pga; let motivo;
    if (acao === "recusar") { motivo = prompt("Motivo (a pessoa vê):", "Pagamento não encontrado no extrato"); if (motivo === null) return; }
    else if (!confirm("Confirmar este pagamento? O acesso da pessoa é liberado pelo período do plano.")) return;
    try { await cli.chamar("POST", `/v1/admin/pagamentos/${b.dataset.pg}`, { acao, motivo }); contaEstado = await cli.chamar("GET", "/v1/conta"); recarregar(); } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll("[data-gerir]").forEach((b) => (b.onclick = () => gerirConta(lst.contas.find((c) => c.id === b.dataset.gerir), cfg, () => recarregar())));
};

function gerirConta(c, cfg, aoMudar) {
  const prazos = PRAZOS_ACESSO.map((p) => `<option value="${p.dias}">${esc(p.nome)}</option>`).join("");
  abrirFolha(`<h2>${esc(c.nome || c.email)}</h2><p class="fraco">${esc(c.email)} · ${esc(NOMES_SITUACAO[c.situacao])} · ${esc(c.plano_texto)}</p>
    <label for="g-prazo">Prazo de acesso</label><select id="g-prazo">${prazos}</select>
    <div class="linha" style="margin-top:8px">${c.situacao === "bloqueado" ? `<button class="primario" data-a="desbloquear">Desbloquear</button>` : `<button class="primario" data-a="liberar">${c.situacao === "pendente" ? "Liberar" : "Liberar / mudar prazo"}</button>`}
      ${c.situacao === "vencido" ? `<button data-a="renovar">Renovar</button>` : ""}${c.situacao !== "bloqueado" ? `<button class="perigo" data-a="bloquear">Bloquear</button>` : ""}</div>
    <h3>Recado (a pessoa vê uma vez)</h3><textarea id="g-recado" style="min-height:70px">${esc(c.aviso || "")}</textarea><button data-a="recado">Enviar recado</button>
    <h3>Nota (só você vê)</h3><textarea id="g-nota" style="min-height:70px">${esc(c.nota || "")}</textarea><button data-a="nota">Salvar nota</button>
    <h3>Plano</h3><div class="linha">${c.cortesia ? `<button data-a="tirar_cortesia">Tirar cortesia</button>` : `<button data-a="cortesia">Dar cortesia (usa o prazo acima)</button>`}</div>
    <label for="g-plano">Registrar pagamento recebido por fora</label><div class="linha"><select id="g-plano" style="flex:1">${cfg.planos.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} — ${reais(p.preco)}</option>`).join("")}</select><button data-a="registrar_pagamento">Registrar</button></div>
    <h3>Mais</h3><div class="linha">${cli.modo === "servidor" ? `<button data-a="link_senha">Mandar link de nova senha</button>` : ""}<button class="perigo" data-a="remover">Remover da lista</button></div>
    <div id="g-msg"></div><button class="grande" id="g-fechar" style="margin-top:12px">Fechar</button>`);
  $("#g-fechar").onclick = fecharFolha;
  $("#folha-conteudo").querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
    const acao = b.dataset.a; const corpo = { acao, dias: +$("#g-prazo").value };
    if (acao === "bloquear") { const m = prompt("Motivo do bloqueio (a pessoa vê):", ""); if (m === null) return; corpo.motivo = m; }
    if (acao === "recado") corpo.texto = $("#g-recado").value;
    if (acao === "nota") corpo.texto = $("#g-nota").value;
    if (acao === "cortesia") { const m = prompt("Motivo da cortesia (opcional):", ""); if (m === null) return; corpo.motivo = m; }
    if (acao === "registrar_pagamento") corpo.plano = $("#g-plano").value;
    if (acao === "remover" && !confirm("Remover da lista? Se a pessoa entrar de novo, volta como cadastro aguardando. Para barrar de vez, bloqueie.")) return;
    try { const r = await cli.chamar("POST", `/v1/admin/contas/${c.id}`, corpo); fecharFolha(); if (r.aviso) alert(r.aviso); aoMudar(); }
    catch (err) { $("#g-msg").innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div>`; }
  }));
}

// ------------------------------------------------------------------ roteamento
async function mostrar() {
  const el = $("#tela");
  const [rota, arg] = location.hash.replace(/^#/, "").split("?")[0].split("/");
  const aba = ["inicio", "criar", "agenda", "biblioteca", "ajustes"].includes(rota) ? rota : rota === "post" ? "agenda" : ["usuarios", "planos"].includes(rota) ? "ajustes" : "inicio";
  document.querySelectorAll("nav.barra a").forEach((a) => { const at = a.dataset.aba === aba; a.classList.toggle("ativo", at); at ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  try {
    if (rota === "post" && arg) await telas.post(el, arg);
    else if (rota === "usuarios" && contaEstado && contaEstado.dono) await telas.usuarios(el);
    else if (rota === "planos") await telas.planos(el, contaEstado, { dentro: true });
    else await telas[aba](el);
  } catch (err) {
    el.innerHTML = `${faixaModo()}<div class="faixa erro">${mensagemErro(err)}</div><button id="tentar">Tentar de novo</button>`;
    $("#tentar").onclick = () => iniciar();
  }
}

async function iniciar() {
  const el = $("#tela");
  const barra = document.querySelector("nav.barra");
  clearTimeout(pararEspera.t);
  topo(true);
  if (cli.modo === "servidor" && !cli.usuario()) { barra.classList.add("oculto"); return telas.entrar(el); }
  // O porteiro: a situação da conta vem do servidor, que é quem decide.
  try { contaEstado = await cli.chamar("GET", "/v1/conta"); }
  catch (err) {
    if (err.status === 401) { cli.sair(); return iniciar(); }
    el.innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div><button onclick="location.reload()">Tentar de novo</button>`;
    return;
  }
  const fase = { pendente: telas.aguardando, bloqueado: telas.bloqueado, vencido: telas.vencido, pagar: telas.planos }[contaEstado.situacao];
  if (fase) { barra.classList.add("oculto"); return fase(el, contaEstado); }
  if (!contaEstado.termos.aceito) { barra.classList.add("oculto"); return telas.termos(el, contaEstado); }
  mostrarRecado(contaEstado);
  try { eu = await cli.chamar("GET", "/v1/eu"); }
  catch (err) {
    if (err.erro === "sem_organizacao") {
      if (cli.modo === "demonstracao") { await cli.chamar("POST", "/v1/organizacoes", { nome: "Demonstração" }); await cli.chamar("POST", "/v1/instagram/conectar"); return iniciar(); }
      document.querySelector("nav.barra").classList.add("oculto"); return telas.novoEspaco(el);
    }
    if (err.status === 401) { cli.sair(); return iniciar(); }
    el.innerHTML = `<div class="faixa erro">${mensagemErro(err)}</div><button onclick="location.reload()">Tentar de novo</button>`;
    return;
  }
  document.querySelector("nav.barra").classList.remove("oculto");
  topo(true);
  await mostrar();
}

// ------------------------------------------------------------------ abertura
// O personagem correndo pelo dia e trocando de roupa, até o logo. Vídeo mudo
// (toca sozinho no celular), uma vez por sessão, com Pular. Termina em
// qualquer erro, em 12 s ou se não começar em 4 s. Movimento reduzido: não toca.
const VIDEO_ABERTURA = "abertura-v2.mp4";
function abertura() {
  return new Promise((pronto) => {
    let ja = false; try { ja = sessionStorage.getItem("jarvis-social:abertura") === "1"; } catch {}
    if (ja || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return pronto();
    try { sessionStorage.setItem("jarvis-social:abertura", "1"); } catch {}
    const el = document.createElement("div"); el.id = "abertura"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Abertura do Jarvis Social");
    el.innerHTML = `<video muted playsinline autoplay preload="auto" poster="abertura-v2-poster.jpg" src="${VIDEO_ABERTURA}"></video><button type="button">Pular ›</button>`;
    document.body.appendChild(el);
    const v = el.querySelector("video"); let fim = false;
    const fechar = () => { if (fim) return; fim = true; el.remove(); pronto(); };
    el.querySelector("button").onclick = fechar; el.querySelector("button").focus();
    v.onended = fechar; v.onerror = fechar;
    setTimeout(() => { if (v.currentTime === 0) fechar(); }, 4000);
    setTimeout(fechar, 12000);
    v.play && v.play().catch(fechar);
  });
}

window.addEventListener("hashchange", mostrar);
// Voltou do segundo plano: relê o estado do servidor antes de qualquer reenvio.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !eu) return;
  try {
    // É assim que um bloqueio alcança quem está com o painel aberto.
    const est = await cli.chamar("GET", "/v1/conta");
    if (est.situacao !== "liberado" || !est.termos.aceito) return iniciar();
    contaEstado = est;
    eu = await cli.chamar("GET", "/v1/eu"); if (!location.hash.startsWith("#criar")) mostrar();
  } catch {}
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
abertura().then(iniciar);
