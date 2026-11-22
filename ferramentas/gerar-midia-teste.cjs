// Gera a mídia do "Teste de publicação imediato": capa 1080×1920 (HTML
// desenhado no Chromium) e um Reel de 6 s em H.264 + AAC silencioso,
// 30 fps, faststart (o formato que a API do Instagram aceita para Reels).
//   node ferramentas/gerar-midia-teste.cjs   (precisa de Playwright e ffmpeg)
const pw = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const PASTA = path.join(__dirname, "..", "teste");
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1080px;height:1920px;font-family:Inter,system-ui,sans-serif;background:#0B1020;color:#EEF1F8;overflow:hidden}
.fundo{position:absolute;inset:0;background:radial-gradient(900px 900px at 80% 10%,#35D6A455,transparent 60%),radial-gradient(900px 900px at 10% 95%,#7FB2FF44,transparent 60%)}
.grade{position:absolute;inset:0;background-image:linear-gradient(#ffffff0d 2px,transparent 2px),linear-gradient(90deg,#ffffff0d 2px,transparent 2px);background-size:90px 90px}
.c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px}
.selo{border:4px solid #35D6A4;color:#35D6A4;border-radius:999px;padding:18px 44px;font-size:46px;font-weight:800;letter-spacing:6px}
h1{font-size:150px;line-height:1.02;margin:60px 0 30px;font-weight:900}
h2{font-size:78px;margin:0;font-weight:700;color:#B7C0D8}
.ic{width:260px;height:260px;margin-bottom:40px}
.rod{position:absolute;bottom:120px;left:90px;right:90px;text-align:center;font-size:40px;color:#8D97B3}
</style></head><body><div class="fundo"></div><div class="grade"></div><div class="c">
<svg class="ic" viewBox="0 0 512 512"><circle cx="256" cy="256" r="200" fill="none" stroke="#35D6A4" stroke-width="40"/><path d="M210 160v192l150-96z" fill="#35D6A4"/></svg>
<div class="selo">TESTE</div><h1>Teste de<br>publicação</h1><h2>Jarvis Mídia Social</h2></div>
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
