import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssistantAttachment,
  attachmentKindForMime,
  fileRefToUrl,
  formatFileSize,
  isParleyAttachmentItem,
  PreparingArtifact,
} from "./items";

describe("attachment helpers", () => {
  it("maps stored file references without changing general URLs", () => {
    expect(fileRefToUrl("parley-file:file-1")).toBe("/api/files/file-1");
    expect(fileRefToUrl("https://example.com/file.pdf")).toBe(
      "https://example.com/file.pdf",
    );
  });

  it("accepts only internal references for assistant attachments", () => {
    const item = {
      type: "parley:attachment",
      id: "artifact-1",
      status: "completed",
      filename: "report.pdf",
      mime_type: "application/pdf",
      size: 10,
      file_url: "parley-file:file_abc123",
    } as const;
    expect(isParleyAttachmentItem(item)).toBe(true);
    expect(
      isParleyAttachmentItem({
        ...item,
        file_url: "https://provider.example/private-download",
      }),
    ).toBe(false);
  });

  it("uses decimal file size units and handles invalid values", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(999)).toBe("999 B");
    expect(formatFileSize(1_000)).toBe("1 KB");
    expect(formatFileSize(1_500)).toBe("1.5 KB");
    expect(formatFileSize(1_000_000)).toBe("1 MB");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
  });

  it("promotes units when rounding reaches the next threshold", () => {
    expect(formatFileSize(999_949)).toBe("999.9 KB");
    expect(formatFileSize(999_999)).toBe("1 MB");
    expect(formatFileSize(999_999_999)).toBe("1 GB");
  });

  it.each([
    ["text/csv", "spreadsheet"],
    ["application/vnd.ms-excel", "spreadsheet"],
    ["image/png", "image"],
    ["audio/mpeg", "audio"],
    ["video/mp4", "video"],
    ["application/zip", "archive"],
    ["application/json", "code"],
    ["application/pdf", "pdf"],
    ["text/plain", "text"],
    ["application/octet-stream", "file"],
  ] as const)("classifies %s as %s", (mime, kind) => {
    expect(attachmentKindForMime(mime)).toBe(kind);
  });
});

describe("artifact cards", () => {
  it("renders pending artifacts without exposing the provider URL", () => {
    const markup = renderToStaticMarkup(
      createElement(PreparingArtifact, {
        item: {
          type: "ajac-zero:artifact",
          id: "artifact-1",
          status: "completed",
          filename: "report.xlsx",
          mime_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 1_500,
          content_url: "https://provider.example/private-download",
        },
      }),
    );

    expect(markup).toContain("Preparing download");
    expect(markup).toContain("report.xlsx");
    expect(markup).not.toContain("provider.example");
    expect(markup).not.toContain("href=");
  });

  it("renders durable attachments as authenticated downloads", () => {
    const markup = renderToStaticMarkup(
      createElement(AssistantAttachment, {
        item: {
          type: "parley:attachment",
          id: "artifact-1",
          status: "completed",
          filename: "report.xlsx",
          mime_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 1_500,
          file_url: "parley-file:file_abc123",
        },
      }),
    );

    expect(markup).toContain('href="/api/files/file_abc123"');
    expect(markup).toContain('download="report.xlsx"');
    expect(markup).toContain("report.xlsx");
    expect(markup).toContain("1.5 KB");
  });
});
