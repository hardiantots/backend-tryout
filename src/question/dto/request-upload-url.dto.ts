import { IsInt, IsString, IsUUID, Max, Min } from 'class-validator';

export class RequestUploadUrlDto {
  @IsUUID()
  subTestId!: string;

  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;
}
