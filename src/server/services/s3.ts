import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Effect, Redacted } from "effect";
import { appEnv } from "~/server/env";

function createClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: appEnv.s3Region,
    forcePathStyle: appEnv.s3ForcePathStyle,
    credentials: {
      accessKeyId: appEnv.s3AccessKeyId,
      secretAccessKey: Redacted.value(appEnv.s3SecretAccessKey),
    },
  });
}

/** Client used for actual object reads/writes (always reachable by the app). */
const client = createClient(appEnv.s3Endpoint);

/**
 * A second client pointed at the publicly-reachable endpoint, used only for
 * signing URLs handed to external agents. Signing is a local, offline
 * cryptographic operation — this client never makes a network call itself —
 * so it's safe to construct even if `s3PublicUrl` isn't actually reachable
 * from this process (only the agent needs to reach it later).
 */
const publicClient = appEnv.s3PublicUrl
  ? createClient(appEnv.s3PublicUrl)
  : null;

/**
 * Thin wrapper around the S3-compatible object store used for attachments.
 * Bucket must already exist (see docker-compose's bucket-init step, or
 * create it manually against a real S3/R2/B2 endpoint).
 */
export class S3 extends Effect.Service<S3>()("S3", {
  succeed: {
    putObject: (key: string, body: Uint8Array, contentType: string) =>
      Effect.promise(() =>
        client.send(
          new PutObjectCommand({
            Bucket: appEnv.s3Bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
          }),
        ),
      ),

    getObjectBytes: (key: string) =>
      Effect.promise(async () => {
        const res = await client.send(
          new GetObjectCommand({ Bucket: appEnv.s3Bucket, Key: key }),
        );
        const bytes = await res.Body?.transformToByteArray();
        return bytes ?? new Uint8Array(0);
      }),

    getObjectStream: (key: string) =>
      Effect.promise(async () => {
        const res = await client.send(
          new GetObjectCommand({ Bucket: appEnv.s3Bucket, Key: key }),
        );
        if (!res.Body) throw new Error("Object body is missing.");
        return res.Body.transformToWebStream();
      }),

    /** Verifies the bucket is reachable and accessible, for health checks. */
    ping: Effect.promise(() =>
      client.send(new HeadBucketCommand({ Bucket: appEnv.s3Bucket })),
    ),

    /**
     * Presigned GET URL for an external agent to fetch directly, or `null`
     * if no publicly-reachable endpoint is configured (`S3_PUBLIC_URL`).
     */
    getPresignedUrl: (key: string, expiresInSeconds: number) =>
      publicClient
        ? Effect.promise(() =>
            getSignedUrl(
              publicClient,
              new GetObjectCommand({ Bucket: appEnv.s3Bucket, Key: key }),
              { expiresIn: expiresInSeconds },
            ),
          )
        : Effect.succeed(null),
  },
}) {}
