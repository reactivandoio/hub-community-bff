// REA-51: incremental parser of a text/event-stream (the termhub run events). Fed with raw chunks
// as they arrive; calls onMessage({ id, event, data }) at each blank line. Comment lines (": keep-alive")
// are ignored, \r\n and \r line ends are accepted, multi-line data is joined with \n.

export const createSSEParser = (onMessage) => {
  let buffer = '';
  let id = null;
  let event = '';
  let data = [];
  const decoder = new TextDecoder();

  const dispatch = () => {
    if (data.length || event) onMessage({ id, event: event || 'message', data: data.join('\n') });
    event = '';
    data = [];
  };

  const line = (text) => {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return undefined;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
    return undefined;
  };

  return {
    feed(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let match = buffer.match(/\r\n|\r|\n/);
      while (match) {
        // A lone \r at the very end may be the first half of \r\n: wait for the next chunk.
        if (match[0] === '\r' && match.index === buffer.length - 1) break;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = buffer.match(/\r\n|\r|\n/);
      }
    },
    /** The last id seen (the run event seq), to resume with Last-Event-ID. */
    get lastId() {
      return id;
    },
  };
};
