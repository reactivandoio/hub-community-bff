const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * REA-48: invite to organize a community or manage an event in the Hub admin. The link opens the
 * login by code (REA-26) with the invited e-mail; once in, the access is there.
 *
 * @param {Object} params
 * @param {'community_organizer'|'event_manager'} params.kind
 * @param {string} params.targetTitle - The community or the event
 * @param {string} params.inviterName - Who invited
 * @param {string} params.url - The /convite?t= link
 * @param {number} params.days - How long the link is valid
 */
export const managementInviteTemplate = ({ kind, targetTitle, inviterName, url, days }) => {
  const title = escapeHtml(targetTitle);
  const inviter = escapeHtml(inviterName || 'A equipe do Hub Community');
  const community = kind === 'community_organizer';
  const heading = community ? '🤝 Convite para organizar uma comunidade' : '🎟️ Convite para gerir um evento';
  const what = community
    ? `organizar a comunidade <strong style="color:#ffffff;">${title}</strong> no Hub Community: editar a comunidade e gerir todos os eventos dela`
    : `gerir o evento <strong style="color:#ffffff;">${title}</strong> no Hub Community: editar o evento, acompanhar inscrições e presenças, certificados e e-mails`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${community ? 'Convite para organizar' : 'Convite para gerir'} ${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f1117;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding:24px 0 32px;">
              <span style="font-size:24px;font-weight:700;color:#22c55e;letter-spacing:-0.5px;">
                🌐 Hub Community
              </span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#1a1d27;border-radius:16px;border:1px solid #2a2d37;padding:32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">
                ${heading}
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#d1d5db;">
                <strong style="color:#ffffff;">${inviter}</strong> convidou você para ${what}.
              </p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#d1d5db;">
                Para aceitar, entre no Hub com este e-mail: você recebe um código de acesso, sem precisar de senha. Se ainda não tem conta, ela é criada no primeiro acesso.
              </p>
              <p style="margin:28px 0 0;text-align:center;">
                <a href="${url}" style="display:inline-block;padding:14px 32px;background-color:#22c55e;color:#0f1117;text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">
                  Aceitar o convite
                </a>
              </p>
              <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;">
                O convite vale por ${Number(days) || 7} dias e só funciona com este e-mail. Se você não esperava este convite, ignore esta mensagem.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#555;">
                © ${new Date().getFullYear()} Hub Community. Todos os direitos reservados.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export default managementInviteTemplate;
