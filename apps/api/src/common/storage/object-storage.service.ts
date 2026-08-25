import { Injectable } from '@nestjs/common';
import { getRequiredEnvVar } from '@saas-inventory/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

let client: S3Client | undefined;
let bucket: string | undefined;

function getClient(): { client: S3Client; bucket: string } {
  if (!client) {
    client = new S3Client({
      endpoint: getRequiredEnvVar('S3_ENDPOINT'),
      region: 'us-east-1',
      credentials: {
        accessKeyId: getRequiredEnvVar('S3_ACCESS_KEY'),
        secretAccessKey: getRequiredEnvVar('S3_SECRET_KEY'),
      },
      // MinIO/most self-hosted S3-compatible endpoints require path-style addressing
      // (bucket.endpoint.com virtual-hosted style needs per-bucket DNS, not available here).
      forcePathStyle: true,
    });
    bucket = getRequiredEnvVar('S3_BUCKET');
  }
  return { client, bucket: bucket! };
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

/**
 * The one S3-compatible object storage client this codebase has (security.md#file-upload-security,
 * database.md's `storage_key`/`error_report_storage_key` columns) — IMPORT (Prompt 10) is the first
 * module to actually need file storage; `product_images.storage_key` (Prompt 06) was schema-ready
 * but never wired to a real client. Every uploaded Excel file and generated error report is written
 * here, never held permanently in API process memory or on the container's local filesystem
 * (threat-model.md#malicious-file-upload).
 */
@Injectable()
export class ObjectStorageService {
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client: s3, bucket: bucketName } = getClient();
    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }));
  }

  async getObject(key: string): Promise<Buffer> {
    const { client: s3, bucket: bucketName } = getClient();
    const result = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    if (!result.Body) {
      throw new Error(`Object storage returned no body for key "${key}".`);
    }
    return streamToBuffer(result.Body as Readable);
  }

  async deleteObject(key: string): Promise<void> {
    const { client: s3, bucket: bucketName } = getClient();
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  }
}
