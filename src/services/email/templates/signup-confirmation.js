/**
 * Generates the HTML email for event signup confirmation.
 *
 * @param {Object} params
 * @param {string} params.userName - The attendee's name
 * @param {string} params.eventTitle - Event title
 * @param {string} params.eventDate - Formatted date string
 * @param {string} params.eventTime - Formatted time string
 * @param {string} params.eventLocation - Location name or "Online"
 * @param {string} params.eventDescription - Short event description
 * @param {string} params.eventImage - Cover image URL
 * @param {string} params.eventSlug - Event slug for link
 * @param {string} params.productName - Product/ticket name
 * @param {boolean} params.isFree - If it's a free event
 * @param {boolean} params.isOnline - If it's an online event
 * @param {string} params.callLink - Online call link (if applicable)
 * @param {string} params.baseUrl - Base URL for links (e.g. https://hubcommunity.io)
 * @param {string} [params.ticketUrl] - Ticket URL (the one the QR encodes); renders
 *        the "Seu ingresso" block
 * @param {string} [params.ticketQrCid] - cid of the inline QR attachment; the block
 *        shows the image only when it is set
 * @param {string} [params.setPasswordUrl] - Link for an account without a password
 *        yet; renders the "Crie sua senha" block
 */
export const signupConfirmationTemplate = ({
  userName,
  eventTitle,
  eventDate,
  eventTime,
  eventLocation,
  eventDescription,
  eventImage,
  eventSlug,
  productName,
  isFree,
  isOnline,
  callLink,
  baseUrl = 'https://hubcommunity.io',
  ticketUrl = null,
  ticketQrCid = null,
  setPasswordUrl = null,
}) => {
  const eventUrl = `${baseUrl}/events/${eventSlug}`;
  const truncatedDescription = eventDescription
    ? eventDescription.length > 200
      ? eventDescription.substring(0, 200) + '...'
      : eventDescription
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inscrição Confirmada — ${eventTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f1117;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding:24px 0 32px;">
              <span style="font-size:24px;font-weight:700;color:#22c55e;letter-spacing:-0.5px;">
                🌐 Hub Community
              </span>
            </td>
          </tr>

          <!-- Hero Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#1a1d27;border-radius:16px;overflow:hidden;border:1px solid #2a2d37;">

                <!-- Success Banner -->
                <tr>
                  <td style="background:linear-gradient(135deg,#059669,#10b981);padding:32px 24px;text-align:center;">
                    <div style="width:64px;height:64px;background-color:rgba(255,255,255,0.15);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:32px;">
                      ✅
                    </div>
                    <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">
                      Inscrição Confirmada!
                    </h1>
                    <p style="margin:8px 0 0;font-size:15px;color:rgba(255,255,255,0.85);">
                      Olá <strong>${userName}</strong>, sua inscrição foi realizada com sucesso.
                    </p>
                  </td>
                </tr>

                ${eventImage ? `
                <!-- Event Image -->
                <tr>
                  <td style="padding:0;">
                    <img src="${eventImage}" alt="${eventTitle}" width="600" style="width:100%;height:200px;object-fit:cover;display:block;" />
                  </td>
                </tr>
                ` : ''}

                <!-- Event Info -->
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">${eventTitle}</h2>

                    <!-- Info Grid -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50%" style="padding:8px 8px 8px 0;vertical-align:top;">
                          <div style="background-color:#22c55e15;border:1px solid #22c55e30;border-radius:12px;padding:16px;">
                            <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#22c55e;font-weight:600;">📅 Data</span>
                            <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:#ffffff;">${eventDate}</p>
                          </div>
                        </td>
                        <td width="50%" style="padding:8px 0 8px 8px;vertical-align:top;">
                          <div style="background-color:#22c55e15;border:1px solid #22c55e30;border-radius:12px;padding:16px;">
                            <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#22c55e;font-weight:600;">🕐 Horário</span>
                            <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:#ffffff;">${eventTime}</p>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding:8px 8px 8px 0;vertical-align:top;">
                          <div style="background-color:#22c55e15;border:1px solid #22c55e30;border-radius:12px;padding:16px;">
                            <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#22c55e;font-weight:600;">${isOnline ? '📡 Formato' : '📍 Local'}</span>
                            <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:#ffffff;">${isOnline ? 'Online' : eventLocation || 'A definir'}</p>
                          </div>
                        </td>
                        <td width="50%" style="padding:8px 0 8px 8px;vertical-align:top;">
                          <div style="background-color:#22c55e15;border:1px solid #22c55e30;border-radius:12px;padding:16px;">
                            <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#22c55e;font-weight:600;">🎫 Ingresso</span>
                            <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:#ffffff;">${productName || 'Ingresso'}${isFree ? ' (Grátis)' : ''}</p>
                          </div>
                        </td>
                      </tr>
                    </table>

                    ${truncatedDescription ? `
                    <!-- Description -->
                    <div style="margin-top:20px;padding:16px;background-color:rgba(255,255,255,0.03);border-radius:12px;border:1px solid #2a2d37;">
                      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#888;font-weight:600;">Sobre o evento</span>
                      <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#b0b0b0;">${truncatedDescription}</p>
                    </div>
                    ` : ''}

                    ${isOnline && callLink ? `
                    <!-- Online Call Link -->
                    <div style="margin-top:20px;padding:20px;background-color:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:12px;text-align:center;">
                      <span style="font-size:14px;font-weight:600;color:#22c55e;">🔗 Link da Chamada Online</span>
                      <p style="margin:8px 0 0;">
                        <a href="${callLink}" style="font-size:14px;color:#22c55e;text-decoration:underline;word-break:break-all;">${callLink}</a>
                      </p>
                    </div>
                    ` : ''}

                    ${ticketUrl ? `
                    <!-- Ticket -->
                    <div style="margin-top:20px;padding:20px;background-color:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:12px;text-align:center;">
                      <span style="font-size:14px;font-weight:600;color:#22c55e;">🎟️ Seu ingresso</span>
                      ${ticketQrCid ? `
                      <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#d1d5db;">
                        Apresente este QR code na entrada do evento para fazer seu check-in.
                      </p>
                      <div style="margin:16px auto 0;width:220px;padding:10px;background-color:#ffffff;border-radius:12px;">
                        <img src="cid:${ticketQrCid}" alt="QR code do ingresso" width="200" height="200" style="display:block;width:200px;height:200px;" />
                      </div>
                      ` : `
                      <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#d1d5db;">
                        Abra o link abaixo para ver o QR code do seu ingresso e apresente-o na entrada do evento.
                      </p>
                      `}
                      <p style="margin:12px 0 0;">
                        <a href="${ticketUrl}" style="font-size:14px;color:#22c55e;text-decoration:underline;word-break:break-all;">Ver meu ingresso</a>
                      </p>
                    </div>
                    ` : ''}

                    ${setPasswordUrl ? `
                    <!-- Set password -->
                    <div style="margin-top:20px;padding:20px;background-color:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.3);border-radius:12px;">
                      <div style="margin-bottom:8px;">
                        <span style="font-size:18px;">🔑</span>
                        <span style="font-size:14px;font-weight:600;color:#fbbf24;">Crie sua senha</span>
                      </div>
                      <p style="margin:0;font-size:14px;line-height:1.6;color:#d1d5db;">
                        Criamos uma conta no Hub Community para você com este email. Sua inscrição <strong style="color:#ffffff;">já está garantida</strong> — crie sua senha para acessar a plataforma e acompanhar seus eventos.
                      </p>
                      <p style="margin:16px 0 0;text-align:center;">
                        <a href="${setPasswordUrl}" style="display:inline-block;padding:12px 28px;background-color:#fbbf24;color:#0f1117;text-decoration:none;font-size:14px;font-weight:600;border-radius:50px;">
                          Crie sua senha
                        </a>
                      </p>
                      <p style="margin:12px 0 0;font-size:13px;color:#9ca3af;">
                        O link vale para um único uso. Se você receber outro email como este, use o link mais recente.
                      </p>
                    </div>
                    ` : ''}

                    <!-- CTA Button -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;">
                      <tr>
                        <td align="center">
                          <a href="${eventUrl}" style="display:inline-block;padding:14px 32px;background-color:#22c55e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">
                            Ver página do evento →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#666;">
                Você recebeu este email porque se inscreveu no evento <strong style="color:#888;">${eventTitle}</strong>.
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
