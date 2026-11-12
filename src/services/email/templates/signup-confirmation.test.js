import { describe, it, expect } from 'vitest';
import { signupConfirmationTemplate } from './signup-confirmation';

const base = {
  userName: 'Ana',
  eventTitle: 'Meetup',
  eventDate: 'sábado, 10 de outubro de 2026',
  eventTime: '19:00',
  eventLocation: 'Auditório',
  eventSlug: 'meetup',
  isFree: true,
  isOnline: false,
  baseUrl: 'https://hub.test',
};

describe('signupConfirmationTemplate', () => {
  it('shows the ticket QR (inline cid) and the ticket link when both are given', () => {
    const html = signupConfirmationTemplate({
      ...base,
      ticketQrCid: 'ticket-qr',
      ticketUrl: 'https://hub.test/events/meetup/signup?ticket=s1',
    });
    expect(html).toContain('Seu ingresso');
    expect(html).toContain('src="cid:ticket-qr"');
    expect(html).toContain('href="https://hub.test/events/meetup/signup?ticket=s1"');
  });

  it('keeps the ticket link without an image when the QR could not be generated', () => {
    const html = signupConfirmationTemplate({
      ...base,
      ticketUrl: 'https://hub.test/events/meetup/signup?ticket=s1',
    });
    expect(html).toContain('Seu ingresso');
    expect(html).not.toContain('cid:');
    expect(html).toContain('https://hub.test/events/meetup/signup?ticket=s1');
  });

  it('has no ticket block without a ticket', () => {
    const html = signupConfirmationTemplate(base);
    expect(html).not.toContain('Seu ingresso');
    expect(html).not.toContain('cid:');
  });

  it('shows the "Conclua seu cadastro" block while the registration is pending (REA-26)', () => {
    const html = signupConfirmationTemplate({
      ...base,
      completeRegistrationUrl: 'https://hub.test/completar-cadastro',
    });
    expect(html).toContain('Conclua seu cadastro');
    expect(html).toContain('href="https://hub.test/completar-cadastro"');
    expect(html).not.toContain('Crie sua senha');
  });

  it('has no complete-registration block when the registration is finished', () => {
    const html = signupConfirmationTemplate(base);
    expect(html).not.toContain('Conclua seu cadastro');
    expect(html).not.toContain('completar-cadastro');
  });

  it('no longer carries the old "confirme sua conta" reminder', () => {
    const html = signupConfirmationTemplate({ ...base, needsEmailConfirmation: true });
    expect(html).not.toContain('Confirme sua conta');
  });

  it('invites to the share-art page of the event, by slug', () => {
    const html = signupConfirmationTemplate(base);
    expect(html).toContain('Criar minha arte');
    expect(html).toContain('href="https://hub.test/events/meetup/arte"');
    expect(html).toContain('É só entrar no Hub Community com este email: enviamos um código de acesso na hora.');
  });
});
