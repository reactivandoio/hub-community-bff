import { describe, expect, it } from 'vitest';
import { createSSEParser } from './sse';

const parse = (chunks) => {
  const out = [];
  const parser = createSSEParser((m) => out.push(m));
  chunks.forEach((c) => parser.feed(c));
  return { out, parser };
};

describe('SSE parser', () => {
  it('reads id, event and data, and keeps the last id', () => {
    const { out, parser } = parse(['id: 3\nevent: text\ndata: {"text":"oi"}\n\n']);
    expect(out).toEqual([{ id: '3', event: 'text', data: '{"text":"oi"}' }]);
    expect(parser.lastId).toBe('3');
  });

  it('ignores keep-alive comments', () => {
    const { out } = parse([': keep-alive\n\n', ': keep-alive\n\nid: 1\nevent: started\ndata: {}\n\n']);
    expect(out).toEqual([{ id: '1', event: 'started', data: '{}' }]);
  });

  it('joins events split across chunks, including a \\r\\n split in two', () => {
    const { out } = parse(['id: 1\r', '\nevent: te', 'xt\r\ndata: {"t', 'ext":"a"}\r\n\r\n']);
    expect(out).toEqual([{ id: '1', event: 'text', data: '{"text":"a"}' }]);
  });

  it('joins multi-line data and defaults the event name', () => {
    const { out } = parse(['data: a\ndata: b\n\n']);
    expect(out).toEqual([{ id: null, event: 'message', data: 'a\nb' }]);
  });

  it('accepts bytes', () => {
    const { out } = parse([new TextEncoder().encode('event: done\ndata: {}\n\n')]);
    expect(out[0].event).toBe('done');
  });
});
