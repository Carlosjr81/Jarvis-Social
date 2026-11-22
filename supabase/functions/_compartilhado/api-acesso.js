// Contas da plataforma: cadastro com aprovação, termos, prazos, cobrança por
// Pix e o painel do dono. Mesmo desenho do Treino Livre, mas a decisão é da
// API (servidor): ninguém entra pulando a tela numa cópia do site.
//
// Rotas: /v1/conta/*  (a própria pessoa)   /v1/admin/*  (só o dono)
import {
  lerCobranca, planoDaConta, situacaoConta, textoPlano, planosAtivos, planoPorId, prazoAte,
  acessoPago, acessoDevolvido, pixCopiaECola, txidPagamento, csvContas, csvPagamentos, ONLINE_MS, SUMIDO_MS, NOMES_SITUACAO,
} from "./acesso.js";
import { TERMOS, CONDICOES_ASSINATURA } from "./termos.js";
import { sha256Hex } from "./cifra.js";

export class ErroAcesso extends Error {
  constructor(status, codigo, mensagem, extra = {}) { super(mensagem); this.status = status; this.codigo = codigo; this.extra = extra; }
}
const falha = (s, c, m, e) => { throw new ErroAcesso(s, c, m, e); };
const ID_CONFIG = "acesso";

export async function impressaoTermos() { return sha256Hex(JSON.stringify(TERMOS)); }

export function criarAcesso({ banco, agora, segredos = {}, demonstracao = false, autenticacao = null }) {
  const donos = (segredos.emailsDono || []).map((e) => e.toLowerCase());
  const ehDono = (u) => !!(u && u.email && donos.includes(String(u.email).toLowerCase()) && u.email_confirmado);

  async function config() {
    return (await banco.obter("config_plataforma", ID_CONFIG)) || { id: ID_CONFIG };
  }

  // Lê (ou cria) a conta de quem chamou e devolve a situação de agora.
  async function verificar(usuario, { registrarAcesso = false } = {}) {
    if (!usuario || !usuario.id) falha(401, "nao_autenticado", "Entre na sua conta.");
    const dono = ehDono(usuario);
    const cfg = await config();
    const cob = lerCobranca(cfg);
    let conta = await banco.obter("contas", usuario.id);
    const t = agora();
    if (!conta) {
      const auto = !!cfg.auto;
      try {
        conta = await banco.inserir("contas", {
          id: usuario.id, email: String(usuario.email || "").toLowerCase(), nome: String(usuario.nome || "").slice(0, 80),
          status: dono || auto ? "liberado" : "pendente", entrou_auto: !dono && auto, criado_em: t, ultimo_acesso: t, acessos: 1,
        });
      } catch { conta = await banco.obter("contas", usuario.id); }
    } else if (registrarAcesso && (!conta.ultimo_acesso || Date.parse(t) - Date.parse(conta.ultimo_acesso) > 10 * 60e3)) {
      conta = (await banco.atualizar("contas", conta.id, { ultimo_acesso: t, acessos: (conta.acessos || 0) + 1 })) || conta;
    }
    const situacao = situacaoConta(conta, t, cob, dono);
    const termosOk = dono || conta.termos_versao === TERMOS.versao;
    return { conta, situacao, dono, cob, cfg, termosOk };
  }

  // Portão das rotas do produto: liberado (ou dono) e termos aceitos.
  async function exigirLiberado(usuario) {
    const v = await verificar(usuario);
    if (v.situacao !== "liberado") falha(403, "acesso_" + v.situacao, {
      pendente: "Seu cadastro está aguardando a aprovação.", bloqueado: "Seu acesso está bloqueado.",
      vencido: "Seu prazo de acesso venceu.", pagar: "Escolha um plano para continuar.",
    }[v.situacao] || "Sem acesso.");
    if (!v.termosOk) falha(403, "termos_pendentes", "Aceite os Termos de Uso para continuar.");
    return v;
  }

  const publico = (c) => { if (!c) return null; const { nota, ...r } = c; return r; };
  function cobrancaPublica(cob) {
    return { ligada: cob.ligada, testeDias: cob.testeDias, planos: planosAtivos(cob), pix: cob.pix.chave ? cob.pix : null, condicoes: CONDICOES_ASSINATURA };
  }
  async function estadoConta(usuario) {
    const v = await verificar(usuario, { registrarAcesso: true });
    const t = agora();
    const plano = planoDaConta(v.conta, t, v.cob, v.dono);
    const r = {
      conta: publico(v.conta), situacao: v.situacao, situacao_texto: NOMES_SITUACAO[v.situacao], dono: v.dono,
      plano: { ...plano, texto: textoPlano(plano, v.cob) },
      termos: { versao: TERMOS.versao, aceito: v.termosOk, texto: TERMOS },
      cobranca: cobrancaPublica(v.cob),
      recado: v.conta.aviso && (!v.conta.aviso_visto || v.conta.aviso_visto < v.conta.aviso_em) ? { texto: v.conta.aviso, em: v.conta.aviso_em } : null,
      email_confirmado: !!usuario.email_confirmado,
    };
    if (v.dono) {
      const todas = await banco.listar("contas", {});
      r.avisos_dono = {
        aguardando: todas.filter((c) => situacaoConta(c, t, v.cob) === "pendente").length,
        pagamentos: (await banco.listar("pagamentos", { status: "informado" })).length,
      };
    }
    if (donos.length && donos.includes(String(usuario.email || "").toLowerCase()) && !usuario.email_confirmado) {
      r.aviso_dono = "Confirme o seu e-mail (link enviado no cadastro) para entrar como dono.";
    }
    return r;
  }

  // ------------------------------------------------ a própria pessoa
  async function rotaConta(M, sub, corpo, usuario) {
    if (!sub && M === "GET") return estadoConta(usuario);
    const v = await verificar(usuario);
    const t = agora();
    if (!sub && M === "PUT") {
      return { conta: publico(await banco.atualizar("contas", v.conta.id, { nome: String(corpo.nome || "").slice(0, 80) })) };
    }
    if (sub === "termos" && M === "POST") {
      if (corpo.versao !== TERMOS.versao) falha(409, "termos_desatualizados", "Os termos mudaram. Recarregue e leia de novo.");
      if (!corpo.caixas || corpo.caixas.length !== TERMOS.caixas.length || !corpo.caixas.every(Boolean)) falha(400, "caixas", "Marque as caixas para aceitar.");
      const hash = await impressaoTermos();
      // O histórico de aceites é só de inclusão: ninguém altera nem apaga pelo app.
      await banco.inserir("aceites", { conta_id: v.conta.id, email: v.conta.email, nome: v.conta.nome, versao: TERMOS.versao, hash, de: corpo.de || "tela", navegador: String(corpo.navegador || "").slice(0, 200), em: t });
      return { conta: publico(await banco.atualizar("contas", v.conta.id, { termos_versao: TERMOS.versao, termos_em: t })) };
    }
    if (sub === "recado-visto" && M === "POST") {
      return { conta: publico(await banco.atualizar("contas", v.conta.id, { aviso_visto: t })) };
    }
    if (sub === "pagamentos" && M === "GET") {
      return { pagamentos: await banco.listar("pagamentos", { conta_id: v.conta.id }, { ordem: "criado_em", desc: true }) };
    }
    if (sub === "pagamentos" && M === "POST") {
      if (!v.cob.ligada) falha(409, "cobranca_desligada", "Não há cobrança ativa agora.");
      const plano = planoPorId(v.cob, corpo.plano);
      if (!plano || !plano.ativo || !(plano.preco > 0)) falha(400, "plano_invalido", "Plano indisponível.");
      if (!corpo.condicoes) falha(400, "condicoes", "Aceite as condições do plano.");
      const abertos = await banco.listar("pagamentos", { conta_id: v.conta.id, status: "informado" });
      if (abertos.length >= 3) falha(429, "muitos_avisos", "Você já tem pagamentos aguardando confirmação.");
      const pg = await banco.inserir("pagamentos", {
        conta_id: v.conta.id, email: v.conta.email, nome: v.conta.nome, plano: plano.id, valor: plano.preco, dias: plano.dias,
        txid: txidPagamento(v.conta.id, t), status: "informado", condicoes: CONDICOES_ASSINATURA, criado_em: t,
      });
      const pix = v.cob.pix.chave ? pixCopiaECola({ ...v.cob.pix, valor: plano.preco, txid: pg.txid }) : null;
      return { pagamento: pg, pix, link: plano.link || null };
    }
    if (sub === "apagar" && M === "POST") {
      if (v.dono) falha(409, "dono", "A conta do dono não se apaga por aqui.");
      if (corpo.confirmar !== "APAGAR") falha(400, "confirmar", "Digite APAGAR para confirmar.");
      // Espaços em que a pessoa é a única integrante saem junto (posts, mídias, conexões).
      for (const m of await banco.listar("membros", { usuario_id: v.conta.id })) {
        const outros = (await banco.listar("membros", { org_id: m.org_id })).filter((x) => x.usuario_id !== v.conta.id);
        if (!outros.length) {
          for (const tab of ["jobs", "eventos", "posts", "midias", "conexoes", "estados_oauth", "membros"]) await banco.apagar(tab, { org_id: m.org_id });
          await banco.apagar("organizacoes", { id: m.org_id });
        } else await banco.apagar("membros", { id: m.id });
      }
      await banco.apagar("contas", { id: v.conta.id });
      if (autenticacao && autenticacao.apagarUsuario) await autenticacao.apagarUsuario(v.conta.id);
      return { apagada: true };
    }
    falha(404, "rota", "Rota de conta desconhecida.");
  }

  // ------------------------------------------------ o painel do dono
  function filtrar(lista, filtro, busca, t, cob) {
    const agoraMs = Date.parse(t);
    const sit = (c) => situacaoConta(c, t, cob);
    const F = {
      todos: () => true,
      aguardando: (c) => sit(c) === "pendente",
      liberados: (c) => sit(c) === "liberado",
      online: (c) => c.ultimo_acesso && agoraMs - Date.parse(c.ultimo_acesso) < ONLINE_MS,
      sumidos: (c) => sit(c) === "liberado" && (!c.ultimo_acesso || agoraMs - Date.parse(c.ultimo_acesso) > SUMIDO_MS),
      prazo: (c) => sit(c) === "vencido" || (c.ate && Date.parse(c.ate) - agoraMs < 7 * 864e5),
      bloqueados: (c) => sit(c) === "bloqueado",
      pagar: (c) => sit(c) === "pagar",
      pagantes: (c) => ["pago", "vitalicio"].includes(planoDaConta(c, t, cob).tipo),
      cortesia: (c) => planoDaConta(c, t, cob).tipo === "cortesia",
      automaticos: (c) => !!c.entrou_auto,
    };
    const b = String(busca || "").toLowerCase().trim();
    return lista.filter(F[filtro] || F.todos).filter((c) => !b || [c.nome, c.email, c.nota].some((x) => String(x || "").toLowerCase().includes(b)));
  }

  async function rotaAdmin(M, partes, corpo, consulta, usuario) {
    const v = await verificar(usuario);
    if (!v.dono) falha(403, "so_dono", "Só o dono acessa o painel de usuários.");
    const t = agora();
    const [r1, r2, r3] = partes;
    const cob = v.cob;

    if (r1 === "resumo" && M === "GET") {
      const todas = await banco.listar("contas", {});
      const conta = (f) => filtrar(todas, f, "", t, cob).length;
      return {
        numeros: { todos: todas.length, aguardando: conta("aguardando"), liberados: conta("liberados"), online: conta("online"), sumidos: conta("sumidos"),
          prazo: conta("prazo"), bloqueados: conta("bloqueados"), pagar: conta("pagar"), pagantes: conta("pagantes"), cortesia: conta("cortesia") },
        pagamentos_informados: (await banco.listar("pagamentos", { status: "informado" })).length,
        config: { ...v.cfg, ...lerCobranca(v.cfg) },
      };
    }
    if (r1 === "contas" && !r2 && M === "GET") {
      const lista = filtrar(await banco.listar("contas", {}, { ordem: "criado_em", desc: true }), consulta.filtro, consulta.busca, t, cob);
      if (consulta.formato === "csv") return { csv: csvContas(lista, t, cob), nome: `contas-jarvis-social-${t.slice(0, 10)}.csv` };
      return { contas: lista.map((c) => { const p = planoDaConta(c, t, cob, donos.includes(c.email)); return { ...c, situacao: situacaoConta(c, t, cob, donos.includes(c.email)), plano_texto: textoPlano(p, cob), online: !!(c.ultimo_acesso && Date.parse(t) - Date.parse(c.ultimo_acesso) < ONLINE_MS) }; }) };
    }
    if (r1 === "contas" && r2 && M === "POST") {
      const c = await banco.obter("contas", r2);
      if (!c) falha(404, "conta", "Conta não encontrada.");
      if (donos.includes(c.email) && ["bloquear", "remover"].includes(corpo.acao)) falha(409, "dono", "Não dá para bloquear ou remover o dono.");
      const dec = { decidido_em: t };
      const dias = +corpo.dias || 0;
      let m;
      switch (corpo.acao) {
        case "liberar": m = { status: "liberado", ate: prazoAte(dias, t), motivo: null, ...dec }; break;
        case "renovar": m = { status: "liberado", ate: prazoAte(dias, t), ...dec }; break;
        case "bloquear": m = { status: "bloqueado", motivo: String(corpo.motivo || "").slice(0, 300) || null, ...dec }; break;
        case "desbloquear": m = { status: "liberado", motivo: null, ...dec }; break;
        case "recado": m = { aviso: String(corpo.texto || "").slice(0, 500) || null, aviso_em: t }; break;
        case "nota": m = { nota: String(corpo.texto || "").slice(0, 1000) || null }; break;
        case "cortesia": m = { cortesia: true, cortesia_ate: prazoAte(dias, t), cortesia_motivo: String(corpo.motivo || "").slice(0, 200) || null }; break;
        case "tirar_cortesia": m = { cortesia: false, cortesia_ate: null, cortesia_motivo: null }; break;
        case "registrar_pagamento": {
          const plano = planoPorId(cob, corpo.plano);
          if (!plano) falha(400, "plano_invalido", "Plano desconhecido.");
          await banco.inserir("pagamentos", { conta_id: c.id, email: c.email, nome: c.nome, plano: plano.id, valor: corpo.valor != null ? +corpo.valor : plano.preco, dias: plano.dias,
            txid: txidPagamento(c.id, t), status: "confirmado", registrado_pelo_dono: true, criado_em: t, decidido_em: t });
          m = { ...acessoPago(c, plano, t), status: c.status === "bloqueado" ? c.status : "liberado" };
          break;
        }
        case "link_senha":
          if (!autenticacao || !autenticacao.enviarLinkSenha) falha(503, "indisponivel", "Envio de link indisponível neste modo.");
          await autenticacao.enviarLinkSenha(c.email);
          m = { senha_link_em: t };
          break;
        case "remover":
          await banco.apagar("contas", { id: c.id });
          return { removida: true, aviso: "A conta saiu da lista. Se a pessoa entrar de novo, volta como cadastro novo (aguardando). Para barrar de vez, bloqueie." };
        default: falha(400, "acao", "Ação desconhecida.");
      }
      return { conta: await banco.atualizar("contas", c.id, m) };
    }
    if (r1 === "liberar-todos" && M === "POST") {
      const pend = filtrar(await banco.listar("contas", {}), "aguardando", "", t, cob);
      for (const c of pend) await banco.atualizar("contas", c.id, { status: "liberado", ate: prazoAte(+corpo.dias || 0, t), decidido_em: t });
      return { liberadas: pend.length };
    }
    if (r1 === "config" && M === "PUT") {
      const atual = v.cfg;
      const m = { id: ID_CONFIG, atualizado_em: t };
      if (corpo.auto !== undefined) m.auto = !!corpo.auto;
      if (corpo.cobranca !== undefined) { m.cobranca = !!corpo.cobranca; if (m.cobranca && !atual.cobranca) m.cobranca_desde = t; }
      if (corpo.teste_dias !== undefined) m.teste_dias = Math.max(0, Math.min(60, Math.round(+corpo.teste_dias || 0)));
      if (corpo.planos !== undefined) m.planos = lerCobranca({ planos: corpo.planos }).planos;
      for (const k of ["pix_chave", "pix_nome", "pix_cidade"]) if (corpo[k] !== undefined) m[k] = String(corpo[k] || "").trim().slice(0, 77);
      const salvo = (await banco.obter("config_plataforma", ID_CONFIG)) ? await banco.atualizar("config_plataforma", ID_CONFIG, m) : await banco.inserir("config_plataforma", m);
      const cobNova = lerCobranca(salvo);
      const exemplo = cobNova.pix.chave ? pixCopiaECola({ ...cobNova.pix, valor: 1, txid: "TESTE" }) : null;
      const semPlano = cobNova.ligada ? (await banco.listar("contas", {})).filter((c) => situacaoConta(c, t, cobNova, donos.includes(c.email)) === "pagar").length : 0;
      return { config: { ...salvo, ...cobNova }, pix_exemplo: exemplo, contas_sem_plano_agora: semPlano };
    }
    if (r1 === "pagamentos" && !r2 && M === "GET") {
      const f = consulta.status ? { status: consulta.status } : {};
      const lista = await banco.listar("pagamentos", f, { ordem: "criado_em", desc: true, limite: 500 });
      if (consulta.formato === "csv") return { csv: csvPagamentos(lista), nome: `pagamentos-jarvis-social-${t.slice(0, 10)}.csv` };
      const mes = t.slice(0, 7), ano = t.slice(0, 4);
      const conf = lista.filter((p) => p.status === "confirmado");
      return { pagamentos: lista, recebido_mes: conf.filter((p) => (p.decidido_em || "").startsWith(mes)).reduce((s, p) => s + (+p.valor || 0), 0),
        recebido_ano: conf.filter((p) => (p.decidido_em || "").startsWith(ano)).reduce((s, p) => s + (+p.valor || 0), 0) };
    }
    if (r1 === "pagamentos" && r2 && M === "POST") {
      const pg = await banco.obter("pagamentos", r2);
      if (!pg) falha(404, "pagamento", "Pagamento não encontrado.");
      const c = await banco.obter("contas", pg.conta_id);
      if (corpo.acao === "confirmar") {
        const ok = await banco.atualizar("pagamentos", pg.id, { status: "confirmado", decidido_em: t }, { status: "informado" });
        if (!ok) falha(409, "ja_decidido", "Este pagamento já foi decidido.");
        // Os dias gravados no pagamento valem, não o plano de hoje.
        if (c) await banco.atualizar("contas", c.id, { ...acessoPago(c, { id: pg.plano, dias: pg.dias }, t), status: c.status === "bloqueado" ? "bloqueado" : "liberado", decidido_em: t });
        return { pagamento: ok };
      }
      if (corpo.acao === "recusar") {
        const ok = await banco.atualizar("pagamentos", pg.id, { status: "recusado", motivo: String(corpo.motivo || "").slice(0, 200) || null, decidido_em: t }, { status: "informado" });
        if (!ok) falha(409, "ja_decidido", "Este pagamento já foi decidido.");
        return { pagamento: ok };
      }
      if (corpo.acao === "devolver") {
        const ok = await banco.atualizar("pagamentos", pg.id, { status: "devolvido", decidido_em: t }, { status: "confirmado" });
        if (!ok) falha(409, "nao_confirmado", "Só um pagamento confirmado pode ser devolvido.");
        if (c) await banco.atualizar("contas", c.id, acessoDevolvido(c, pg, t));
        return { pagamento: ok };
      }
      falha(400, "acao", "Ação desconhecida.");
    }
    if (r1 === "aceites" && M === "GET") {
      return { aceites: await banco.listar("aceites", consulta.conta_id ? { conta_id: consulta.conta_id } : {}, { ordem: "em", desc: true, limite: 1000 }) };
    }
    if (r1 === "demo-cadastro" && M === "POST" && demonstracao) {
      const n = (await banco.listar("contas", {})).length;
      const nomes = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Rocha", "Elisa Prado"];
      const nome = nomes[n % nomes.length];
      return { conta: await banco.inserir("contas", { email: nome.split(" ")[0].toLowerCase() + n + "@exemplo.com", nome: nome + " (exemplo)", status: "pendente", criado_em: t, ultimo_acesso: t, acessos: 1 }) };
    }
    falha(404, "rota", "Rota do painel desconhecida.");
  }

  // Um espaço só publica enquanto alguém com papel de dono dele tem acesso.
  async function orgComAcesso(orgId) {
    const cfg = await config(); const cob = lerCobranca(cfg); const t = agora();
    for (const m of await banco.listar("membros", { org_id: orgId, papel: "dono" })) {
      const c = await banco.obter("contas", m.usuario_id);
      if (!c) continue; // conta removida da lista não sustenta o espaço
      if (situacaoConta(c, t, cob, donos.includes(c.email)) === "liberado") return true;
    }
    return false;
  }

  return { verificar, exigirLiberado, rotaConta, rotaAdmin, orgComAcesso, ehDono };
}
