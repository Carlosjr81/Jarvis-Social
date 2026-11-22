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

## Regras que não podem quebrar
- Demonstração, "agendamento confirmado no Jarvis" e "publicação concluída"
  são três coisas diferentes (campo `recibo.confirmacao`). Publicado só com
  ID da mídia + permalink lidos da rede. Simulador nunca vira "concluída".
- O Instagram não tem fila nativa pela API: quem agenda é o Jarvis.
- Toda mudança de post é condicionada à versão; o worker só age se a versão
  do job for a do post; resposta ambígua ao publicar = conferir, nunca reenviar.
- Tenant vem da sessão (membros), nunca de campo do cliente.
- Sem teto comercial de publicações; só o limite técnico de 48/dia e a cota da rede.
- Fuso padrão America/Sao_Paulo; banco em UTC; nunca o fuso da máquina.
- Nada pago sem autorização do dono.
