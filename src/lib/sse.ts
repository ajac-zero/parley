/**
 * Minimal, spec-correct Server-Sent Events parser shared by the browser
 * (consuming Parley's chat stream) and the server (consuming agent streams).
 */

export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

export class SseParser {
  #buffer = "";
  #event: string | undefined;
  #id: string | undefined;
  #dataLines: string[] = [];

  /** Feed a decoded chunk; returns any complete messages. */
  push(chunk: string): SseMessage[] {
    this.#buffer += chunk;
    const messages: SseMessage[] = [];

    for (;;) {
      const match = this.#buffer.match(/\r\n|\n|\r/);
      if (!match || match.index === undefined) break;
      // A CR at the end of a chunk may be the first half of CRLF. Defer it
      // until the next chunk so the following LF is not treated as a blank line.
      if (match[0] === "\r" && match.index === this.#buffer.length - 1) break;
      const line = this.#buffer.slice(0, match.index);
      this.#buffer = this.#buffer.slice(match.index + match[0].length);
      const message = this.#processLine(line);
      if (message) messages.push(message);
    }

    return messages;
  }

  /** Flush a trailing lone CR when the byte stream reaches EOF. */
  finish(): SseMessage[] {
    return this.#buffer.endsWith("\r") ? this.push("\n") : [];
  }

  #processLine(line: string): SseMessage | undefined {
    if (line === "") {
      // Dispatch the accumulated event.
      if (this.#dataLines.length === 0) {
        this.#event = undefined;
        return undefined;
      }
      const message: SseMessage = {
        data: this.#dataLines.join("\n"),
        ...(this.#event !== undefined ? { event: this.#event } : {}),
        ...(this.#id !== undefined ? { id: this.#id } : {}),
      };
      this.#event = undefined;
      this.#dataLines = [];
      return message;
    }

    if (line.startsWith(":")) return undefined; // comment

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        this.#event = value;
        break;
      case "data":
        this.#dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\u0000")) this.#id = value;
        break;
      default:
        // "retry" and unknown fields are ignored.
        break;
    }
    return undefined;
  }
}

export const SSE_DONE = "[DONE]";

/** Parse a byte stream of SSE frames into messages. */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      for (const message of parser.push(
        decoder.decode(value, { stream: true }),
      )) {
        yield message;
      }
    }
    for (const message of parser.push(decoder.decode())) {
      yield message;
    }
    for (const message of parser.finish()) {
      yield message;
    }
  } finally {
    // Cancel (not just release) so the underlying HTTP connection is freed
    // even when the consumer exits early, e.g. on a `[DONE]` sentinel.
    try {
      await reader.cancel();
    } catch {
      // Already errored or closed; nothing to free.
    }
    reader.releaseLock();
  }
}

/** Serialize a message as an SSE frame. */
export function formatSseFrame(message: SseMessage): string {
  let frame = "";
  if (message.id !== undefined) frame += `id: ${message.id}\n`;
  if (message.event !== undefined) frame += `event: ${message.event}\n`;
  for (const line of message.data.split("\n")) {
    frame += `data: ${line}\n`;
  }
  return `${frame}\n`;
}
