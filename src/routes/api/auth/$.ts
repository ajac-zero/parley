import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/server/auth";
import { ensureBoot } from "~/server/boot";

const handler = async ({ request }: { request: Request }) => {
  await ensureBoot();
  return auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
