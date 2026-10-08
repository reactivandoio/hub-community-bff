const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * "Conclua seu cadastro": sent apart from the signup confirmation when the account
 * was created at the door (manual signup), so finishing the registration does not
 * get lost among the event details.
 *
 * @param {Object} params
 * @param {string} params.userName - The attendee's name
 * @param {string} params.eventTitle - Event the account was created for
 * @param {string} params.setPasswordUrl - The /criar-senha link (single use)
 */
export const completeRegistrationTemplate = ({ userName, eventTitle, setPasswordUrl }) => {
  const name = escapeHtml(userName);
  const title = escapeHtml(eventTitle);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conclua seu cadastro no Hub Community</title>
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
                🔑 Conclua seu cadastro
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#d1d5db;">
                Olá, <strong style="color:#ffffff;">${name}</strong>! Criamos sua conta no Hub Community quando você se inscreveu no <strong style="color:#ffffff;">${title}</strong>.
              </p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#d1d5db;">
                Falta só criar sua senha para acessar a plataforma, ver seus ingressos e certificados e acompanhar os próximos eventos.
              </p>
              <p style="margin:28px 0 0;text-align:center;">
                <a href="${setPasswordUrl}" style="display:inline-block;padding:14px 32px;background-color:#fbbf24;color:#0f1117;text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">
                  Criar minha senha
                </a>
              </p>
              <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;">
                O link vale para um único uso. Se você receber outro email como este, use o link mais recente.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#666;">
                Você recebeu este email porque foi inscrito(a) no evento <strong style="color:#888;">${title}</strong>.
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#555;">
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
