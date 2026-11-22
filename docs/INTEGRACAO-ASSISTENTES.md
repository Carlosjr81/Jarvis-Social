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

**Estado (22/11/2026): pronto no código e testado com o banco simulado (101
testes). Não instalado nem testado no ChatGPT/Claude reais**: depende do
servidor no ar (`docs/DEPLOY.md`: um segredo só).

## 1. Criar a chave (no painel, uma vez por assistente)
Ajustes › **Integrações: ChatGPT e Claude** › nome, escopo ("Ler e
programar" ou "Só ler"), validade › **Criar chave**. Ela aparece **uma vez**
com o endereço do conector. Vale só para o seu espaço; revogue quando quiser
(efeito imediato). O servidor guarda só a impressão digital (SHA-256).

## 2. Claude (claude.ai, celular ou computador)
Configurações › **Conectores** › **Adicionar conector personalizado** › cole o
endereço `https://SEU_REF.supabase.co/functions/v1/mcp/js_...` › Adicionar. Na
conversa, ative o conector "jarvis-social" e peça, por exemplo:
- "Mostre a grade de Reels da semana."
- "Encaixe os rascunhos nos horários livres."
- "Mude para dois por dia, às 10h e às 18h" (ele mostra a prévia e pede OK).

O endereço contém a chave: trate como senha. (Se a tela do Claude pedir OAuth,
este conector ainda não tem; use o endereço com a chave.)

## 3. ChatGPT
**Opção A — GPT personalizado com Ações** (plano que permite criar GPTs):
1. chatgpt.com › Explorar GPTs › **Criar** › Configurar.
2. **Instruções**: cole o bloco abaixo.
3. **Ações › Criar nova ação › Importar** o conteúdo de
   `openapi-chatgpt.json` (o workflow de implantação já troca `SEU_REF` pelo
   endereço real).
4. **Autenticação › Chave de API › Bearer** › cole a chave `js_...`.
5. Salve (privado: "Só eu").

**Opção B — conector MCP** (quando o seu plano/modo do ChatGPT permitir
conectores personalizados): use o mesmo endereço do Claude.

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
