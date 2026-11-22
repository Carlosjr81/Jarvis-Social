# ChatGPT e Claude gerenciando a grade de Reels

**Como no Metricool**: na conversa você diz "programe este Reel amanhã às
10h, legenda X, vídeo neste link" e o assistente chama `agendar_reel`: o
servidor baixa o vídeo do link (Google Drive compartilhado como "qualquer
pessoa com o link", Dropbox ou MP4 direto), confere, guarda e programa, e
devolve o recibo. Arquivo anexado direto na conversa não é um link público:
suba no Drive (ou no painel) e passe o link.

Os assistentes usam **a mesma API do painel** (mesma fonte da verdade): veem a
grade de publicação futura, encaixam rascunhos nos horários livres, programam,
editam, pausam, cancelam e mudam a frequência (sempre com prévia). Vídeos
novos entram pelo painel (Novo Reel › Salvar como rascunho, ou Biblioteca); o
assistente programa o que já está lá.

**Estado (22/11/2026): pronto no código e testado com o banco simulado (113
testes, incluindo o login OAuth completo). Não testado no ChatGPT/Claude
reais**: depende do servidor no ar (`docs/DEPLOY.md`: um segredo só).

## Conectar (como no Metricool: endereço + Permitir, sem copiar chave)
Endereço do conector: `https://SEU_REF.supabase.co/functions/v1/mcp`
(o painel copia sozinho em Início › Configuração › **Conectar ChatGPT/Claude**).

**ChatGPT** (no navegador; o Modo desenvolvedor depende do plano):
1. Configurações › **Apps e conectores** › Avançado › ligue o **Modo desenvolvedor**.
2. **Criar**: Nome `Jarvis Social` · URL do servidor MCP: cole · Autenticação: **OAuth** › Criar.
3. O ChatGPT abre o painel do Jarvis (`#autorizar/...`): entre e toque em **Permitir**
   (ou "Permitir só ler"). Volta sozinho para o ChatGPT.
4. Na conversa, escolha o Jarvis Social (＋ › Mais / Modo desenvolvedor) e peça.

**Claude**: Configurações › Conectores › Adicionar conector personalizado ›
cole o endereço › Adicionar › **Conectar** › Permitir.

Como funciona: o servidor publica os metadados OAuth em
`<endereço>/.well-known/oauth-protected-resource`, `.../oauth-authorization-server`
e `.../openid-configuration`; o assistente se registra sozinho (`/oauth/register`),
abre `/oauth/authorize` (PKCE S256), que manda para o painel, e troca o código
em `/oauth/token`. O token é uma chave de integração comum (aparece em Ajustes ›
Integrações como "ChatGPT (conectado)", revoga-se ali), vale 7 dias e renova
sozinho por 180 dias. Código: `oauth.js`, `mcp-http.js`; testes: `teste-oauth.mjs`.

**Sem OAuth** (cliente que só aceita "sem autenticação"): no mesmo botão,
"Sem OAuth? Usar chave no endereço" gera `.../mcp/js_...` (trate como senha).

**Plano do ChatGPT sem Modo desenvolvedor: GPT personalizado com Ações**:
1. chatgpt.com › Explorar GPTs › **Criar** › Configurar.
2. **Instruções**: cole o bloco abaixo.
3. **Ações › Criar nova ação › Importar de URL**: `https://carlosjr81.github.io/Jarvis-Social/openapi-chatgpt.json`.
4. **Autenticação › Chave de API › Bearer** › a chave `js_...` (botão 4 do painel).
5. Salve (privado: "Só eu").

Instruções para o GPT:
```
Você gerencia a grade de Reels do Instagram do dono pelo Jarvis Social.
Comece por verGrade. Datas no fuso America/Sao_Paulo (AAAA-MM-DD e HH:MM).
Antes de mudar a frequência, mostre previaFrequencia e só aplique com o OK do dono.
Antes de cancelar, confirme. "Agendado no Jarvis" não é "publicado"; publicado só com permalink.
Para Reel novo use agendarReel com o link do vídeo (Drive "qualquer pessoa com o link", Dropbox ou MP4 direto). Arquivo anexado não é link: peça o link do Drive. Confirme antes de publicar agora.
Responda em português, curto, com a lista de horários e o estado de cada post.
```

## Ferramentas (MCP) e ações (ChatGPT)
**agendar_reel** · importar_video · ver_grade · ver_agenda · listar_rascunhos · listar_videos · ver_publicacao ·
criar_rascunho · programar · preencher_grade · editar_publicacao ·
pausar/retomar/cancelar_publicacao · pausar/retomar_fila ·
previa_frequencia · aplicar_frequencia · comando (português livre).

## Segurança
- A chave não entra em: painel, perfil, conta do Instagram, cadastro, chaves,
  upload de mídia. Escopo "Só ler" não muda nada.
- Conta do dono bloqueada, vencida ou sem plano: a chave para junto.
- Pendente: OAuth para o conector (hoje a chave vai no endereço) e registro
  de auditoria por chave.
