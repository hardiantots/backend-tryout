import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessService } from './access.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { RevokeRoleDto } from './dto/revoke-role.dto';
import { GrantPermissionDto } from './dto/grant-permission.dto';
import { RevokePermissionDto } from './dto/revoke-permission.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { CreateParticipantTokenDto } from './dto/create-participant-token.dto';
import { DeleteParticipantTokenDto } from './dto/delete-participant-token.dto';
import { RegenerateParticipantTokenDto } from './dto/regenerate-participant-token.dto';

@Controller('admin/access')
@UseGuards(JwtAuthGuard)
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  private getActorUserId(req: Request): string {
    const fromJwt = (req as Request & { user?: { sub?: string } }).user?.sub;
    if (!fromJwt) {
      throw new UnauthorizedException('Akun tidak terautentikasi.');
    }
    return fromJwt;
  }

  @Post('assign-role')
  async assignRole(@Req() req: Request, @Body() dto: AssignRoleDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.assignRole(actorUserId, dto.targetUserId, dto.roleCode, dto.reason);
  }

  @Post('revoke-role')
  async revokeRole(@Req() req: Request, @Body() dto: RevokeRoleDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.revokeRole(actorUserId, dto.targetUserId, dto.roleCode, dto.reason);
  }

  @Post('grant-permission')
  async grantPermission(@Req() req: Request, @Body() dto: GrantPermissionDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.grantPermission(
      actorUserId,
      dto.targetUserId,
      dto.permissionCode,
      dto.scopeType,
      dto.subTestId,
      dto.expiresAt,
      dto.reason,
    );
  }

  @Post('revoke-permission')
  async revokePermission(@Req() req: Request, @Body() dto: RevokePermissionDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.revokePermission(
      actorUserId,
      dto.targetUserId,
      dto.permissionCode,
      dto.scopeType,
      dto.reason,
      dto.subTestId,
    );
  }

  @Post('delete-user')
  async deleteUser(@Req() req: Request, @Body() dto: DeleteUserDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.deleteUser(actorUserId, dto.targetUserId, dto.reason);
  }

  @Get('effective-permissions/:userId')
  async getEffectivePermissions(@Req() req: Request, @Param('userId') userId: string) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.getEffectivePermissions(userId, actorUserId);
  }

  @Get('audit')
  async getAudit(
    @Req() req: Request,
    @Query('actorUserId') actorUserId?: string,
    @Query('targetUserId') targetUserId?: string,
    @Query('actionType') actionType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const requesterUserId = this.getActorUserId(req);
    return this.accessService.getAuditLogs({
      requesterUserId,
      actorUserId,
      targetUserId,
      actionType,
      from,
      to,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Get('users')
  async listUsers(@Req() req: Request, @Query('q') q?: string, @Query('roleCode') roleCode?: string) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.listUsers(actorUserId, q, roleCode);
  }

  @Get('sub-tests')
  async listSubTests(@Req() req: Request) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.listActiveSubTests(actorUserId);
  }

  @Post('participant-tokens')
  async createParticipantToken(@Req() req: Request, @Body() dto: CreateParticipantTokenDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.createParticipantToken(actorUserId, dto.label);
  }

  @Get('participant-tokens')
  async listParticipantTokens(@Req() req: Request) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.listParticipantTokens(actorUserId);
  }

  @Post('participant-tokens/delete')
  async deleteParticipantToken(@Req() req: Request, @Body() dto: DeleteParticipantTokenDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.deleteParticipantToken(actorUserId, dto.tokenId, dto.reason);
  }

  @Post('participant-tokens/regenerate')
  async regenerateParticipantToken(@Req() req: Request, @Body() dto: RegenerateParticipantTokenDto) {
    const actorUserId = this.getActorUserId(req);
    return this.accessService.regenerateParticipantToken(actorUserId, dto.tokenKey);
  }
}
