# Jarvis Social — regras para o Claude

SaaS próprio de agendamento/publicação (começa por Reels do @carlos.jr.81).
Especificação: `PROMPT_CLAUDE_JARVIS_SOCIAL.md` do dono (22/11/2026).
**Estado atual e próxima ação: `docs/STATUS_JARVIS_SOCIAL.md` — leia primeiro
quando o dono disser "continue".**

## Onde mora e por quê
- Repositório próprio `Carlosjr81/Jarvis-Social` (decisão do dono, 22/11/2026:
  o projeto saiu do Super-HQs, onde nasceu na branch `ccr-272ef392-6vuh6i`).
  Não mexer em Super HQs, Treino Livre nem Jarvis-Claude a partir daqui.
- O painel é servido pelo GitHub Pages deste repositório. Pages grátis exige
  repositório **público** ⇒ **nunca** entram voz, vídeos pessoais, tokens,
  senhas, `.env`. A voz e os motores ficam no `Jarvis-Claude` (privado).

## Trava antes de todo push
```bash
node testes/rodar.mjs      # 74+ testes; sem npm install
```
Sem `npm install`: zero dependências. A suíte SQL sobe um PostgreSQL
temporário; a do painel usa o Chromium da sessão (Playwright).

## Arquitetura em uma linha
Painel PWA estático (GitHub Pages) → API `/v1` (Supabase Edge Function) →
PostgreSQL + Storage privado; worker chamado pelo pg_cron a cada minuto
(reserva: Actions a cada 15 min). Toda regra está em
`supabase/functions/_compartilhado/*.js`, que roda igual no Node (testes),
no Deno (servidor) e no navegador (DEMONSTRAÇÃO).

## Identidade visual (22/11/2026, pedido do dono)
Base escura e neon do Treino Livre + degradê do Instagram (botões, chips,
bordas) + "glitch" ciano/vermelho do TikTok (títulos) + pôr do sol neon dos
jogos de mundo aberto (sol listrado, palmeiras, chão em grade, carimbo
"MISSÃO CUMPRIDA"). **Só o gênero**: nenhum nome, logo, fonte (Pricedown) ou
personagem de jogo ou rede. Fontes livres em `fontes/` (Inter e Rammetto One,
SIL OFL). Tokens no `:root` do `index.html`; contraste medido (texto ≥ 4,5:1,
branco sobre o degradê ≥ 4,7:1): mudou uma cor, meça de novo.

## Abertura e logo (22/11/2026)
- `abertura-v2.mp4` (720×1280, 9,3 s, **sem áudio**, ~0,9 MB) + poster: o
  personagem do dono em desenho animado correndo pelo dia (pijama, social,
  casual, largado, academia, pijama de dinossauro) até o logo. Gerado pelo
  motor do Jarvis-Claude (`ferramentas/propaganda/`, `--modo abertura`).
  Uma vez por sessão, botão Pular, some em erro/12 s, movimento reduzido não
  toca. Vinheta nova entra com outro nome (v2) e no `sw.js`.
- Logo: `icone.svg` (sol listrado + play com glitch, moldura no degradê),
  `logo.svg` (horizontal) e `logo-vertical.svg`, com a fonte embutida.

## Regras que não podem quebrar
- Demonstração, "agendamento confirmado no Jarvis" e "publicação concluída"
  são três coisas diferentes (campo `recibo.confirmacao`). Publicado só com
  ID da mídia + permalink lidos da rede. Simulador nunca vira "concluída".
- O Instagram não tem fila nativa pela API: quem agenda é o Jarvis.
- Toda mudança de post é condicionada à versão; o worker só age se a versão
  do job for a do post; resposta ambígua ao publicar = conferir, nunca reenviar.
- Tenant vem da sessão (membros), nunca de campo do cliente.
- Acesso à plataforma: `api-acesso.js`. Toda rota do produto passa por
  `exigirLiberado`; só `/v1/conta/*`, `/v1/admin/*` (dono), saúde e retorno
  do OAuth ficam fora. Dono = `JS_EMAIL_DONO` **com e-mail confirmado**.
  Termos em `termos.js`: mudou o texto, suba a versão; aceites não se apagam.
- Chave de integração (ChatGPT/Claude): só `ROTAS_DA_CHAVE`, só o espaço
  dela, escopo checado em toda mutação; nunca guarde o segredo, só o hash.
  O MCP (`mcp.js`) chama `api.tratar` com a chave: regra nova vale para os dois.
- Sem teto comercial de publicações; só o limite técnico de 48/dia e a cota da rede.
- Fuso padrão America/Sao_Paulo; banco em UTC; nunca o fuso da máquina.
- Nada pago sem autorização do dono.
