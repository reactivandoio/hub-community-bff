/**
 * E-mail sent when a certificate is issued or re-sent.
 *
 * @param {Object} params
 * @param {string} params.userName
 * @param {string} params.eventTitle
 * @param {string} params.certificateUrl - page with preview + download
 * @param {string} params.verifyUrl - public verification page
 * @param {string} params.baseUrl
 */
export const certificateIssuedTemplate = ({
  userName,
  eventTitle,
  certificateUrl,
  verifyUrl,
  baseUrl = 'https://hubcommunity.io',
}) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seu certificado — ${eventTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f1117;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding:24px 0 32px;">
              <a href="${baseUrl}" style="font-size:24px;font-weight:700;color:#22c55e;letter-spacing:-0.5px;text-decoration:none;">🌐 Hub Community</a>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#1a1d27;border-radius:16px;overflow:hidden;border:1px solid #2a2d37;">
                <tr>
                  <td style="background:linear-gradient(135deg,#059669,#10b981);padding:32px 24px;text-align:center;">
                    <div style="width:64px;height:64px;background-color:rgba(255,255,255,0.15);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:32px;">🎓</div>
                    <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Seu certificado está pronto!</h1>
                    <p style="margin:8px 0 0;font-size:15px;color:rgba(255,255,255,0.85);">Olá <strong>${userName}</strong>, obrigado por participar.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">${eventTitle}</h2>
                    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#b0b0b0;">
                      Seu certificado de participação foi emitido. Clique abaixo para visualizar e baixar o PDF.
                    </p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <a href="${certificateUrl}" style="display:inline-block;padding:14px 32px;background-color:#22c55e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">Baixar certificado →</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#888;text-align:center;">
                      Autenticidade: <a href="${verifyUrl}" style="color:#22c55e;">${verifyUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#666;">Você recebeu este e-mail porque participou do evento <strong style="color:#888;">${eventTitle}</strong>.</p>
              <p style="margin:8px 0 0;font-size:12px;color:#555;">© ${new Date().getFullYear()} Hub Community. Todos os direitos reservados.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
