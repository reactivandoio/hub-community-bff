import { describe, it, expect } from 'vitest';
import { defaultSubject, eventCampaignTemplate } from './event-campaign';

const event = { title: 'Meetup React', dateStr: 'terça-feira, 10 de novembro de 2026', timeStr: '19:00', locationStr: 'Goiânia - GO' };
const base = { event, eventUrl: 'https://hub.io/events/meetup?utm_source=email', unsubscribeUrl: 'https://hub.io/descadastro?t=abc.def' };

describe('eventCampaignTemplate', () => {
  it('shows the event data, the signup link and the unsubscribe link', () => {
    const html = eventCampaignTemplate({ ...base, type: 'invite' });
    for (const text of ['Meetup React', 'terça-feira, 10 de novembro de 2026', '19:00', 'Goiânia - GO', 'Quero me inscrever',
      'https://hub.io/events/meetup?utm_source=email', 'https://hub.io/descadastro?t=abc.def', 'Descadastrar']) {
      expect(html).toContain(text);
    }
  });

  it('escapes what the admin and the event bring', () => {
    const html = eventCampaignTemplate({
      ...base, type: 'reminder', event: { ...event, title: '<b>x</b>' }, message: '<script>alert(1)</script>\n\nSegundo', recipientName: '<i>Ana</i>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<i>Ana</i>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Segundo');
  });

  it('gives a signup the personal link, WhatsApp, LinkedIn and the art', () => {
    const shareUrl = 'https://hub.io/events/meetup?ref=AbC123_-xy';
    const html = eventCampaignTemplate({ ...base, type: 'share', shareUrl, artUrl: 'https://hub.io/events/meetup/arte' });
    expect(html).toContain(shareUrl);
    expect(html).toContain('https://wa.me/?text=');
    expect(html).toContain(encodeURIComponent(shareUrl));
    expect(html).toContain('linkedin.com/sharing/share-offsite');
    expect(html).toContain('https://hub.io/events/meetup/arte');
  });

  it('has no share block outside the share e-mail', () => {
    expect(eventCampaignTemplate({ ...base, type: 'reminder', shareUrl: 'https://x/ref' })).not.toContain('wa.me');
  });
});

describe('defaultSubject', () => {
  it('names the event', () => {
    expect(defaultSubject('invite', 'Meetup')).toBe('📣 Você está convidado: Meetup');
    expect(defaultSubject('share', 'Meetup')).toBe('🤝 Convide alguém para Meetup');
    expect(defaultSubject('reminder', 'Meetup')).toBe('⏰ Lembrete: Meetup está chegando');
  });
});
