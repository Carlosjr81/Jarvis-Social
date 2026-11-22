// Jarvis Social: service worker próprio (escopo só desta pasta).
// Guarda a casca do painel para abrir sem rede. NUNCA guarda a API:
// agendamento só vale depois de chegar ao servidor.
const CACHE = "jarvis-social-v12";
const CASCA = ["./", "./index.html", "./app.js", "./config.js", "./manifest.json", "./icone.svg",
  "./abertura-v2.mp4", "./abertura-v2-poster.jpg", "./logo.svg", "./logo-vertical.svg",
  "./fontes/inter-latin.woff2", "./fontes/inter-latin-ext.woff2", "./fontes/rammetto-one.woff2",
  "./supabase/functions/_compartilhado/api.js", "./supabase/functions/_compartilhado/tempo.js",
  "./supabase/functions/_compartilhado/frequencia.js", "./supabase/functions/_compartilhado/estados.js",
  "./supabase/functions/_compartilhado/comandos.js", "./supabase/functions/_compartilhado/banco.js",
  "./supabase/functions/_compartilhado/cifra.js", "./supabase/functions/_compartilhado/armazenamento.js",
  "./supabase/functions/_compartilhado/instagram.js", "./supabase/functions/_compartilhado/worker.js",
  "./supabase/functions/_compartilhado/acesso.js", "./supabase/functions/_compartilhado/api-acesso.js", "./supabase/functions/_compartilhado/termos.js",
  "./supabase/functions/_compartilhado/importar.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CASCA.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("jarvis-social-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.registration.scope)) return;
  // Rede primeiro (versão nova chega logo); cache só sem rede.
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))));
});
