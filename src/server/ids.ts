/**
 * Prefixed, URL-safe, sortable-enough random identifiers in the spirit of
 * Open Responses object ids (`resp_...`, `msg_...`).
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

export const newId = (prefix: string) => `${prefix}_${randomSuffix()}`;

export const conversationId = () => newId("conv");
export const turnId = () => newId("turn");
export const itemId = () => newId("item");
export const agentId = () => newId("agent");
export const fileId = () => newId("file");
