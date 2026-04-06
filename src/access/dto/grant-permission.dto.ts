import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PermissionCode, PermissionScopeType } from '../access.types';

export class GrantPermissionDto {
  @IsUUID()
  targetUserId!: string;

  @IsEnum(PermissionCode)
  permissionCode!: PermissionCode;

  @IsEnum(PermissionScopeType)
  scopeType!: PermissionScopeType;

  @ValidateIf((o: GrantPermissionDto) => o.scopeType === PermissionScopeType.SUB_TEST)
  @IsUUID()
  subTestId?: string;

  @ValidateIf((o: GrantPermissionDto) => o.scopeType === PermissionScopeType.GLOBAL)
  @IsOptional()
  subTestIdMustBeNull?: null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}
