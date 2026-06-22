import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: process.env.SPACES_ENDPOINT ?? 'https://blr1.digitaloceanspaces.com',
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.SPACES_KEY!,
        secretAccessKey: process.env.SPACES_SECRET!,
      },
      forcePathStyle: false,
    });
  }
  return _client;
}

const BUCKET = process.env.SPACES_BUCKET ?? 'arham-migration';

export async function stageBlobToSpaces(key: string, data: Buffer): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: data,
    ACL: 'private',
  }));
}

export async function fetchBlobFromSpaces(key: string): Promise<Buffer> {
  const resp = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = resp.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function deleteStagedBlob(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {/* ignore */});
}

export function spacesKey(jobId: string, userId: string, uid: number): string {
  return `migration/${jobId}/${userId}/${uid}.eml`;
}
