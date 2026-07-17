/**
 * Shared numeric limits referenced from both server and client code, kept
 * here (rather than in a server-only module) so client components can
 * import them without pulling in server-only dependencies (Db, Redis, ...).
 */

/**
 * Max attachments allowed on a single chat message. Enforced by:
 * - the turn service (`server/services/turns.ts`, `validateMessageAttachments`)
 * - the HTTP route schema (`routes/api/chat.ts`, `Schema.maxItems`)
 * - the composer UI (`components/chat/composer.tsx`, `maxFiles`)
 */
export const MAX_MESSAGE_ATTACHMENTS = 10;
