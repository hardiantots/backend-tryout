import { IsEnum, IsString, IsUUID, MaxLength } from 'class-validator';
import { UserRoleCode } from '../access.types';

export class RevokeRoleDto {
  @IsUUID()
  targetUserId!: string;

  @IsEnum(UserRoleCode)
  roleCode!: UserRoleCode;

  @IsString()
  @MaxLength(400)
  reason!: string;
}
