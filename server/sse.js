/**
 * Incremental parser for Server-Sent Events. Network chunks can split an
 * event (or even a line) anywhere, so text is buffered until a blank line
 * ends the event. Returns the `data:` payload of each complete event.
 */
export function createSSEParser() {
  let buffer = '';

  function takeEvents() {
    const events = [];
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      // Blocks with only comments (": keep-alive") or other fields carry no data.
      if (data) events.push(data);
    }
    return events;
  }

  return {
    feed(text) {
      buffer += text;
      return takeEvents();
    },
    /** Flushes a final event that wasn't followed by a blank line. */
    end() {
      buffer += '\n\n';
      return takeEvents();
    },
  };
}
