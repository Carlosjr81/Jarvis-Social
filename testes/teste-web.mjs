// O painel: sintaxe dos módulos, PWA e, se houver Chromium/Playwright, o
// fluxo real no navegador em tela de celular (360×740) no modo DEMONSTRAÇÃO.
// Isto é teste de viewport estreito, NÃO é teste no aparelho do dono.
import { teste, igual, verdade, rodar } from "./base.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

teste("app.js e sw.js sem erro de sintaxe", () => { execFileSync(process.execPath, ["--check", path.join(RAIZ, "app.js")]); execFileSync(process.execPath, ["--check", path.join(RAIZ, "sw.js")]); });
teste("config.js não traz segredo (só URL e chave anon)", () => {
  const c = fs.readFileSync(path.join(RAIZ, "config.js"), "utf8");
  verdade(!/service_role|SERVICE_ROLE|secret|sb_secret_/i.test(c.replace(/\/\/.*$/gm, "")), "config.js com segredo");
});
teste("identidade: fontes livres com licença, tokens de cor e nada de marca de terceiros", () => {
  for (const f of ["inter-latin.woff2", "inter-latin-ext.woff2", "rammetto-one.woff2", "LICENSE-Inter.txt", "LICENSE-Rammetto.txt"]) verdade(fs.existsSync(path.join(RAIZ, "fontes", f)), "falta " + f);
  const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
  for (const t of ["--ig-1", "--tt-ciano", "--tt-vermelho", "--sol-1", "--grad", "--glitch"]) verdade(html.includes(t), "token " + t);
  verdade(!/pricedown|grand theft|rockstar/i.test(html + fs.readFileSync(path.join(RAIZ, "app.js"), "utf8")), "nome ou fonte de jogo no painel");
});
teste("manifest e ícone existem; SW com escopo da pasta", () => {
  const m = JSON.parse(fs.readFileSync(path.join(RAIZ, "manifest.json"), "utf8"));
  igual([m.scope, m.display, m.lang], ["./", "standalone", "pt-BR"]); verdade(fs.existsSync(path.join(RAIZ, "icone.svg")));
  verdade(fs.readFileSync(path.join(RAIZ, "app.js"), "utf8").includes(`register("./sw.js", { scope: "./" })`));
});
teste(".nojekyll presente (o Pages ignoraria _compartilhado/ sem ele)", () => verdade(fs.existsSync(path.join(RAIZ, ".nojekyll"))));
teste("todo módulo compartilhado importado está na casca do SW", () => {
  const sw = fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8");
  const pasta = path.join(RAIZ, "supabase/functions/_compartilhado");
  for (const f of fs.readdirSync(pasta).filter((x) => x.endsWith(".js"))) verdade(sw.includes("_compartilhado/" + f), "falta no sw.js: " + f);
});
teste("todo arquivo da casca do SW existe", () => {
  const sw = fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8");
  const lista = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  for (const f of lista) verdade(fs.existsSync(path.join(RAIZ, f)), "falta " + f);
});

let pw = null; try { pw = req("playwright"); } catch { /* sem navegador: só as checagens acima */ }
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".jpg": "image/jpeg" };
function servir() {
  return new Promise((ok) => {
    const s = http.createServer((q, r) => {
      const u = decodeURIComponent(new URL(q.url, "http://x").pathname).replace(/^\/jarvis-social/, "");
      const f = path.join(RAIZ, u.endsWith("/") ? u + "index.html" : u);
      if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
    }).listen(0, "127.0.0.1", () => ok(s));
  });
}

if (pw) {
  teste("fluxo no navegador (360 px): demonstração → Novo Reel → programar → recarregar → editar → pausar → cancelar → comando", async () => {
    const srv = await servir(); const porta = srv.address().port;
    const nav = await pw.chromium.launch();
    try {
      const ctx = await nav.newContext({ viewport: { width: 360, height: 740 }, locale: "pt-BR", timezoneId: "Asia/Tokyo" });
      const pg = await ctx.newPage();
      const erros = []; pg.on("pageerror", (e) => erros.push(e.message));
      fs.mkdirSync(path.join(RAIZ, "testes/saida"), { recursive: true });
      pg.on("dialog", (d) => d.type() === "prompt" ? d.accept(d.message().includes("Qual @") ? "loja.exemplo" : d.defaultValue()) : d.accept());
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#inicio`);
      // Na demonstração você é o dono: entra direto (o dono não aceita os próprios termos).
      await pg.getByText("DEMONSTRAÇÃO").first().waitFor();
      // Conta do dono já conectada (simulada) e uma segunda conta.
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#ajustes`);
      await pg.getByText("@carlos.jr.81").first().waitFor();
      await pg.click("#conectar"); await pg.getByText("@loja.exemplo").waitFor();
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#inicio`);
      await pg.getByRole("link", { name: "＋ Novo Reel" }).click();
      await pg.setInputFiles("#in-video", path.join(RAIZ, "testes/amostras/video-teste.mp4"));
      await pg.locator(".previa video").waitFor();
      await pg.click("#avancar");
      await pg.setInputFiles("#in-capa", path.join(RAIZ, "testes/amostras/capa-teste.jpg"));
      await pg.locator(".previa .grade").waitFor();
      await pg.click("#avancar");
      await pg.fill("#in-leg", "Treino depois dos 40 #foco");
      await pg.click("#avancar");
      const alvo = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
      await pg.fill("#in-data", alvo); await pg.fill("#in-hora", "10:00");
      await pg.click("#avancar");
      igual(await pg.locator("#in-conta option:checked").innerText(), "@carlos.jr.81 (simulada)", "conta padrão marcada");
      await pg.selectOption("#in-conta", { label: "@loja.exemplo (simulada)" });
      await pg.click("#programar");
      await pg.getByText("Demonstração (simulado)").waitFor({ timeout: 15000 });
      const recibo = await pg.locator("dl.recibo").innerText();
      verdade(recibo.includes(`${alvo.split("-").reverse().join("/")} às 10:00 (America/Sao_Paulo)`), "fuso errado no recibo: " + recibo);
      verdade(recibo.includes("@loja.exemplo"), "conta escolhida no recibo: " + recibo);
      // fechar e reabrir
      await pg.reload(); await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#agenda`);
      await pg.getByText("Treino depois dos 40").first().waitFor();
      igual(await pg.locator("[data-post]").count(), 1, "um agendamento só");
      // largura: sem rolagem horizontal
      igual(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "rolagem horizontal");
      // editar
      await pg.click("[data-acao=editar]"); await pg.fill("#ed-hora", "11:30"); await pg.click("#ed-salvar");
      await pg.getByText("às 11:30").first().waitFor().catch(() => {});
      verdade((await pg.locator("[data-post]").first().innerText()).includes("11:30"), "edição não apareceu");
      // pausar e cancelar
      await pg.click("[data-acao=pausar]"); await pg.locator(".selo.paused").waitFor();
      await pg.click("[data-acao=cancelar]");
      await pg.click("[data-filtro=cancelados]"); await pg.locator(".selo.cancelled").waitFor();
      // comando
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#inicio`);
      await pg.fill("#cmd", "Altere para dois vídeos por dia"); await pg.click("#f-cmd button");
      await pg.getByText("Nova frequência: 2 por dia").waitFor();
      await pg.click("#cmd-sim"); await pg.getByText("Frequência alterada").waitFor();
      // Teste de publicação imediato (demonstração): todas as etapas até "publicado".
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#inicio`);
      await pg.click("#teste-imediato"); await pg.getByText("Teste de publicação imediato").first().waitFor();
      await pg.click("#tp-ir");
      await pg.locator("#tp-fim", { hasText: "Demonstração (simulado)" }).waitFor({ timeout: 30000 });
      igual(await pg.locator("#tp-etapas p", { hasText: "✅" }).count(), 6, "seis etapas concluídas");
      await pg.locator("#tp-fim .carimbo", { hasText: "MISSÃO CUMPRIDA (simulada)" }).waitFor();
      await pg.screenshot({ path: path.join(RAIZ, "testes/saida/teste-imediato-360.png"), fullPage: true });
      await pg.click("#tp-fechar");
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#agenda`);
      await pg.locator("[data-filtro=publicados]").click();
      await pg.getByText("Publicação simulada (sem link real)").first().waitFor();
      igual(await pg.getByText("Ver no Instagram").count(), 0, "post simulado nunca ganha link de Instagram");
      // Painel de usuários do dono: simular um cadastro e liberar por 30 dias.
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#usuarios`);
      await pg.getByRole("heading", { name: "Painel de usuários" }).waitFor();
      await pg.click("#demo-cadastro"); await pg.getByText("(exemplo)").first().waitFor();
      await pg.locator("[data-gerir]").first().click();
      await pg.selectOption("#g-prazo", "30"); await pg.click('[data-a="liberar"]');
      await pg.locator('[data-f="todos"]').click();
      await pg.locator(".selo.scheduled", { hasText: "Liberado" }).first().waitFor();
      await pg.screenshot({ path: path.join(RAIZ, "testes/saida/usuarios-360.png"), fullPage: true });
      await pg.goto(`http://127.0.0.1:${porta}/jarvis-social/#inicio`);
      await pg.screenshot({ path: path.join(RAIZ, "testes/saida/inicio-360.png"), fullPage: true });
      igual(erros, [], "erros de JavaScript na página");
    } finally { await nav.close(); srv.close(); }
  });
} else if (process.env.JS_EXIGIR_TUDO) teste("Playwright presente (exigido no Actions)", () => { throw new Error("Playwright ausente"); });
else console.log("aviso: Playwright ausente; fluxo no navegador não rodou");

rodar("painel: sintaxe, PWA e fluxo no navegador (viewport de celular)");
