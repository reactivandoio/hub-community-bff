import { sendEmail } from './index';
import { completeRegistrationTemplate } from './templates/complete-registration';

const frontendUrl = () => process.env.FRONTEND_URL || 'https://hubcommunity.io';

// REA-26: there is no password any more. The link opens the login (code sent to the e-mail) and,
// once in, the complete-profile form.
export const completeRegistrationUrlFor = (baseUrl) => `${baseUrl.replace(/\/$/, '')}/completar-cadastro`;

/**
 * The "Conclua seu cadastro" e-mail of an account created for the person (signup without login,
 * manual signup at the door). Never throws: resolves { success, error? }.
 */
export const sendCompleteRegistration = async ({ email, name, eventTitle }) => {
  if (!email) return { success: false, error: 'no e-mail' };
  try {
    return await sendEmail({
      kind: 'complete-registration',
      to: email,
      subject: '✍️ Conclua seu cadastro no Hub Community',
      html: completeRegistrationTemplate({
        userName: name || email.split('@')[0],
        eventTitle: eventTitle || 'evento',
        completeRegistrationUrl: completeRegistrationUrlFor(frontendUrl()),
      }),
    });
  } catch (err) {
    console.error(`[Email] Could not send complete-registration to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
};
