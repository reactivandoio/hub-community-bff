import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_EVENTS, applyEvent, handleMailgunWebhook, parseEvent, verifySignature,
} from './index';

const KEY = 'key-test-signing';
const sign = (key = KEY, timestamp = '1763258400', token = 'tok123') => ({
  timestamp,
  token,
  signature: crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex'),
});

const eventData = (extra = {}) => ({
  id: 'ev-1',
  event: 'delivered',
  timestamp: 1763258400.5,
  recipient: 'ana@x.io',
  'client-info': { 'client-name': 'Chrome' },
  geolocation: { city: 'Goiânia' },
  ip: '1.2.3.4',
  message: { headers: { 'message-id': 'abc@mg.hub' } },
  ...extra,
});

const env = { MAILGUN_WEBHOOK_SIGNING_KEY: KEY };

const integration = (row = { documentId: 'd1', events: [] }) => ({
  findEmailDeliveryByMessageId: vi.fn().mockResolvedValue(row),
  updateEmailDelivery: vi.fn().mockResolvedValue({}),
});

describe('verifySignature (REA-52)', () => {
  it('accepts Mailgun\'s HMAC of timestamp + token and refuses anything else', () => {
    expect(verifySignature(KEY, sign())).toBe(true);
    expect(verifySignature('other-key', sign())).toBe(false);
    expect(verifySignature(KEY, { ...sign(), token: 'changed' })).toBe(false);
    expect(verifySignature(KEY, { ...sign(), signature: 'nothex' })).toBe(false);
    expect(verifySignature('', sign())).toBe(false);
    expect(verifySignature(KEY, null)).toBe(false);
  });
});

describe('parseEvent', () => {
  it('keeps what happened to the e-mail, never IP, location or device', () => {
    const { messageId, event } = parseEvent(eventData());
    expect(messageId).toBe('abc@mg.hub');
    expect(event).toEqual({
      id: 'ev-1', event: 'delivered', severity: null, reason: null, message: null, url: null,
      at: new Date(1763258400500).toISOString(),
    });
    expect(JSON.stringify(event)).not.toMatch(/1\.2\.3\.4|Goiânia|Chrome/);
  });

  it('keeps the reason of a failure and the link of a click', () => {
    const failed = parseEvent(eventData({
      event: 'failed', severity: 'permanent', reason: 'bounce',
      'delivery-status': { message: '550 5.1.1 mailbox does not exist' },
    })).event;
    expect(failed).toMatchObject({ severity: 'permanent', reason: 'bounce', message: '550 5.1.1 mailbox does not exist' });
    expect(parseEvent(eventData({ event: 'clicked', url: 'https://hub.io/e' })).event.url).toBe('https://hub.io/e');
  });

  it('ignores untracked events and events without a message id', () => {
    expect(parseEvent(eventData({ event: 'stored' }))).toBeNull();
    expect(parseEvent(eventData({ message: {} }))).toBeNull();
    expect(parseEvent(eventData({ message: { headers: { 'message-id': '<abc@mg.hub>' } } })).messageId).toBe('abc@mg.hub');
  });
});

describe('applyEvent', () => {
  const at = (s) => new Date(1763258400000 + s * 1000).toISOString();

  it('keeps the events in time order and the last one on top', () => {
    const row = { events: [{ id: 'b', event: 'opened', at: at(10) }] };
    const patch = applyEvent(row, { id: 'a', event: 'delivered', at: at(1) });
    expect(patch.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(patch).toMatchObject({ last_event: 'opened', last_event_at: at(10) });
  });

  it('applies each Mailgun event once (retries)', () => {
    expect(applyEvent({ events: [{ id: 'a', event: 'delivered', at: at(1) }] }, { id: 'a', event: 'delivered', at: at(1) })).toBeNull();
  });

  it('keeps at most the last MAX_EVENTS', () => {
    const events = Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: `e${i}`, event: 'opened', at: at(i) }));
    const patch = applyEvent({ events }, { id: 'new', event: 'clicked', at: at(999) });
    expect(patch.events).toHaveLength(MAX_EVENTS);
    expect(patch.events[0].id).toBe('e1');
  });
});

describe('handleMailgunWebhook', () => {
  it('is off without the signing key, and records nothing', async () => {
    const ds = integration();
    const out = await handleMailgunWebhook({ body: { signature: sign(), 'event-data': eventData() }, integration: ds, env: {} });
    expect(out.status).toBe(503);
    expect(ds.findEmailDeliveryByMessageId).not.toHaveBeenCalled();
  });

  it('refuses a bad signature', async () => {
    const ds = integration();
    const out = await handleMailgunWebhook({ body: { signature: sign('wrong'), 'event-data': eventData() }, integration: ds, env });
    expect(out.status).toBe(401);
    expect(ds.updateEmailDelivery).not.toHaveBeenCalled();
  });

  it('adds the event to the e-mail it names', async () => {
    const ds = integration();
    const out = await handleMailgunWebhook({ body: { signature: sign(), 'event-data': eventData() }, integration: ds, env });
    expect(out.status).toBe(200);
    expect(ds.findEmailDeliveryByMessageId).toHaveBeenCalledWith('abc@mg.hub');
    expect(ds.updateEmailDelivery).toHaveBeenCalledWith('d1', expect.objectContaining({ last_event: 'delivered' }));
  });

  it('answers 200 to an e-mail of another system on the same Mailgun account', async () => {
    const ds = integration(null);
    const out = await handleMailgunWebhook({ body: { signature: sign(), 'event-data': eventData() }, integration: ds, env });
    expect(out).toEqual({ status: 200, body: { ok: true, ignored: 'message' } });
    expect(ds.updateEmailDelivery).not.toHaveBeenCalled();
  });

  it('applies two events of one message one after the other, so none is lost', async () => {
    let stored = { documentId: 'd1', events: [] };
    const ds = {
      findEmailDeliveryByMessageId: vi.fn(async () => ({ ...stored })),
      updateEmailDelivery: vi.fn(async (_id, patch) => {
        await new Promise((r) => setTimeout(r, 5));
        stored = { ...stored, ...patch };
      }),
    };
    await Promise.all([
      handleMailgunWebhook({ body: { signature: sign(), 'event-data': eventData({ id: 'x1' }) }, integration: ds, env }),
      handleMailgunWebhook({ body: { signature: sign(), 'event-data': eventData({ id: 'x2', event: 'opened', timestamp: 1763258460 }) }, integration: ds, env }),
    ]);
    expect(stored.events.map((e) => e.id)).toEqual(['x1', 'x2']);
    expect(stored.last_event).toBe('opened');
  });
});
