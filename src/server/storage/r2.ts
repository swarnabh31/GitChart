import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getR2Config, assertLiveStorageAllowedForTests } from "./config";

export interface R2Storage {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  head(key: string): Promise<{ size: number; eTag: string } | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

function buildClient(config = getR2Config()): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function createR2Storage(bucket: "public" | "private" = "public"): R2Storage {
  assertLiveStorageAllowedForTests("r2");
  const config = getR2Config();
  const targetBucket = bucket === "public" ? config.publicBucket : config.privateBucket;
  const client = buildClient(config);

  return {
    async put(key, body, contentType) {
      const data = Buffer.from(body);
      await client.send(
        new PutObjectCommand({
          Bucket: targetBucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          Metadata: { service: "gitchart" },
        })
      );
      return this.publicUrl(key);
    },

    async get(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: targetBucket, Key: key })
        );
        const bytes = await res.Body?.transformToByteArray();
        if (!bytes) return null;
        return {
          body: Buffer.from(bytes),
          contentType: (res.ContentType ?? "application/octet-stream") as string,
        };
      } catch (err: unknown) {
        const code =
          (err as { name?: string; code?: string })?.name ??
          (err as { name?: string; code?: string })?.code;
        if (code === "NoSuchKey" || code === "NotFound") return null;
        throw err;
      }
    },

    async head(key) {
      try {
        const res = await client.send(
          new HeadObjectCommand({ Bucket: targetBucket, Key: key })
        );
        return { size: res.ContentLength ?? 0, eTag: res.ETag ?? "" };
      } catch (err: unknown) {
        const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } })
          ?.name;
        const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })
          ?.$metadata?.httpStatusCode;
        if (code === "NotFound" || httpStatus === 404) return null;
        throw err;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: key }));
    },

    publicUrl(key) {
      const base = config.publicBaseUrl.replace(/\/$/, "");
      return `${base}/${key.replace(/^\//, "")}`;
    },
  };
}

export function artifactKey(owner: string, repo: string, id: string): string {
  return `diagrams/${owner.toLowerCase()}/${repo.toLowerCase()}/${id}.png`;
}
