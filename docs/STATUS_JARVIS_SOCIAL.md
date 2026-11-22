# Status do Jarvis Social (continuidade entre sessões)

> Ao ouvir "continue": leia este arquivo, confira o último run do workflow
> **Jarvis Social** no Actions e a saúde da API (se implantada) antes de mexer.
> Nunca grave token ou senha aqui.

| Campo | Valor |
|---|---|
| Repositório | `Carlosjr81/Jarvis-Social` (próprio; saiu do Super-HQs em 22/11/2026) |
| Branch | `main` (código da fundação veio do commit `a8cace1` da branch `ccr-272ef392-6vuh6i` do Super-HQs) |
| Actions | workflow *Jarvis Social* dispara sozinho a cada push (repositório público). Run 45030840705 (22/11/2026): verde, mas SQL e painel não tinham rodado no runner; corrigido para instalar PostgreSQL e Chromium e reprovar se faltarem |
| Etapa | A concluída (fundação) + B em parte (agendamento e adaptador Meta testados com simulador) + base comercial da E (cadastro com aprovação, termos, prazos, cobrança por Pix, painel do dono), 22/11/2026 |
| Testes | `node testes/rodar.mjs` → 90 passou / 0 falhou (22/11/2026, sessão na nuvem; Actions confere a cada push) |
| Painel publicado | Pages ligado pelo dono em 22/11/2026 (main, raiz): https://carlosjr81.github.io/Jarvis-Social/ — em DEMONSTRAÇÃO até o servidor existir. A sessão na nuvem não alcança github.io; abertura no celular a confirmar pelo dono |
| Servidor (Supabase) | **Não criado.** Depende do passo 1 do dono em `docs/DEPLOY.md` |
| Instagram real | **Não conectado / nenhuma publicação real feita.** Depende do app da Meta (passo 2 do `DEPLOY.md`) |

## O que funciona hoje (provado por teste)
- Núcleo: fusos IANA (horário de verão incluso), frequência sem teto comercial
  com prévia de remarcação, máquina de estados com eventos, comandos em português.
- API `/v1` completa para o P0 (mídias, posts, agenda, editar/pausar/retomar/
  cancelar, frequência com prévia obrigatória, fila pausável, comandos, OAuth Instagram).
- Worker: contêiner → processamento → publicação → permalink; reconciliação de
  resposta ambígua sem duplicar; limite/Retry-After; 5 tentativas; token
  expirado → reconectar; lease vencido retomado; atraso → pausa e espera decisão.
- PostgreSQL real: migração, unicidade da idempotência, `reivindicar_jobs` com
  SKIP LOCKED provado com duas sessões simultâneas, RLS em todas as tabelas.
- Painel (Chromium 360×740, fuso da máquina Tóquio para provar que não vaza):
  Novo Reel com vídeo+capa+legenda+data → recibo com fuso → recarregar mantém →
  editar, pausar, cancelar → comando "Altere para dois vídeos por dia" com prévia.
  **Teste de viewport, não do aparelho real.**

## Cadastro e venda (pedido do dono, 22/11/2026: "igual ao do Treino Livre")
- Mesmo desenho do Treino Livre (porteiro, `situacaoConta`, `planoDaConta`,
  Pix copia e cola, painel do dono), mas **a decisão é do servidor**: a API
  barra as rotas do produto (`acesso_pendente|bloqueado|vencido|pagar`,
  `termos_pendentes`) e o worker não publica espaço de dono sem acesso.
- Dono = `JS_EMAIL_DONO` com e-mail confirmado. Na demonstração você é o dono.
- Painel: Ajustes › Sua conta › Painel de usuários (`#usuarios`).
- Termos `termos.js` versão 2026-11-22a; aceite em `aceites` (imutável no
  banco, gatilho) com SHA-256 do texto. Mudou os termos: suba a versão.
- Cobrança nasce **desligada**; preços de partida são exemplo (dono muda).
- Contas do Instagram: várias por espaço, uma padrão (`conta_padrao_id`),
  escolha em cada Novo Reel e na edição, filtro na Agenda. Na demonstração a
  conta padrão é @carlos.jr.81 (simulada).
- Não validado num aparelho nem com o Supabase real.

## Bloqueios (só o dono resolve)
1. Criar o projeto grátis no Supabase e 4 segredos no GitHub, incluindo `JS_EMAIL_DONO` (`docs/DEPLOY.md`, passo 1).
2. Criar o app da Meta e 2 segredos (`docs/DEPLOY.md`, passo 2).
3. ~~Ligar o GitHub Pages~~ feito em 22/11/2026.

## Próxima ação
- Com o Pages ligado e os segredos do passo 1: disparar o workflow
  **Jarvis Social** (`implantar: true`), conferir a prova de vida, entrar no
  painel pelo celular e rodar o roteiro de aceite de `docs/OPERACAO.md`.
- Com o passo 2: conectar @carlos.jr.81 e fazer UMA publicação real autorizada
  (registrar ID/permalink aqui). Até lá o adaptador Meta não tem selo
  "produção validada".
- Depois: limpeza de mídia já publicada (cota de 1 GB do Storage), retomada de
  upload por partes (TUS), importação inativa da fila do Metricool, cadastro de
  fontes (@vikingthales, @jacobpetry), conector MCP/ChatGPT.

## A confirmar na primeira implantação (escrito sem acesso às páginas oficiais)
- Supabase: rota da Management API `database/query`, `config/auth`, `api-keys`;
  `functions deploy --use-api`; tamanho do objeto por HEAD em `object/authenticated`.
- Meta: versão `v23.0`, hosts `graph.instagram.com`/`api.instagram.com`, nomes das
  permissões, `cover_url` para Reels, limites de vídeo (duração/tamanho/proporção).
Qualquer divergência: corrigir, rodar a trava e registrar aqui com a data.
