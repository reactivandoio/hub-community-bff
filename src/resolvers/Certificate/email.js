import { sendEmail } from '../../services/email';
import { certificateIssuedTemplate } from '../../services/email/templates/certificate-issued';

export const sendCertificateEmail = async ({ certificate, event, baseUrl }) => {
  const base = baseUrl || process.env.FRONTEND_URL || 'https://hubcommunity.io';
  const html = certificateIssuedTemplate({
    userName: certificate.name,
    eventTitle: event.title,
    certificateUrl: `${base}/certificado/${certificate.code}`,
    verifyUrl: `${base}/certificado/verificar/${certificate.code}`,
    baseUrl: base,
  });
  return sendEmail({
    to: certificate.email,
    subject: `🎓 Seu certificado — ${event.title}`,
    html,
  });
};
