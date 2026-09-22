# Inscrição sem senha + email de confirmação com QR e "Crie sua senha"

Data: 2026-09-22 · Projetos: hub-community-backend, hub-community-bff, hub-community-frontend

## Objetivo

Reduzir o atrito da inscrição pela tela do evento e garantir que todo participante — inscrito pelo
site, pelo admin (manual) ou importado via CSV — receba **um único email** com o QR code do ingresso
e, quando a conta ainda não tem senha, um link para criá-la.

Sucesso:
- A tela `/events/[id]/signup` pede só nome, email e telefone (sem senha) e inscreve na hora.
- O email "Inscrição confirmada" traz o QR (evento presencial e gratuito/pago confirmado) e o botão
  "Crie sua senha" quando a conta está pendente.
- Importação CSV passa a criar conta e enviar o email; admin consegue reenviar para todos os
  importados de um evento pelo `/admin/events`.

## Decisões

- Um email só, montado pelo bff. O Strapi só cria a conta e gera o token; não envia email.
- Importados ganham conta + link de senha.
- Reenvio em massa não guarda "já enviado": reenviar gera um token novo (o link anterior deixa de valer).
- Email nunca derruba a inscrição.
- Evento pago: hoje o email sai na inscrição, com o PIX ainda pendente. O email desse caso **não leva
  QR** (leva o link de senha). QR após confirmação do pagamento fica fora do escopo.
- Evento online: sem QR; mantém o bloco com o link da chamada.

## Contrato 1 — Backend (Strapi 5.23.5)

**Campo novo** em `plugin::users-permissions.user`: `password_pending: boolean`, default `false`,
`private: true`. Contas existentes ficam `false`.

**`POST /api/account-setup`** — só para o bff (API token de integração `MANAGER_TOKEN_INTEGRATION`;
não público).

Request: `{ "email": string, "name"?: string, "phone"?: string }`

Comportamento:
1. Email normalizado (trim + lowercase). Email inválido → 400.
2. Se não existe usuário com o email: cria (provider `local`, `username` derivado do email + sufixo
   aleatório, senha aleatória forte, `confirmed: true`, role padrão de `authenticated`,
   `name`, `phone`, `password_pending: true`).
3. Se o usuário tem `password_pending: true` (novo ou antigo): gera token
   (`crypto.randomBytes(64).toString('hex')`), grava em `resetPasswordToken`, devolve o token.
4. Se `password_pending: false`: não mexe em nada, token `null`.

Response 200: `{ "created": boolean, "token": string | null }`

**Override de `auth.resetPassword`** (mesmo estilo do override de `emailConfirmation` em
`src/index.ts`): após o reset bem-sucedido, grava `password_pending: false` no usuário.

O link usa o fluxo existente: frontend `/criar-senha?code={token}` → mutation `resetPassword` do bff →
`/auth/reset-password` do Strapi.

## Contrato 2 — BFF

**`services/email/signup-confirmation.js`** — `sendSignupConfirmation({ dataSources, eventSlug,
eventandoEvent?, signupId, name, email, phone?, isFree })`:
1. Chama `managerIntegration.accountSetup({ email, name, phone })`. Falha → segue sem token (log).
2. Busca dados do evento (lógica atual de `sendSignupConfirmationEmail` em `resolvers/Event/index.js`,
   movida para cá).
3. QR (lib `qrcode`, PNG) do ticket URL
   `{FRONTEND_URL}/events/{slug}/signup?ticket={signupId}` — mesmo contrato de
   `hub-community-frontend/src/lib/ticket.ts`. Só quando: presencial **e** gratuito **e** `signupId`.
   Anexo inline `cid:ticket-qr`. Falha → segue só com o link do ingresso (log).
4. Template `signupConfirmationTemplate` ganha `ticketQrCid`, `ticketUrl`, `setPasswordUrl`
   (`{FRONTEND_URL}/criar-senha?code={token}`). Blocos "Seu ingresso" e "Crie sua senha" só aparecem
   com os respectivos dados. Remove o bloco antigo de `needsEmailConfirmation`.
5. `sendEmail` aceita `attachments` (repasse ao nodemailer).

Nunca lança: erros viram log `[Email] ...`.

**Chamadores:**
- `signupToEvent` — continua sem senha/autenticação; troca `sendSignupConfirmationEmail` por
  `sendSignupConfirmation` com `signupId`.
- `manualSignup` — troca `managerPublic.signUp` + `forwardPassword` por `accountSetup` +
  `sendSignupConfirmation` (resposta mantém `account_created` = `created`).
- `importSignups` — guarda o id de cada signup criado; após o loop, dispara em segundo plano (sem
  `await` na resposta) o envio para quem tem email, concorrência 5; log resumo
  `[Email] import {slug}: X enviados, Y falharam`.
- **Mutation nova** `sendImportedSignupConfirmations(eventSlug: String!): BulkEmailResponse`
  (`success`, `message`, `queued_count`) — signups do evento cujo pagamento tem
  `payment_identification` começando com `IMPORT_` e com email; dispara em segundo plano; responde na
  hora.

## Contrato 3 — Frontend

- `/events/[id]/signup`: formulário inline sem senha (nome, email, telefone); remove `authSignUp`,
  `deriveUsername` e o bloqueio de email duplicado; mantém a trava de envio duplo
  (`lib/signup-lock.ts`). Sucesso: "Enviamos seu ingresso e o link para criar sua senha para {email}".
- Página nova `/criar-senha?code=`: igual à de reset de senha (mutation `resetPassword`), com texto de
  boas-vindas ("Crie sua senha"); ao concluir leva ao login.
- `/admin/events`: ícone `Mail` nas ações de cada evento → diálogo de confirmação → mutation
  `sendImportedSignupConfirmations(eventSlug)` → toast "{n} emails na fila".

## Testes

- Backend: serviço de account-setup (cria, reaproveita pendente, não gera token para conta com senha,
  email inválido) e override de reset limpando `password_pending`.
- BFF (jest/vitest do repo): template com/sem QR e com/sem senha; regras de QR (online, pago, sem id);
  `sendSignupConfirmation` sem lançar quando account-setup/QR/SMTP falham; `importSignups` dispara
  envio com os ids certos; mutation nova filtra só `IMPORT_` com email.
- Frontend: schema do formulário sem senha; montagem do link/texto; testes existentes verdes.

## Ordem de deploy

backend → bff → frontend. O bff tolera o endpoint ausente (email sai sem link de senha).
