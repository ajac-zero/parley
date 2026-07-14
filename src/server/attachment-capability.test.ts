import { describe, expect, it } from "vitest";
import {
  createAttachmentCapabilityUrl,
  verifyAttachmentCapability,
} from "~/server/attachment-capability";

describe("attachment capabilities", () => {
  it("binds the signature to file, user, and expiration", () => {
    const now = 1_700_000_000_000;
    const url = new URL(createAttachmentCapabilityUrl("file-1", "user-1", now));
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";

    expect(url.pathname).toBe("/api/attachments/file-1");
    expect(expires).toBe(Math.floor(now / 1000) + 900);
    expect(
      verifyAttachmentCapability("file-1", "user-1", expires, signature, now),
    ).toBe(true);
    expect(
      verifyAttachmentCapability("file-2", "user-1", expires, signature, now),
    ).toBe(false);
    expect(
      verifyAttachmentCapability("file-1", "user-2", expires, signature, now),
    ).toBe(false);
    expect(
      verifyAttachmentCapability(
        "file-1",
        "user-1",
        expires,
        signature,
        (expires + 1) * 1000,
      ),
    ).toBe(false);
  });
});
