// Gera a mídia do "Teste de publicação imediato": capa 1080×1920 (HTML
// desenhado no Chromium) e um Reel de 6 s em H.264 + AAC silencioso,
// 30 fps, faststart (o formato que a API do Instagram aceita para Reels).
//   node ferramentas/gerar-midia-teste.cjs   (precisa de Playwright e ffmpeg)
const pw = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const PASTA = path.join(__dirname, "..", "teste");
const FONTE = require("fs").readFileSync(path.join(__dirname, "..", "fontes", "rammetto-one.woff2")).toString("base64");
const PALMA = (lado) => `<svg class="palma ${lado}" viewBox="0 0 90 150"><path d="M44 150 C46 110 47 80 50 52 L54 52 C52 82 51 112 52 150 Z"/><path d="M52 52 C30 30 10 36 0 52 C18 40 34 42 52 56 Z M52 52 C40 22 20 10 6 14 C26 20 40 34 50 58 Z M52 52 C62 22 80 14 90 20 C72 24 60 38 54 58 Z M52 52 C76 38 88 46 90 60 C78 48 64 48 54 56 Z M52 52 C50 26 56 6 66 0 C60 14 58 34 55 54 Z"/></svg>`;
// Chão em grade com perspectiva (linhas desenhadas, sem 3D do CSS).
const CHAO = (() => {
  let l = "";
  for (let i = -12; i <= 12; i++) l += `<line x1="540" y1="0" x2="${540 + i * 140}" y2="470" stroke="#FF4F8B" stroke-opacity=".7" stroke-width="4"/>`;
  for (let k = 1; k <= 9; k++) { const y = Math.round(470 * Math.pow(k / 9, 2.2)); l += `<line x1="0" y1="${y}" x2="1080" y2="${y}" stroke="#25F4EE" stroke-opacity=".75" stroke-width="${2 + k * 0.5}"/>`; }
  return `<svg viewBox="0 0 1080 470" preserveAspectRatio="none">${l}</svg>`;
})();
// Mesma identidade do painel: pôr do sol neon, degradê do Instagram, glitch ciano/vermelho.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:L;src:url(data:font/woff2;base64,${FONTE}) format("woff2")}
html,body{margin:0;width:1080px;height:1920px;font-family:Inter,system-ui,sans-serif;color:#F7F2FF;overflow:hidden;background:#0A0612}
.ceu{position:absolute;inset:0 0 470px 0;background:linear-gradient(180deg,#12052A,#2A0B4A 35%,#5B1460 70%,#A12A5E)}
.sol{position:absolute;left:50%;top:720px;width:760px;height:760px;transform:translateX(-50%);border-radius:50%;background:linear-gradient(180deg,#FFD23F,#FF7A3D 45%,#FF2E88);
 -webkit-mask:linear-gradient(#000 0 0) top/100% 40% no-repeat,repeating-linear-gradient(180deg,#000 0 40px,transparent 40px 62px);box-shadow:0 0 160px #FF2E8888}
.chao{position:absolute;left:0;right:0;bottom:0;height:470px;background:linear-gradient(180deg,#2A0730,#0E0318)}.chao svg{width:100%;height:100%}
.palma{position:absolute;bottom:400px;width:330px;height:560px;fill:#0C0318}.palma.e{left:-40px}.palma.d{right:-40px;transform:scaleX(-1)}
.borda{position:absolute;inset:26px;border-radius:60px;border:10px solid transparent;background:linear-gradient(120deg,#D62976,#962FBF 55%,#4F5BD5) border-box;-webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.c{position:absolute;left:0;right:0;top:150px;text-align:center;padding:0 80px}
.selo{display:inline-block;font-family:L;font-size:54px;color:#FFD23F;border:7px solid #FFD23F;border-radius:22px;padding:6px 40px;transform:rotate(-4deg);text-shadow:4px 4px 0 #000}
h1{font-family:L;font-weight:400;font-size:118px;line-height:1.05;margin:50px 0 24px;text-shadow:7px -7px 0 #25F4EE,-7px 7px 0 #FE2C55,0 0 40px #FF2E88aa}
h2{font-family:L;font-weight:400;font-size:70px;margin:0;color:#fff;text-shadow:4px -4px 0 #25F4EE,-4px 4px 0 #FE2C55}
.rod{position:absolute;bottom:110px;left:90px;right:90px;text-align:center;font-size:40px;font-weight:700;color:#F7F2FF;background:#0A0612d9;border-radius:28px;padding:22px 30px}
</style></head><body><div class="ceu"></div><div class="sol"></div><div class="chao">${CHAO}</div>${PALMA("e")}${PALMA("d")}<div class="borda"></div>
<div class="c"><div class="selo">TESTE</div><h1>Teste de<br>publicação</h1><h2>Jarvis Mídia Social</h2></div>
<div class="rod">Publicado automaticamente para conferir a integração oficial</div></body></html>`;
(async () => {
  const nav = await pw.chromium.launch();
  const pg = await nav.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await pg.setContent(HTML); await pg.waitForTimeout(300);
  const png = path.join(PASTA, "capa-teste.png");
  await pg.screenshot({ path: png });
  await nav.close();
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", png, "-q:v", "3", path.join(PASTA, "capa-teste.jpg")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-i", png, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "6",
    "-vf", "scale=1080:1920,zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=180:s=1080x1920:fps=30,format=yuv420p",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "24", "-r", "30", "-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart",
    path.join(PASTA, "video-teste.mp4")]);
  require("fs").unlinkSync(png);
  console.log("pronto");
})();
