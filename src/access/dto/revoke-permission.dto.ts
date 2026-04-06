import { IsEnum, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PermissionCode, PermissionScopeType } from '../access.types';

export class RevokePermissionDto {
  @IsUUID()
  targetUserId!: string;

  @IsEnum(PermissionCode)
  permissionCode!: PermissionCode;

  @IsEnum(PermissionScopeType)
  scopeType!: PermissionScopeType;

  @ValidateIf((o: RevokePermissionDto) => o.scopeType === PermissionScopeType.SUB_TEST)
  @IsUUID()
  subTestId?: string;

  @IsString()
  @MaxLength(400)
  reason!: string;
}
