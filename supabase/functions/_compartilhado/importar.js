// Importar vídeo/capa de um LINK (o que o ChatGPT/Claude passam ao programar
// um Reel pela conversa, como no Metricool). O servidor baixa, confere e
// guarda no armazenamento privado.
//
// Proteções (link vem de fora, o servidor é quem busca):
//  - só https, porta padrão, sem usuário/senha na URL;
//  - nunca endereço interno: localhost, IP privado/reservado (v4 e v6), .local/.internal;
//  - redirecionamentos seguidos à mão (até 5), cada destino conferido de novo;
//  - tamanho máximo conferido no cabeçalho E contando os bytes;
//  - tipo conferido pelos BYTES (MP4/MOV "ftyp", JPEG, PNG), não pelo nome; HTML recusado.

export class ErroImportar extends Error { constructor(codigo, msg) { super(msg); this.codigo = codigo; } }
const falha = (c, m) => { throw new ErroImportar(c, m); };

// Links de compartilhamento comuns viram link de download direto.
export function normalizarLink(url) {
  let u; try { u = new URL(String(url).trim()); } catch { falha("link_invalido", "Link inválido."); }
  const h = u.hostname.toLowerCase();
  const id = (u.pathname.match(/\/file\/d\/([\w-]{10,})/) || [])[1] || u.searchParams.get("id");
  if ((h === "drive.google.com" || h === "docs.google.com") && id) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  if (h.endsWith("dropbox.com")) { u.searchParams.set("dl", "1"); return u.toString(); }
  return u.toString();
}

function ipPrivado(h) {
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) { // IPv6 entre colchetes já removidos pelo URL
    const x = h.replace(/^\[|\]$/g, "").toLowerCase();
    return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:");
  }
  return false;
}
export function conferirDestino(url) {
  let u; try { u = new URL(url); } catch { falha("link_invalido", "Link inválido."); }
  if (u.protocol !== "https:") falha("link_inseguro", "Use um link https.");
  if (u.username || u.password) falha("link_inseguro", "Link com usuário/senha não é aceito.");
  if (u.port && u.port !== "443") falha("link_inseguro", "Porta não permitida.");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":") || ipPrivado(h)) falha("link_interno", "Endereço interno não é permitido.");
  return u;
}

export function tipoPelosBytes(b) {
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const marca = String.fromCharCode(b[8], b[9], b[10], b[11]);
    return marca === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

// Baixa com limite. Devolve { bytes: Uint8Array, mime }.
export async function baixar(url, { fetch: f = globalThis.fetch, maxBytes, tempoMs = 120000 } = {}) {
  let atual = conferirDestino(normalizarLink(url)).toString();
  let resp;
  for (let salto = 0; ; salto++) {
    if (salto > 5) falha("redirecionamentos", "Redirecionamentos demais.");
    try { resp = await f(atual, { redirect: "manual", signal: AbortSignal.timeout ? AbortSignal.timeout(tempoMs) : undefined, headers: { "User-Agent": "JarvisSocial/1.0" } }); }
    catch (e) { falha("sem_resposta", "Não consegui baixar o link: " + (e && e.message)); }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) { atual = conferirDestino(new URL(resp.headers.get("location"), atual).toString()).toString(); continue; }
    break;
  }
  if (!resp.ok) falha("link_falhou", `O link respondeu ${resp.status}. Confira se está compartilhado para "qualquer pessoa com o link".`);
  const tam = +resp.headers.get("content-length") || 0;
  if (tam && tam > maxBytes) falha("arquivo_grande", `Arquivo de ${Math.round(tam / 1048576)} MB passa do limite de ${Math.round(maxBytes / 1048576)} MB.`);
  const partes = []; let total = 0;
  const leitor = resp.body && resp.body.getReader ? resp.body.getReader() : null;
  if (leitor) {
    for (;;) { const { done, value } = await leitor.read(); if (done) break; total += value.length; if (total > maxBytes) { try { leitor.cancel(); } catch {} falha("arquivo_grande", `Arquivo passa do limite de ${Math.round(maxBytes / 1048576)} MB.`); } partes.push(value); }
  } else { const b = new Uint8Array(await resp.arrayBuffer()); total = b.length; if (total > maxBytes) falha("arquivo_grande", "Arquivo grande demais."); partes.push(b); }
  const bytes = new Uint8Array(total); let o = 0; for (const p of partes) { bytes.set(p, o); o += p.length; }
  const mime = tipoPelosBytes(bytes);
  if (!mime) falha("nao_e_midia", /^\s*</.test(new TextDecoder().decode(bytes.slice(0, 64))) ? "O link abriu uma página, não o arquivo. No Drive, compartilhe como \"qualquer pessoa com o link\"." : "O arquivo não é MP4, MOV, JPG nem PNG.");
  return { bytes, mime };
}
