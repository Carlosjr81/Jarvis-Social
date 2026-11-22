import { teste, igual, verdade, rodar } from "./base.mjs";
import { ambiente, A, B } from "./ambiente.mjs";
import { TERMOS } from "../supabase/functions/_compartilhado/termos.js";
import { crc16Pix, pixCopiaECola, situacaoConta, lerCobranca, sugerirEmail, prazoAte } from "../supabase/functions/_compartilhado/acesso.js";

const DONO = { id: "dono", email: "dono@x", email_confirmado: true };
const ANA = { id: "ana", email: "ana@x", nome: "Ana" };
const aceitar = (e, u) => e.chamar(u, "POST", "/v1/conta/termos", { versao: TERMOS.versao, caixas: TERMOS.caixas.map(() => true) });
const admin = (e, id, corpo) => e.chamar(DONO, "POST", `/v1/admin/contas/${id}`, corpo);
let n = 0; const chave = () => "ac" + (++n);

teste("cadastro novo nasce aguardando e não usa o produto", async () => {
  const e = ambiente();
  const c = (await e.chamar(ANA, "GET", "/v1/conta")).corpo;
  igual([c.situacao, c.dono, c.conta.nome], ["pendente", false, "Ana"]);
  igual((await e.chamar(ANA, "POST", "/v1/organizacoes", { nome: "x" })).corpo.erro, "acesso_pendente");
  igual((await e.chamar(ANA, "GET", "/v1/posts")).corpo.erro, "acesso_pendente");
});

teste("dono só com e-mail confirmado; sem isso é conta comum e recebe o aviso", async () => {
  const e = ambiente();
  const semConf = (await e.chamar({ id: "d2", email: "dono@x" }, "GET", "/v1/conta")).corpo;
  igual([semConf.dono, semConf.situacao], [false, "pendente"]); verdade(semConf.aviso_dono);
  const c = (await e.chamar(DONO, "GET", "/v1/conta")).corpo;
  igual([c.dono, c.situacao, c.plano.tipo], [true, "liberado", "dono"]);
});

teste("painel: só o dono; liberar por 30 dias, termos obrigatórios, aceite com impressão digital", async () => {
  const e = ambiente();
  await e.chamar(ANA, "GET", "/v1/conta");
  igual((await e.chamar(ANA, "GET", "/v1/admin/contas")).corpo.erro, "so_dono");
  const lista = (await e.chamar(DONO, "GET", "/v1/admin/contas", null, { filtro: "aguardando" })).corpo.contas;
  igual(lista.map((c) => c.email), ["ana@x"]);
  const lib = (await admin(e, "ana", { acao: "liberar", dias: 30 })).corpo.conta;
  igual(lib.ate, prazoAte(30, e.rel.t));
  igual((await e.chamar(ANA, "POST", "/v1/organizacoes", {})).corpo.erro, "termos_pendentes");
  igual((await e.chamar(ANA, "POST", "/v1/conta/termos", { versao: TERMOS.versao, caixas: [true, false] })).corpo.erro, "caixas");
  igual((await aceitar(e, ANA)).status, 200);
  igual((await e.chamar(ANA, "POST", "/v1/organizacoes", { nome: "Ana" })).status, 200);
  const ac = (await e.chamar(DONO, "GET", "/v1/admin/aceites")).corpo.aceites;
  igual([ac.length, ac[0].versao, ac[0].hash.length], [1, TERMOS.versao, 64]);
});

teste("prazo vencido barra; renovar devolve o acesso", async () => {
  const e = ambiente(); await e.chamar(ANA, "GET", "/v1/conta");
  await admin(e, "ana", { acao: "liberar", dias: 7 }); await aceitar(e, ANA);
  e.avancar(8 * 1440);
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.situacao, "vencido");
  igual((await e.chamar(ANA, "GET", "/v1/eu")).corpo.erro, "acesso_vencido");
  await admin(e, "ana", { acao: "renovar", dias: 30 });
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.situacao, "liberado");
});

teste("bloqueio com motivo (a pessoa vê) e nota (só o dono vê); recado aparece uma vez", async () => {
  const e = ambiente(); await e.chamar(ANA, "GET", "/v1/conta");
  await admin(e, "ana", { acao: "nota", texto: "cliente indicado" });
  await admin(e, "ana", { acao: "bloquear", motivo: "uso indevido" });
  const c = (await e.chamar(ANA, "GET", "/v1/conta")).corpo;
  igual([c.situacao, c.conta.motivo, c.conta.nota], ["bloqueado", "uso indevido", undefined]);
  await admin(e, "ana", { acao: "desbloquear" }); await admin(e, "ana", { acao: "recado", texto: "Bem-vinda!" });
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.recado.texto, "Bem-vinda!");
  await e.chamar(ANA, "POST", "/v1/conta/recado-visto"); e.avancar(1);
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.recado, null);
  igual((await e.chamar(DONO, "GET", "/v1/admin/contas", null, { busca: "indicado" })).corpo.contas.length, 1, "a busca acha pela nota");
});

teste("aprovação automática: cadastro já entra liberado e fica marcado", async () => {
  const e = ambiente();
  await e.chamar(DONO, "PUT", "/v1/admin/config", { auto: true });
  const c = (await e.chamar(ANA, "GET", "/v1/conta")).corpo;
  igual([c.situacao, c.conta.entrou_auto], ["liberado", true]);
  igual((await e.chamar(DONO, "GET", "/v1/admin/contas", null, { filtro: "automaticos" })).corpo.contas.length, 1);
});

teste("cobrança: teste de 7 dias, depois pagar; Pix com txid; dono confirma e soma 30 dias; devolver tira", async () => {
  const e = ambiente(); await e.chamar(ANA, "GET", "/v1/conta");
  await admin(e, "ana", { acao: "liberar" }); await aceitar(e, ANA);
  const cfg = (await e.chamar(DONO, "PUT", "/v1/admin/config", { cobranca: true, pix_chave: "chave@pix.com", pix_nome: "Carlos Jr", pix_cidade: "Jundiaí" })).corpo;
  verdade(cfg.pix_exemplo.startsWith("000201"));
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.plano.tipo, "teste");
  e.avancar(8 * 1440);
  const est = (await e.chamar(ANA, "GET", "/v1/conta")).corpo;
  igual(est.situacao, "pagar"); verdade(est.cobranca.planos.length >= 3);
  igual((await e.chamar(ANA, "GET", "/v1/posts")).corpo.erro, "acesso_pagar");
  const pg = (await e.chamar(ANA, "POST", "/v1/conta/pagamentos", { plano: "mensal", condicoes: true })).corpo;
  verdade(pg.pix.includes(pg.pagamento.txid), "txid no Pix");
  igual(crc16Pix(pg.pix.slice(0, -4)), pg.pix.slice(-4));
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.situacao, "pagar", "avisar não libera sozinho");
  igual((await e.chamar(DONO, "GET", "/v1/conta")).corpo.avisos_dono.pagamentos, 1);
  await e.chamar(DONO, "POST", `/v1/admin/pagamentos/${pg.pagamento.id}`, { acao: "confirmar" });
  igual((await e.chamar(DONO, "POST", `/v1/admin/pagamentos/${pg.pagamento.id}`, { acao: "confirmar" })).corpo.erro, "ja_decidido");
  const depois = (await e.chamar(ANA, "GET", "/v1/conta")).corpo;
  igual([depois.situacao, depois.plano.tipo], ["liberado", "pago"]);
  const hist = (await e.chamar(DONO, "GET", "/v1/admin/pagamentos")).corpo;
  igual(hist.recebido_mes, 49.9);
  await e.chamar(DONO, "POST", `/v1/admin/pagamentos/${pg.pagamento.id}`, { acao: "devolver" });
  e.avancar(1440); // os dias devolvidos saem; o que sobra é só até o fim de hoje
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.situacao, "pagar");
});

teste("cortesia e pagamento registrado à mão (vitalício) dispensam o plano", async () => {
  const e = ambiente(); await e.chamar(ANA, "GET", "/v1/conta"); await e.chamar(B, "GET", "/v1/conta");
  await admin(e, "ana", { acao: "liberar" }); await admin(e, "b", { acao: "liberar" });
  await e.chamar(DONO, "PUT", "/v1/admin/config", { cobranca: true, teste_dias: 0 });
  await admin(e, "ana", { acao: "cortesia", dias: 30, motivo: "parceria" });
  igual((await e.chamar(ANA, "GET", "/v1/conta")).corpo.plano.tipo, "cortesia");
  await admin(e, "b", { acao: "registrar_pagamento", plano: "vitalicio", valor: 999.9 });
  igual((await e.chamar(B, "GET", "/v1/conta")).corpo.plano.tipo, "vitalicio");
});

teste("worker não publica espaço de conta bloqueada; volta quando libera", async () => {
  const e = ambiente(); const { video } = await e.preparar(A);
  await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, legenda: "x", data: "2026-11-23", hora: "10:00", agendar: true, chave_idempotencia: chave() });
  await admin(e, "a", { acao: "bloquear", motivo: "teste" });
  e.rel.t = "2026-11-23T13:00:00.000Z";
  igual((await e.worker().rodar()).resultados[0].resultado, "acesso_suspenso");
  igual(e.ig.containers.size, 0);
});

teste("apagar a própria conta leva espaço, posts e mídias e a conta de login", async () => {
  const e = ambiente(); const { video } = await e.preparar(A);
  await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, legenda: "x", chave_idempotencia: chave() });
  igual((await e.chamar(A, "POST", "/v1/conta/apagar", { confirmar: "sim" })).corpo.erro, "confirmar");
  igual((await e.chamar(A, "POST", "/v1/conta/apagar", { confirmar: "APAGAR" })).status, 200);
  igual([(await e.banco.listar("posts", {})).length, (await e.banco.listar("midias", {})).length, (await e.banco.listar("organizacoes", {})).length, e.apagados[0]], [0, 0, 0, "a"]);
  igual((await e.banco.listar("aceites", {})).length, 0, "não havia aceite; o histórico de aceites não é apagado por aqui");
});

teste("planilha das contas com BOM e ponto e vírgula; link de senha pelo provedor", async () => {
  const e = ambiente(); await e.chamar(ANA, "GET", "/v1/conta");
  const csv = (await e.chamar(DONO, "GET", "/v1/admin/contas", null, { formato: "csv" })).corpo.csv;
  verdade(csv.startsWith("﻿Nome;E-mail;Situação")); verdade(csv.includes("ana@x"));
  await admin(e, "ana", { acao: "link_senha" }); igual(e.links, ["ana@x"]);
});

teste("Pix: CRC confere com o exemplo do manual do BCB", () => {
  const ex = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  igual(crc16Pix(ex), "1D3D");
  verdade(pixCopiaECola({ chave: "x@y.com", valor: 10 }).includes("540510.00"));
});
teste("cobrança desligada não muda ninguém; e-mail com domínio digitado errado", () => {
  igual(situacaoConta({ status: "liberado" }, "2026-11-22T00:00:00Z", lerCobranca({})), "liberado");
  igual(sugerirEmail("ana@hotmial.com"), "ana@hotmail.com"); igual(sugerirEmail("ana@empresa.com.br"), null);
});

teste("contas do Instagram: várias por espaço, padrão configurável, escolha por publicação", async () => {
  const e = ambiente(); const { org, video } = await e.preparar(A);
  const c1 = (await e.banco.listar("conexoes", { org_id: org.id }))[0];
  const c2 = await e.banco.inserir("conexoes", { org_id: org.id, rede: "instagram", ig_user_id: "2", usuario_rede: "outra", estado: "ativa", simulado: false, atualizado_em: e.rel.t });
  await e.chamar(A, "PUT", "/v1/organizacao", { conta_padrao_id: c2.id });
  let p = (await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, legenda: "x", chave_idempotencia: chave() })).corpo.post;
  igual(p.recibo.perfil, "@outra", "usa a padrão");
  p = (await e.chamar(A, "POST", "/v1/posts", { video_id: video.id, conta_id: c1.id, legenda: "y", chave_idempotencia: chave() })).corpo.post;
  igual(p.recibo.perfil, "@" + c1.usuario_rede, "escolhida no pedido");
  p = (await e.chamar(A, "PATCH", `/v1/posts/${p.id}`, { versao: p.versao, conta_id: c2.id })).corpo.post;
  igual(p.recibo.perfil, "@outra", "trocada na edição");
});

rodar("acesso: cadastro com aprovação, termos, prazos, cobrança Pix, painel do dono e contas");
