import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { UserRoleCode } from '../access.types';

export class AssignRoleDto {
  @IsUUID()
  targetUserId!: string;

  @IsEnum(UserRoleCode)
  roleCode!: UserRoleCode;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}
