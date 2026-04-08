import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { getRequiredEnv } from '../common/config/env.util';

type GenerateQuestionUploadUrlInput = {
  subTestId: string;
  fileName: string;
  mimeType: string;
  expiresInSeconds?: number;
};

@Injectable()
export class S3Service {
  private s3Client: S3Client | null = null;

  private getClient(): S3Client {
    if (!this.s3Client) {
      // EC2 IAM Role is used, so no explicit access key is required.
      this.s3Client = new S3Client({ region: getRequiredEnv('AWS_REGION') });
    }
    return this.s3Client;
  }

  async generateQuestionUploadUrl(input: GenerateQuestionUploadUrlInput) {
    const bucket = getRequiredEnv('AWS_S3_BUCKET');
    const region = getRequiredEnv('AWS_REGION');
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `questions/${input.subTestId}/${Date.now()}-${randomUUID()}-${safeName}`;
    const expiresInSeconds = input.expiresInSeconds ?? 300;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: input.mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    const uploadUrl = await getSignedUrl(this.getClient(), command, { expiresIn: expiresInSeconds });
    const publicBase = process.env.AWS_S3_PUBLIC_BASE_URL?.trim();
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    const publicUrl = publicBase
      ? `${publicBase.replace(/\/$/, '')}/${encodedKey}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;

    return {
      uploadUrl,
      publicUrl,
      objectKey,
      expiresInSeconds,
    };
  }
}