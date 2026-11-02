# Studio Beleza — site com agendamento online

Site da esmalteria da Manu e da Mylena (Miguel Pereira – RJ) com agendamento em 5 etapas, agenda individual de cada profissional, integração com o Google Agenda, e-mails automáticos e painel administrativo.

## Como funciona

- **Site** (`public/`): página inicial e agendamento. Mostra só horários realmente livres.
- **Servidor** (`netlify/functions/`): funções da Netlify que calculam a disponibilidade, gravam os agendamentos, falam com o Google e mandam e-mails.
- **Banco** (Supabase): serviços, profissionais, horários, bloqueios, clientes e agendamentos. O próprio banco impede dois atendimentos sobrepostos para a mesma profissional, mesmo que duas clientes confirmem no mesmo segundo.
- **Painel** (`/admin.html`): agenda, clientes, serviços, horários e folgas, profissionais (conexão com o Google) e dados do estúdio.

Um horário aparece livre no site quando: está dentro do expediente da profissional, cabe a duração do serviço antes do fim da faixa, não há agendamento nem bloqueio (folga, feriado, bloqueio manual) e não há compromisso na agenda Google dela.

## Passo a passo

### 1. Supabase (banco e login do painel)
1. Crie um projeto em supabase.com (plano gratuito).
2. Em **SQL Editor**, cole todo o arquivo `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication › Users › Add user**, crie um usuário para a Manu e outro para a Mylena (e-mail e senha). Marque "Auto confirm".
4. No **SQL Editor**, ligue cada e-mail à profissional (letras minúsculas):
   ```sql
   update profissionais set email = 'email.da.manu@gmail.com'   where slug = 'manu';
   update profissionais set email = 'email.da.mylena@gmail.com' where slug = 'mylena';
   ```
5. Em **Project Settings › API**, copie a URL, a chave `anon` e a chave `service_role` (essa é secreta: só vai para a Netlify).

### 2. Google Agenda
1. Em console.cloud.google.com, crie um projeto (ex.: "Studio Beleza").
2. **APIs e serviços › Biblioteca**: ative a **Google Calendar API**.
3. **Tela de consentimento OAuth**: tipo **Externo**, nome "Studio Beleza", e-mail de suporte. Em escopos, adicione `calendar.events` e `calendar.freebusy`.
4. **Importante:** depois de configurar, clique em **Publicar aplicativo** (status "Em produção"). Em modo "Teste", o Google desconecta as agendas a cada 7 dias. Como só a Manu e a Mylena vão conectar, não é preciso passar pela verificação do Google: na hora de conectar aparece um aviso de app não verificado, e basta clicar em "Avançado › Acessar Studio Beleza".
5. **Credenciais › Criar credenciais › ID do cliente OAuth › Aplicativo da Web**. Em "URIs de redirecionamento autorizados", coloque:
   `https://SEU-SITE.netlify.app/api/google-callback`
6. Copie o ID do cliente e a chave secreta.

### 3. E-mails (Resend)
1. Crie conta em resend.com e verifique um domínio (ex.: `studiobeleza.com.br`). Sem domínio verificado, o Resend só envia para o seu próprio e-mail.
2. Gere uma API key.

Mesmo sem o Resend, se a agenda Google da profissional estiver conectada, a cliente recebe o convite do Google com todos os detalhes (e o aviso de cancelamento ou mudança).

### 4. Netlify
As funções precisam de deploy pelo Git ou pela CLI (arrastar a pasta para o Netlify Drop não publica as funções).

**Pelo GitHub:** suba esta pasta para um repositório, em Netlify clique em **Add new site › Import from Git** e escolha o repositório. As configurações de build já estão no `netlify.toml`.

**Pela CLI:** `npm install`, depois `npx netlify-cli deploy --prod`.

Em **Site configuration › Environment variables**, cadastre as variáveis do arquivo `.env.example`. Para gerar a `ENCRYPTION_KEY`:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Depois de cadastrar as variáveis, faça um novo deploy.

### 5. Primeiro acesso ao painel
Abra `https://SEU-SITE/admin.html` e entre com o e-mail da Manu ou da Mylena.
1. **Estúdio**: preencha o endereço e o link do Google Maps.
2. **Serviços**: cadastre os procedimentos, preços e durações.
3. **Horários e folgas**: monte o expediente de cada uma (duas faixas no mesmo dia criam o intervalo do almoço). Bloqueie feriados e folgas.
4. **Profissionais**: cada uma clica em **Conectar Google Agenda** e entra com a própria conta Google. Aproveite para pôr foto e apresentação.

A agenda só abre no site depois que houver serviços e horários cadastrados.

### 6. Fotos
- Foto principal do site: salve como `public/img/hero.jpg` (vertical, de preferência). Sem ela, aparece o monograma SB.
- Fotos das profissionais e dos serviços: cole o link da imagem no painel.
- O logo no topo é uma recriação do monograma SB. Se quiser usar o arquivo original, troque o `<symbol id="logo">` no `index.html`.

## Aviso no WhatsApp da profissional
A cada novo agendamento (e também quando um horário é remarcado ou cancelado), a profissional escolhida recebe no WhatsApp dela uma mensagem com o nome e o WhatsApp da cliente, o serviço, a data e o horário. O envio usa o CallMeBot, que é gratuito.

Cada profissional ativa uma vez, no próprio celular:
1. Entre em callmebot.com, abra a página da **WhatsApp API** e veja o número atual do CallMeBot (ele muda de tempos em tempos).
2. Salve esse número nos contatos do celular.
3. Mande para ele, pelo WhatsApp, a mensagem que o site indicar (hoje é `I allow callmebot to send me messages`).
4. Em alguns minutos chega uma resposta com o **apikey**, um código só de números.
5. No painel, em **Profissionais**, cole o código no campo **Código do CallMeBot**, clique em **Salvar** e depois em **Enviar mensagem de teste**.

O aviso vai para o número cadastrado no campo WhatsApp da profissional, então ele precisa ser o mesmo celular que fez a ativação. O CallMeBot é um serviço gratuito e pode atrasar alguns minutos em horários de pico; o agendamento é gravado mesmo que o aviso falhe.

## Notificações
| Momento | E-mail (Resend) | Google Agenda | WhatsApp |
|---|---|---|---|
| Confirmação | sim | convite automático | opcional |
| 24 h antes | sim | lembrete do próprio Google | opcional |
| Horas antes (configurável) | sim | — | opcional |
| Cancelamento | sim | aviso de cancelamento | opcional |
| Mudança de data/horário | sim | convite atualizado | opcional |

Os lembretes rodam a cada 15 minutos (função agendada `lembretes`).

**WhatsApp automático:** exige a WhatsApp Business Cloud API da Meta (conta Business verificada, número dedicado e modelos de mensagem aprovados, com custo por conversa). Quando estiver pronta, preencha `WA_TOKEN`, `WA_PHONE_ID` e os nomes dos modelos (`WA_TPL_*`). Cada modelo recebe 4 variáveis: nome, serviço, data e horário. Enquanto isso, o painel tem um botão de WhatsApp em cada agendamento que abre a conversa com o lembrete já escrito.

## Agenda da cliente
A cliente recebe o horário na agenda dela de três formas, todas com autorização dela:
- convite do Google enviado ao e-mail (no Gmail ele já aparece na agenda; basta aceitar);
- botão **Adicionar ao Google Agenda**, que abre a agenda dela com o evento preenchido para ela salvar;
- botão **Salvar na agenda do celular** (arquivo .ics, funciona no iPhone, Android e Outlook).

Optamos por não pedir login Google da cliente: isso exigiria a verificação completa do app pelo Google (com política de privacidade e análise de segurança) e daria ao estúdio acesso de escrita à agenda pessoal dela, sem ganho real em relação ao convite.

## Observações técnicas
- Fuso fixo de Brasília (UTC−3). Se o horário de verão voltar, ajuste `OFFSET` em `netlify/lib/util.js` e `-03:00` nos arquivos de `public/js/`.
- Tokens do Google ficam criptografados (AES-256-GCM) no banco; o navegador nunca vê as chaves.
- Todas as tabelas têm RLS ligado sem políticas públicas: só o servidor acessa os dados.
- Para atender também por profissional/serviço específico no futuro (ex.: a Mylena não faz alongamento), dá para criar uma tabela ligando serviço e profissional e filtrar em `disponibilidade.js`.
