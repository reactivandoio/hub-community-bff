const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * REA-22: "Finalize sua inscrição". A paid signup made without login, so the person
 * gets back to the Pix (or a new one) from the e-mail if the page was closed. The
 * "Inscrição confirmada" e-mail still comes from the Opa Pingou webhook once paid.
 *
 * @param {Object} params
 * @param {string} params.userName
 * @param {string} params.eventTitle
 * @param {string} params.paymentUrl - /events/<slug>/signup?pagamento=<signup id>
 * @param {string|null} params.deadline - "14:35" (America/Sao_Paulo), or null
 */
export const paymentPendingTemplate = ({ userName, eventTitle, paymentUrl, deadline }) => {
  const name = escapeHtml(userName);
  const title = escapeHtml(eventTitle);
  const url = escapeHtml(paymentUrl);
  const until = deadline
    ? `Sua vaga fica reservada até as <strong style="color:#ffffff;">${escapeHtml(deadline)}</strong>. Depois disso, é só abrir o link de novo e fazer a inscrição outra vez.`
    : 'Se o Pix vencer, é só abrir o link de novo e fazer a inscrição outra vez.';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Finalize sua inscrição</title>
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
                ⏳ Finalize sua inscrição
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#d1d5db;">
                Olá, <strong style="color:#ffffff;">${name}</strong>! Recebemos sua inscrição no <strong style="color:#ffffff;">${title}</strong>. Ela é confirmada assim que o pagamento cair.
              </p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#d1d5db;">
                ${until}
              </p>
              <p style="margin:28px 0 0;text-align:center;">
                <a href="${url}" style="display:inline-block;padding:14px 32px;background-color:#22c55e;color:#0f1117;text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">
                  Ver o Pix e pagar
                </a>
              </p>
              <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;">
                Quando o pagamento for confirmado, você recebe outro email com o seu ingresso.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#666;">
                Você recebeu este email porque uma inscrição no evento <strong style="color:#888;">${title}</strong> foi feita com este endereço.
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

export default paymentPendingTemplate;
