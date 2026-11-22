// Cadastro com aprovação, prazos, cobrança e Pix — as mesmas regras do
// Treino Livre (Porteiro, situacaoConta, planoDaConta, pixCopiaECola),
// adaptadas a um servidor de verdade: aqui quem decide é a API, não o
// aparelho, então o porteiro não dá para pular numa cópia do site.
import { localParaUtc, partesLocais, somarDias, FUSO_PADRAO } from "./tempo.js";

const ms = (v) => (v ? Date.parse(v) : 0);
export const ONLINE_MS = 15 * 60000;
export const SUMIDO_MS = 30 * 864e5;
export const TESTE_DIAS_PADRAO = 7;
export const PRAZOS_ACESSO = [
  { dias: 0, nome: "Sem prazo" }, { dias: 7, nome: "7 dias" }, { dias: 30, nome: "30 dias" },
  { dias: 90, nome: "90 dias" }, { dias: 365, nome: "1 ano" },
];
// Preços de partida: o dono muda no painel. Só valem com a cobrança ligada.
export const PLANOS_PADRAO = [
  { id: "mensal", nome: "Mensal", preco: 49.9, dias: 30, ativo: true, link: "" },
  { id: "anual", nome: "Anual", preco: 449.9, dias: 365, ativo: true, link: "" },
  { id: "unico", nome: "Pagamento único (3 meses)", preco: 129.9, dias: 90, ativo: true, link: "" },
  { id: "vitalicio", nome: "Vitalício", preco: 999.9, dias: 0, ativo: false, link: "" },
];

// O prazo vale até o fim do dia, no fuso do Brasil: "30 dias" dado às 9h não vence às 9h.
export function prazoAte(dias, agoraIso, fuso = FUSO_PADRAO) {
  if (!(dias > 0)) return null;
  const hoje = partesLocais(new Date(agoraIso), fuso).data;
  return new Date(Date.parse(localParaUtc(somarDias(hoje, dias), "23:59", fuso)) + 59999).toISOString();
}
function fimDoDia(iso, fuso = FUSO_PADRAO) {
  const d = partesLocais(new Date(iso), fuso).data;
  return new Date(Date.parse(localParaUtc(d, "23:59", fuso)) + 59999).toISOString();
}

export function lerCobranca(cfg) {
  const c = cfg || {};
  const salvos = Array.isArray(c.planos) ? c.planos : [];
  const planos = PLANOS_PADRAO.map((base) => {
    const p = salvos.find((x) => x && x.id === base.id) || {};
    const preco = Math.round((+p.preco >= 0 ? +p.preco : base.preco) * 100) / 100;
    const dias = base.id === "vitalicio" ? 0 : Math.max(1, Math.round(+p.dias > 0 ? +p.dias : base.dias));
    return { id: base.id, nome: String(p.nome || base.nome).slice(0, 40), preco, dias,
      ativo: p.ativo === undefined ? base.ativo : !!p.ativo, link: /^https:\/\//.test(p.link || "") ? String(p.link).slice(0, 300) : "" };
  });
  const teste = c.teste_dias == null ? TESTE_DIAS_PADRAO : Math.max(0, Math.min(60, Math.round(+c.teste_dias || 0)));
  return { ligada: !!c.cobranca, desde: c.cobranca_desde || null, testeDias: teste, planos, auto: !!c.auto,
    pix: { chave: String(c.pix_chave || "").trim(), nome: String(c.pix_nome || "").trim(), cidade: String(c.pix_cidade || "").trim() } };
}
export const planosAtivos = (cob) => (cob.planos || []).filter((p) => p.ativo && p.preco > 0);
export const planoPorId = (cob, id) => (cob.planos || PLANOS_PADRAO).find((p) => p.id === id) || null;

// De que jeito esta conta entra hoje. "pagar" é o único que barra.
export function planoDaConta(c, agoraIso, cob, dono = false) {
  const agora = Date.parse(agoraIso);
  if (dono) return { tipo: "dono", ate: null };
  if (c && c.cortesia && !(c.cortesia_ate && agora >= ms(c.cortesia_ate))) return { tipo: "cortesia", ate: c.cortesia_ate || null, motivo: c.cortesia_motivo || "" };
  if (c && c.vitalicio) return { tipo: "vitalicio", ate: null, plano: c.plano || "vitalicio" };
  if (c && ms(c.pago_ate) > agora) return { tipo: "pago", ate: c.pago_ate, plano: c.plano || "" };
  if (!cob || !cob.ligada) return { tipo: "gratis", ate: null };
  const ini = Math.max(ms(c && c.criado_em), ms(cob.desde));
  const fimTeste = cob.testeDias > 0 ? Date.parse(fimDoDia(new Date(ini + cob.testeDias * 864e5).toISOString())) : 0;
  if (fimTeste && agora < fimTeste) return { tipo: "teste", ate: new Date(fimTeste).toISOString() };
  return { tipo: "pagar", ate: fimTeste ? new Date(Math.max(fimTeste, ms(c && c.pago_ate))).toISOString() : (c && c.pago_ate) || null };
}

// pendente | liberado | bloqueado | vencido | pagar
export function situacaoConta(c, agoraIso, cob, dono = false) {
  if (dono) return "liberado";
  if (!c) return "pendente";
  if (c.status === "liberado" && c.ate && Date.parse(agoraIso) >= ms(c.ate)) return "vencido";
  const s = c.status === "liberado" || c.status === "bloqueado" ? c.status : "pendente";
  if (s === "liberado" && cob && cob.ligada && planoDaConta(c, agoraIso, cob).tipo === "pagar") return "pagar";
  return s;
}

const NOMES_PLANO = { dono: "Dono", cortesia: "Cortesia", vitalicio: "Vitalício", pago: "Pago", gratis: "Grátis", teste: "Em teste", pagar: "Precisa pagar" };
export function textoPlano(p, cob) {
  const data = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO_PADRAO }) : "";
  const nome = p.tipo === "pago" && planoPorId(cob, p.plano) ? planoPorId(cob, p.plano).nome : NOMES_PLANO[p.tipo] || p.tipo;
  const ate = p.ate ? (p.tipo === "pagar" ? ` (venceu em ${data(p.ate)})` : ` até ${data(p.ate)}`) : (p.tipo === "cortesia" ? " sem prazo" : "");
  return nome + ate + (p.motivo ? " · " + p.motivo : "");
}

// O que um pagamento confirmado grava na conta: soma ao período que ainda vale.
export function acessoPago(c, plano, agoraIso) {
  if (!plano) return {};
  if (plano.id === "vitalicio" || !(plano.dias > 0)) return { vitalicio: true, plano: plano.id };
  const agora = Date.parse(agoraIso);
  const base = ms(c && c.pago_ate) > agora ? ms(c.pago_ate) : agora;
  return { pago_ate: fimDoDia(new Date(base + plano.dias * 864e5).toISOString()), plano: plano.id };
}
// Devolver um pagamento tira os dias dele (sem passar de hoje para trás do que já foi usado).
export function acessoDevolvido(c, pagamento, agoraIso) {
  if (pagamento.plano === "vitalicio" || !(pagamento.dias > 0)) return { vitalicio: false };
  const novo = ms(c && c.pago_ate) - pagamento.dias * 864e5;
  return { pago_ate: novo > Date.parse(agoraIso) ? new Date(novo).toISOString() : agoraIso };
}

// ---- Pix "copia e cola" (BR Code do Banco Central, EMV) ----
export function crc16Pix(s) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const campoPix = (id, v) => { v = String(v); return id + String(v.length).padStart(2, "0") + v; };
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const limparPix = (s, max) => semAcento(String(s || "")).replace(/[^A-Za-z0-9 .\-]/g, "").trim().toUpperCase().slice(0, max);
export function pixCopiaECola(o) {
  const conta = campoPix("00", "br.gov.bcb.pix") + campoPix("01", String(o.chave || "").trim());
  let p = campoPix("00", "01") + campoPix("26", conta) + campoPix("52", "0000") + campoPix("53", "986");
  if (o.valor > 0) p += campoPix("54", (+o.valor).toFixed(2));
  p += campoPix("58", "BR") + campoPix("59", limparPix(o.nome, 25) || "JARVIS SOCIAL") + campoPix("60", limparPix(o.cidade, 15) || "BRASIL");
  p += campoPix("62", campoPix("05", String(o.txid || "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***"));
  p += "6304";
  return p + crc16Pix(p);
}
// O código que aparece no extrato do Pix do dono
export const txidPagamento = (uid, emIso) => ("JS" + String(uid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) + Date.parse(emIso).toString(36)).slice(0, 25).toUpperCase();

// ---- e-mail digitado errado ----
const DOMINIOS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br", "icloud.com", "live.com", "hotmail.com.br", "outlook.com.br", "bol.com.br", "uol.com.br", "terra.com.br"];
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let x = 1; x <= a.length; x++) {
    const cur = [x];
    for (let y = 1; y <= b.length; y++) cur[y] = Math.min(ant[y] + 1, cur[y - 1] + 1, ant[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    ant = cur;
  }
  return ant[b.length];
}
export function sugerirEmail(email) {
  const e = String(email || "").trim().toLowerCase(); const k = e.lastIndexOf("@");
  if (k < 1) return null;
  const dom = e.slice(k + 1);
  if (!dom || !dom.includes(".") || DOMINIOS.includes(dom)) return null;
  let melhor = null, dist = 3;
  for (const d of DOMINIOS) { const x = distancia(dom, d); if (x < dist) { dist = x; melhor = d; } }
  return melhor && dist <= 2 ? e.slice(0, k + 1) + melhor : null;
}

// ---- planilha (ponto e vírgula + BOM: o Excel em português abre nas colunas) ----
const cel = (v) => { const s = String(v == null ? "" : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO_PADRAO }) : "");
export const NOMES_SITUACAO = { pendente: "Aguardando", liberado: "Liberado", bloqueado: "Bloqueado", vencido: "Prazo vencido", pagar: "Precisa pagar" };
export function csvContas(lista, agoraIso, cob) {
  const linhas = [["Nome", "E-mail", "Situação", "Plano", "Cadastro", "Último acesso", "Acessos", "Liberado até", "Pago até", "Nota", "Motivo do bloqueio", "Termos", "Termos aceitos em"]];
  for (const c of lista) linhas.push([c.nome, c.email, NOMES_SITUACAO[situacaoConta(c, agoraIso, cob)], textoPlano(planoDaConta(c, agoraIso, cob), cob),
    dataBR(c.criado_em), dataBR(c.ultimo_acesso), c.acessos || 0, dataBR(c.ate), c.vitalicio ? "Vitalício" : dataBR(c.pago_ate), c.nota, c.motivo, c.termos_versao, dataBR(c.termos_em)]);
  return "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n");
}
export function csvPagamentos(lista) {
  const linhas = [["Data", "Nome", "E-mail", "Plano", "Valor", "Dias", "Código (txid)", "Situação", "Decidido em"]];
  for (const p of lista) linhas.push([dataBR(p.criado_em), p.nome, p.email, p.plano, (+p.valor || 0).toFixed(2).replace(".", ","), p.dias, p.txid, p.status, dataBR(p.decidido_em)]);
  return "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n");
}
