import { sendEmail } from './index';
import { completeRegistrationTemplate } from './templates/complete-registration';

const frontendUrl = () => process.env.FRONTEND_URL || 'https://hubcommunity.io';

export const setPasswordUrlFor = (baseUrl, token) =>
  `${baseUrl.replace(/\/$/, '')}/criar-senha?code=${encodeURIComponent(token)}`;

/**
 * The "Conclua seu cadastro" e-mail with the set-password link of an account just
 * created. Never throws: resolves { success, error? }.
 */
export const sendCompleteRegistration = async ({ email, name, eventTitle, token }) => {
  if (!email || !token) return { success: false, error: 'no e-mail or token' };
  try {
    return await sendEmail({
      to: email,
      subject: '🔑 Conclua seu cadastro no Hub Community',
      html: completeRegistrationTemplate({
        userName: name || email.split('@')[0],
        eventTitle: eventTitle || 'evento',
        setPasswordUrl: setPasswordUrlFor(frontendUrl(), token),
      }),
    });
  } catch (err) {
    console.error(`[Email] Could not send complete-registration to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
};
