# Operar o Jarvis Social pelo celular

## Dois fluxos
- **Desenvolvimento** — sessão do Claude Code (claude.ai/code) com este
  repositório: "Crie a tela X", "Corrija esse erro e publique", "Continue da
  última etapa". O Claude edita, roda `node testes/rodar.mjs`,
  envia, acompanha o Actions e devolve o link.
- **Operação** — o painel (https://carlosjr81.github.io/Jarvis-Social/,
  depois do passo 0 do `DEPLOY.md`). Agendar NÃO cria commit: é um pedido
  autenticado gravado no servidor e relido antes de confirmar.

## Teste de publicação imediato
Início › **🧪 Teste de publicação imediato** › escolha a conta › Publicar o
teste agora. Publica na hora um Reel de 6 s com a capa "Teste de publicação —
Jarvis Mídia Social" e uma legenda que explica o teste, e mostra cada etapa
(mídia, envio, publicação criada, servidor acordado, Instagram) até o link do
post. Na demonstração tudo é simulado e a tela diz isso.

## Cadastro e usuários
- Quem abre o painel cria a conta (nome, e-mail, senha) e espera a sua
  liberação; a tela confere sozinha a cada 30 s. Depois aceita os termos.
- Você (dono) vê no Início "N cadastros esperando" e "N pagamentos para
  confirmar". Em Ajustes › Painel de usuários: liberar (sem prazo, 7, 30, 90
  dias ou 1 ano), renovar, bloquear com motivo, recado, nota só sua,
  cortesia, registrar pagamento recebido por fora, link de nova senha,
  remover da lista, liberar todos, aprovação automática e planilha.
- **Cobrança** (desligada até você ligar): planos mensal, anual, único e
  vitalício com preço e dias editáveis, dias de teste, chave Pix. A pessoa
  gera o Pix copia e cola com o código do pagamento; você confere o código no
  extrato e toca Confirmar: o acesso soma os dias do plano. Não há renovação
  automática nem aviso automático do banco (precisaria de um provedor de
  pagamento, pago).
- Bloqueado, vencido ou sem plano: o painel fecha e o servidor não publica
  nada novo daquele espaço até liberar.

## Contas do Instagram
Conecte quantas quiser em Ajustes › Instagram e escolha a **padrão**. Cada
Novo Reel vem com a padrão marcada em "Publicar em" e dá para trocar; a edição
também troca. Na Agenda, filtre por conta.

## Comandos (caixa "Diga o que fazer" no Início, ou `POST /v1/comandos`)
| Você diz | O que acontece |
|---|---|
| Programe este vídeo amanhã às 10h | agenda o último rascunho (crie pelo Novo Reel) para amanhã 10:00 America/Sao_Paulo |
| Coloque este vídeo no próximo horário da fila | usa o próximo horário livre da frequência |
| Mostre minha agenda da semana | lista hoje + 6 dias |
| Altere para dois vídeos por dia (às 10h e às 18h) | mostra a prévia do que muda; só aplica no "Confirmar" |
| Pause as próximas publicações / Retome as publicações | pausa/retoma a fila inteira |
| Mostre o motivo desta falha | lista falhas com o motivo |

Datas relativas são resolvidas na hora do pedido, no fuso do espaço.
Faltou algo essencial (hora, qual vídeo)? O sistema pergunta só isso.

## O que cada confirmação significa
- **Demonstração (simulado)** — nada saiu do aparelho/servidor; nada no Instagram.
- **Agendamento confirmado no servidor do Jarvis** — gravado e relido do banco;
  o worker publica no horário. Ainda não existe no Instagram (a API não tem
  fila nativa; não aparece em "programados" do app).
- **Publicação concluída no Instagram** — o Instagram devolveu o ID da mídia e
  o Jarvis leu o permalink.

## Roteiro de aceite no aparelho (para o dono; ~5 min)
1. Abrir a URL no celular, entrar, ver o Início sem tela quebrada.
2. Novo Reel: vídeo e capa da galeria, legenda, amanhã 10:00, Programar.
3. Fechar o navegador, abrir de novo: o mesmo agendamento na Agenda, com fuso.
4. Editar o horário, Pausar, Retomar, Cancelar (sem terminal, sem GitHub).
5. Modo avião durante o envio → voltar → Programar de novo: um agendamento só.
6. Fechar tudo e, depois do horário de um post de teste autorizado, abrir:
   o recibo mostra o permalink (processado pelo servidor sozinho).
7. Pedir ao Claude uma mudança pequena no painel e abrir a versão nova.
Instalar na tela inicial: menu do Chrome › *Adicionar à tela inicial*.

## API (resumo; contrato em `openapi.json`)
Base: `https://SEU_REF.supabase.co/functions/v1/api` com
`Authorization: Bearer <token do login>` e `apikey: <anon>`.
`GET /v1/eu` · `POST /v1/midias` → `PUT` na URL assinada → `POST /v1/midias/{id}/finalizar` ·
`POST /v1/posts` (exige `chave_idempotencia`) · `GET /v1/posts?de=&ate=` ·
`PATCH /v1/posts/{id}` (exige `versao`) · `POST /v1/posts/{id}/agendar|pausar|retomar|cancelar` ·
`POST /v1/frequencia/previa` · `PUT /v1/frequencia` (exige `hash_previa` se algo muda) ·
`POST /v1/fila/pausar|retomar` · `POST /v1/comandos` · `POST /v1/instagram/conectar`.

## ChatGPT / MCP
Ainda **não instalado**. O backend já é a fonte única; falta um token de
serviço com escopo e o adaptador MCP (Etapa C). Até lá, operação pelo painel.
