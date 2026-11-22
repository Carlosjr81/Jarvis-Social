# Colocar o Jarvis Social no ar — o mínimo de passos, tudo pelo celular

Custo: **R$ 0** nos planos gratuitos (confira os limites atuais nos sites;
mudam). Nenhuma senha ou token vai para a conversa.

O que é automático (o workflow *Jarvis Social* faz sozinho a cada envio):
achar ou **criar o projeto** `jarvis-social` em São Paulo, aplicar o banco
(sem senha do banco), gerar a chave de cifra e o segredo do worker, publicar
a API, o worker e o conector do ChatGPT/Claude, ligar o relógio de 1 minuto,
configurar o login para o endereço do painel e gravar o endereço do servidor
no painel e no contrato do GPT.

## Passo 1 — o único segredo (5 min)
1. Entre em https://supabase.com/dashboard com **Continue with GitHub**
   (cria a conta grátis; não precisa criar projeto).
2. Abra https://supabase.com/dashboard/account/tokens › **Generate new token**
   (nome `jarvis-social`) › copie.
3. Abra https://github.com/Carlosjr81/Jarvis-Social/settings/secrets/actions ›
   **New repository secret** › nome `JS_SUPABASE_ACCESS_TOKEN` › cole › Add.
4. Diga ao Claude **"continue"** (ou: Actions › Jarvis Social › Run workflow).

Em ~5 minutos o painel deixa a demonstração e mostra **Criar conta**.

## Passo 2 — sua conta de dono (1 min)
No painel: **Criar conta** com o seu e-mail › confirme pelo link do e-mail ›
Entrar. **A primeira conta confirmada vira a dona** (aprova cadastros,
cobrança, app da Meta). Se preferir fixar outro e-mail: segredo opcional
`JS_EMAIL_DONO`.

## Passo 3 — Instagram (10 min, uma vez)
Pré-requisito: conta profissional (criador ou empresa).
No painel: **Ajustes › Instagram › Configurar o app da Meta**. A tela mostra
os links, o endereço de redirecionamento com botão de copiar e os dois
campos (ID do app e chave secreta). Salvar já abre a autorização do
Instagram. A chave secreta fica cifrada no servidor.

## Passo 4 — ChatGPT e Claude (2 min cada)
**Ajustes › Integrações › Criar chave** e use os botões:
- Claude: **Copiar p/ Claude** › **Abrir Conectores do Claude** › Adicionar
  conector personalizado › colar.
- ChatGPT: **Criar GPT** › Instruções (**Copiar instruções do GPT**) › Ações
  › Importar de URL (**Copiar link do contrato**) › Autenticação Bearer
  (**Copiar chave p/ GPT**).

## Passo 5 — piloto automático (1 toque)
**Ajustes › Frequência**: escolha os horários e ligue **Piloto
automático**. Daí em diante, todo rascunho (seu, do ChatGPT ou do Claude)
entra sozinho no próximo horário livre, e o servidor publica.

A lista **Configuração: N de 6** no Início mostra o que falta, com o atalho
de cada item.

## Opcionais (segredos do GitHub)
`JS_EMAIL_DONO` (fixar o dono), `JS_SUPABASE_PROJECT_REF` (usar um projeto
existente), `JS_META_APP_ID`/`JS_META_APP_SECRET` (em vez do painel).

> A confirmar na primeira execução real (escrito sem acesso às páginas
> oficiais): rotas da API de gerenciamento do Supabase (`projects`,
> `database/query`, `config/auth`, `api-keys`), `functions deploy --use-api`,
> e os nomes de telas e permissões da Meta. O Claude lê o log do workflow e
> corrige o que divergir.
