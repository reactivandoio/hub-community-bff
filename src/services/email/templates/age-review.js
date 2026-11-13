// REA-36: the two e-mails of the age review in /admin/usuarios (Hub is 18+ only).
// - minorBlocked: the account was deactivated because the date of birth is under 18.
// - dateOfBirthRequest: the account has no date of birth; it is asked for, with a 7-day deadline.

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const layout = ({ title, heading, body }) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f1117;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding:24px 0 32px;">
              <span style="font-size:24px;font-weight:700;color:#22c55e;letter-spacing:-0.5px;">🌐 Hub Community</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#1a1d27;border-radius:16px;border:1px solid #2a2d37;padding:32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">${heading}</h1>
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#666;">Você recebeu este email porque tem uma conta no Hub Community.</p>
              <p style="margin:8px 0 0;font-size:12px;color:#555;">© ${new Date().getFullYear()} Hub Community. Todos os direitos reservados.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const paragraph = (html, top = 16) =>
  `<p style="margin:${top}px 0 0;font-size:15px;line-height:1.6;color:#d1d5db;">${html}</p>`;

const button = (href, label) => `<p style="margin:28px 0 0;text-align:center;">
                <a href="${href}" style="display:inline-block;padding:14px 32px;background-color:#fbbf24;color:#0f1117;text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">${label}</a>
              </p>`;

const greeting = (userName) => {
  const name = escapeHtml(userName);
  return name ? `Olá, <strong style="color:#ffffff;">${name}</strong>.` : 'Olá.';
};

export const MINOR_BLOCKED_SUBJECT = 'Sua conta no Hub Community foi desativada';
export const DOB_REQUEST_SUBJECT = 'Informe sua data de nascimento para manter sua conta no Hub Community';

/** @param {{ userName?: string }} params */
export const minorBlockedTemplate = ({ userName }) => layout({
  title: MINOR_BLOCKED_SUBJECT,
  heading: 'Sua conta foi desativada',
  body: [
    paragraph(greeting(userName), 0),
    paragraph('Desativamos sua conta no Hub Community porque a data de nascimento cadastrada nela indica que você tem menos de 18 anos.'),
    paragraph('A plataforma e os eventos do Hub Community são só para pessoas com 18 anos ou mais. Com a conta desativada, não é possível entrar nem fazer novas inscrições.'),
    paragraph('Se a data de nascimento estiver errada, responda este email informando a data correta e nós revisamos o seu caso.'),
  ].join('\n              '),
});

/**
 * @param {Object} params
 * @param {string} [params.userName]
 * @param {string} params.deadline - "dd/mm/aaaa", 7 days after this e-mail
 * @param {string} params.actionUrl - where to update the data (the login by code opens there, REA-26)
 */
export const dateOfBirthRequestTemplate = ({ userName, deadline, actionUrl }) => layout({
  title: DOB_REQUEST_SUBJECT,
  heading: 'Atualize sua data de nascimento',
  body: [
    paragraph(greeting(userName), 0),
    paragraph('O Hub Community é só para pessoas com 18 anos ou mais, e a sua conta ainda não tem data de nascimento.'),
    paragraph(`Para manter sua conta ativa, entre na plataforma com este email (você recebe um código de acesso, sem senha) e informe sua data de nascimento até <strong style="color:#ffffff;">${escapeHtml(deadline)}</strong>.`),
    paragraph('Se a data não for informada até lá, sua conta será desativada.'),
    button(actionUrl, 'Atualizar meus dados'),
    `<p style="margin:20px 0 0;font-size:13px;color:#9ca3af;">Se tiver alguma dúvida, é só responder este email.</p>`,
  ].join('\n              '),
});
