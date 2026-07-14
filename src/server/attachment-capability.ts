import { createHmac, timingSafeEqual } from "node:crypto";
import { appEnv, appSecretValue } from "~/server/env";

const signature = (fileId: string, userId: string, expires: number): string =>
  createHmac("sha256", appSecretValue())
    .update(`parley.attachment.v1\0${fileId}\0${userId}\0${expires}`)
    .digest("base64url");

export function createAttachmentCapabilityUrl(
  fileId: string,
  userId: string,
  now = Date.now(),
): string {
  const expires = Math.floor(now / 1000) + appEnv.attachmentCapabilityTtlSec;
  const url = new URL(
    `/api/attachments/${encodeURIComponent(fileId)}`,
    appEnv.appUrl,
  );
  url.searchParams.set("user", userId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature(fileId, userId, expires));
  return url.toString();
}

export function verifyAttachmentCapability(
  fileId: string,
  userId: string,
  expires: number,
  candidate: string,
  now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expires) || expires < Math.floor(now / 1000)) {
    return false;
  }
  const expected = Buffer.from(signature(fileId, userId, expires));
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
