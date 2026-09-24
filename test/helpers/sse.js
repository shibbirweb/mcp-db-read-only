/**
 * A minimal Server-Sent Events reader for tests.
 *
 * Collects events from a stream until `until(events)` is satisfied or the
 * timeout passes, then disconnects. Returns every event seen, as
 * `{ event, data }` with `data` parsed as JSON where it is JSON.
 */
export async function readEvents(url, until, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];

  try {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parse(block);
        if (parsed) {
          events.push(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      throw error;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

function parse(block) {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice(7);
    } else if (line.startsWith("data: ")) {
      data += line.slice(6);
    }
  }
  if (!data) {
    return null;
  }
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}

/** A port nothing is listening on right now, found by binding to 0 and closing. */
export async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
