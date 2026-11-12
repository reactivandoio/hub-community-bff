// REA-26: the login code e-mail. The same e-mail serves the login and the signup (a new e-mail gets
// its account when the code is confirmed), so it never says whether the account exists.

export const LOGIN_CODE_SUBJECT = (code) => `${code} é o seu código de acesso ao Hub Community`;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * @param {Object} params
 * @param {string} params.code - 6 digits
 * @param {number} params.minutes - how long it is valid
 */
export const loginCodeTemplate = ({ code, minutes }) => {
  const safeCode = escapeHtml(code);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seu código de acesso</title>
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
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">Seu código de acesso</h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#d1d5db;">Digite este código na tela de acesso do Hub Community:</p>
              <p style="margin:24px 0 0;text-align:center;">
                <span style="display:inline-block;padding:16px 28px;background-color:#0f1117;border:1px solid #2a2d37;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:8px;color:#fbbf24;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${safeCode}</span>
              </p>
              <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#d1d5db;">O código vale por ${Number(minutes) || 10} minutos e só pode ser usado uma vez. Se você pedir outro, este deixa de valer.</p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#9ca3af;">Não pediu este código? Pode ignorar este email: ninguém entra na sua conta sem ele. Nunca compartilhe o código com outra pessoa.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#555;">© ${new Date().getFullYear()} Hub Community. Todos os direitos reservados.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
