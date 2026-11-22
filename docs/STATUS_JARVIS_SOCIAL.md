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
| Testes | `node testes/rodar.mjs` → 107 passou / 0 falhou (22/11/2026, sessão na nuvem; Actions confere a cada push) |
| Painel publicado | Pages ligado pelo dono em 22/11/2026 (main, raiz): https://carlosjr81.github.io/Jarvis-Social/ — em DEMONSTRAÇÃO até o servidor existir. A sessão na nuvem não alcança github.io; abertura no celular a confirmar pelo dono |
| Servidor (Supabase) | **No ar desde 22/11/2026 18:25** (run 45054841848): projeto `jarvis-social` (klbthlkalucoeoemipxm), banco migrado, funções api/worker/mcp, pg_cron, prova de vida ok (saúde, worker, MCP 401 sem chave). Token do dono no segredo `JS_SUPABASE_ACCESS_TOKEN` (vence ~20/12/2026: trocar antes, senão novas implantações falham) |
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

## Teste de publicação imediato (pedido do dono, 22/11/2026)
- Botão "🧪 Teste de publicação imediato" no Início: baixa `teste/video-teste.mp4`
  (6 s, 1080×1920, H.264 + AAC silencioso, faststart) e `teste/capa-teste.jpg`
  ("Teste de publicação — Jarvis Mídia Social"), envia, cria o post com
  `publicar_agora` e `teste: true` (legenda descreve o teste), acorda o worker
  (`POST /v1/worker/cutucar`, no máximo 1 vez a cada 15 s por espaço) e
  acompanha as 6 etapas até o permalink. Refazer a mídia:
  `node ferramentas/gerar-midia-teste.cjs`.
- Na demonstração: simulado de ponta a ponta (provado no Chromium, 6/6).
- **Real: ainda não executado** — precisa do servidor (passo 1) e do app da
  Meta com @carlos.jr.81 conectado (passo 2). Pede confirmação antes de
  publicar de verdade. Quando rodar, registrar aqui ID e permalink.

## ChatGPT e Claude (pedido do dono, 22/11/2026)
- Chaves de integração (`tokens_api`, só o SHA-256; escopo ler/programar;
  validade; revogação imediata; presas ao espaço; param se a conta do dono
  parar). Painel: Ajustes › Integrações.
- Grade de publicação: `GET /v1/grade` (horários da frequência livres/ocupados)
  e `POST /v1/grade/preencher` (rascunhos nos próximos livres). Agenda › Grade.
- Conector MCP (`functions/mcp`, `_compartilhado/mcp.js`) com 17 ferramentas;
  ChatGPT por Ações (`openapi-chatgpt.json`) ou conector MCP.
- **Como no Metricool**: `agendar_reel` (MCP) / `agendarReel` (GPT) /
  `POST /v1/reels` programa em um passo a partir do LINK do vídeo (Drive
  "qualquer pessoa com o link", Dropbox, MP4 direto): o servidor baixa
  (`importar.js`: só https, sem endereço interno, redirecionamentos
  conferidos, limite de tamanho, tipo pelos bytes), guarda e programa.
  Repetir não duplica. Anexo da conversa não é link: precisa do Drive/painel.
- Testado com banco e "internet" simulados (11 testes de integração). **Não instalado** no
  ChatGPT/Claude reais: depende do servidor (passo 1). Passo a passo:
  `docs/INTEGRACAO-ASSISTENTES.md`.

## Mínimo de ações (pedido do dono, 22/11/2026)
- Implantação com **um segredo** (`JS_SUPABASE_ACCESS_TOKEN`): o workflow acha
  ou cria o projeto, aplica migrations pela API (`jarvis_migracoes`), gera a
  cifra (uma vez) e o segredo do worker (derivado de ref+token), publica
  api/worker/mcp, pg_cron, auth e grava config.js/openapi.
- Dono automático (1ª conta confirmada; `JS_EMAIL_DONO` opcional).
- App da Meta pelo painel (Ajustes › Instagram; segredo cifrado no banco).
- Piloto automático por espaço (worker preenche a grade com rascunhos).
- Início: lista "Configuração: N de 6" em que cada item é um botão que faz
  a ação; "Conectar Claude/ChatGPT" de 1 toque; frequência por predefinição;
  espaço criado sozinho; piloto ligado de fábrica; "Salvar como rascunho"
  segura o post (`posts.segurar`) para o piloto não programar.

## Bloqueios (só o dono resolve)
1. Conta grátis no Supabase + **um** segredo no GitHub (`JS_SUPABASE_ACCESS_TOKEN`) — `docs/DEPLOY.md`, passo 1.
2. App da Meta pelo painel (`docs/DEPLOY.md`, passo 3).
3. ~~Ligar o GitHub Pages~~ feito em 22/11/2026.

## Próxima ação
- Dono: Criar conta no painel (1ª confirmada = dona) › Conectar ChatGPT (OAuth) › app da Meta › conectar @carlos.jr.81. Primeira conexão real do ChatGPT ainda não testada.
- Quando o dono colar o token (botões do painel), a instalação dispara sozinha
  pelo relógio; conferir o log do **Jarvis Social** a prova de vida, entrar no
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
