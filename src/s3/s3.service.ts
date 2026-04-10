import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { getRequiredEnv } from '../common/config/env.util';

type GenerateUploadUrlInput = {
  subTestId: string;
  fileName: string;
  mimeType: string;
  expiresInSeconds?: number;
};

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private s3Client: S3Client | null = null;

  // Lazy-initialized S3 client using EC2 IAM Role credentials (no explicit keys needed).
  private getClient(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({ region: getRequiredEnv('AWS_REGION') });
    }
    return this.s3Client;
  }

  private get bucket(): string {
    return getRequiredEnv('AWS_S3_BUCKET');
  }

  private get region(): string {
    return getRequiredEnv('AWS_REGION');
  }

  /**
   * Generates a short-lived presigned PUT URL so the admin client can directly
   * upload an image to S3 without routing the binary through the API server.
   */
  async generateUploadUrl(input: GenerateUploadUrlInput) {
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `questions/${input.subTestId}/${Date.now()}-${randomUUID()}-${safeName}`;
    const expiresInSeconds = input.expiresInSeconds ?? 300;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: input.mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    const uploadUrl = await getSignedUrl(this.getClient(), command, { expiresIn: expiresInSeconds });

    // Build the canonical object URL that will be persisted to the database.
    const publicBase = process.env.AWS_S3_PUBLIC_BASE_URL?.trim();
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    const publicUrl = publicBase
      ? `${publicBase.replace(/\/$/, '')}/${encodedKey}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;

    return { uploadUrl, publicUrl, objectKey, expiresInSeconds };
  }

  /**
   * Converts a stored S3 object URL into a short-lived presigned GET URL.
   * This is required because the S3 bucket has "Block All Public Access" enabled.
   * Returns the original URL unchanged for non-S3 URLs or if signing fails.
   */
  async getSignedFileUrl(storedUrl: string | null | undefined, expiresInSeconds = 3600): Promise<string | null> {
    if (!storedUrl) return null;

    try {
      const urlObj = new URL(storedUrl);

      // Only sign URLs belonging to AWS S3 — ignore any other CDN / placeholder URLs.
      if (!urlObj.hostname.includes('amazonaws.com')) {
        return storedUrl;
      }

      // The object key is the URL pathname stripped of its leading slash, URL-decoded.
      const objectKey = decodeURIComponent(urlObj.pathname.slice(1));

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });

      return await getSignedUrl(this.getClient(), command, { expiresIn: expiresInSeconds });
    } catch (err) {
      this.logger.warn(`Could not sign URL, returning original. url=${storedUrl} error=${(err as Error).message}`);
      return storedUrl;
    }
  }

  /**
   * Convenience helper: signs an array of stored S3 URLs in parallel.
   * Entries that are null/undefined are preserved as null in the output array.
   */
  async getSignedFileUrls(storedUrls: (string | null | undefined)[], expiresInSeconds = 3600): Promise<(string | null)[]> {
    return Promise.all(storedUrls.map((u) => this.getSignedFileUrl(u, expiresInSeconds)));
  }
}