import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessActionType, PermissionCode, PermissionScopeType, UserRoleCode } from './access.types';

type EffectiveScopes = Record<string, { global: boolean; subTestIds: string[] }>;

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  private generateTokenKey(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const tokenLength = randomInt(0, 2) === 0 ? 6 : 7;
    let key = '';
    for (let i = 0; i < tokenLength; i += 1) {
      const idx = randomInt(0, alphabet.length);
      key += alphabet[idx];
    }
    return key;
  }

  private generateParticipantToken(key: string): string {
    return key;
  }

  private async assertUserExists(tx: any, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }
    return user;
  }

  private async assertMasterAdmin(tx: any, actorUserId: string) {
    const masterRole = await tx.role.findUnique({ where: { code: UserRoleCode.MASTER_ADMIN } });
    if (!masterRole) {
      throw new BadRequestException('MASTER_ADMIN role has not been seeded yet.');
    }

    const activeRole = await tx.userRole.findFirst({
      where: {
        userId: actorUserId,
        roleId: masterRole.id,
        revokedAt: null,
      },
    });
    if (!activeRole) {
      throw new ForbiddenException('Only MASTER_ADMIN can manage admin access.');
    }
  }

  validateRoleAssignment(roleCode: UserRoleCode): void {
    if (roleCode !== UserRoleCode.ADMIN) {
      throw new BadRequestException('Only ADMIN role can be assigned via this endpoint.');
    }
  }

  validatePermissionScope(scopeType: PermissionScopeType, subTestId?: string): void {
    if (scopeType === PermissionScopeType.SUB_TEST && !subTestId) {
      throw new BadRequestException('subTestId is required for SUB_TEST scope.');
    }
    if (scopeType === PermissionScopeType.GLOBAL && subTestId) {
      throw new BadRequestException('subTestId must be null for GLOBAL scope.');
    }
  }

  validateGrantExpiry(expiresAt?: string): void {
    if (!expiresAt) {
      return;
    }
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('expiresAt must be a valid ISO datetime.');
    }
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future.');
    }
  }

  private async writeAuditLog(
    tx: any,
    params: {
      actorUserId: string;
      actionType: AccessActionType;
      targetUserId: string;
      targetRoleCode?: UserRoleCode;
      targetPermissionCode?: PermissionCode;
      scopeType?: PermissionScopeType;
      subTestId?: string;
      reason?: string;
      beforeJson?: any;
      afterJson?: any;
    },
  ) {
    await tx.accessAuditLog.create({
      data: {
        actorUserId: params.actorUserId,
        actionType: params.actionType,
        targetUserId: params.targetUserId,
        targetRoleCode: params.targetRoleCode,
        targetPermissionCode: params.targetPermissionCode,
        scopeType: params.scopeType,
        subTestId: params.subTestId,
        reason: params.reason,
        beforeJson: params.beforeJson,
        afterJson: params.afterJson,
      },
    });
  }

  private async bumpPermissionVersion(tx: any, userId: string) {
    await tx.user.update({
      where: { id: userId },
      data: {
        permissionVersion: {
          increment: 1,
        },
      },
    });
  }

  async assignRole(actorUserId: string, targetUserId: string, roleCode: UserRoleCode, reason?: string) {
    this.validateRoleAssignment(roleCode);

    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);
      await this.assertUserExists(tx, targetUserId);

      const role = await tx.role.findUnique({ where: { code: roleCode } });
      if (!role) {
        throw new NotFoundException(`Role ${roleCode} not found.`);
      }

      const activeRole = await tx.userRole.findFirst({
        where: {
          userId: targetUserId,
          roleId: role.id,
          revokedAt: null,
        },
      });

      if (activeRole) {
        return {
          success: true,
          assignedRole: roleCode,
          assignedAt: activeRole.assignedAt.toISOString(),
          actorUserId,
          targetUserId,
          reason: reason ?? null,
          actionType: AccessActionType.ROLE_ASSIGNED,
          alreadyAssigned: true,
        };
      }

      const created = await tx.userRole.create({
        data: {
          userId: targetUserId,
          roleId: role.id,
          assignedByUserId: actorUserId,
        },
      });

      await this.bumpPermissionVersion(tx, targetUserId);
      await this.writeAuditLog(tx, {
        actorUserId,
        actionType: AccessActionType.ROLE_ASSIGNED,
        targetUserId,
        targetRoleCode: roleCode,
        reason,
        beforeJson: { roleActive: false },
        afterJson: { roleActive: true, assignedAt: created.assignedAt.toISOString() },
      });

      return {
        success: true,
        assignedRole: roleCode,
        assignedAt: created.assignedAt.toISOString(),
        actorUserId,
        targetUserId,
        reason: reason ?? null,
        actionType: AccessActionType.ROLE_ASSIGNED,
      };
    });
  }

  async revokeRole(actorUserId: string, targetUserId: string, roleCode: UserRoleCode, reason: string) {
    this.validateRoleAssignment(roleCode);

    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);
      await this.assertUserExists(tx, targetUserId);

      const role = await tx.role.findUnique({ where: { code: roleCode } });
      if (!role) {
        throw new NotFoundException(`Role ${roleCode} not found.`);
      }

      const activeRole = await tx.userRole.findFirst({
        where: {
          userId: targetUserId,
          roleId: role.id,
          revokedAt: null,
        },
      });
      if (!activeRole) {
        throw new NotFoundException(`Active role ${roleCode} not found on target user.`);
      }

      const revoked = await tx.userRole.update({
        where: { id: activeRole.id },
        data: { revokedAt: new Date() },
      });

      await this.bumpPermissionVersion(tx, targetUserId);
      await this.writeAuditLog(tx, {
        actorUserId,
        actionType: AccessActionType.ROLE_REVOKED,
        targetUserId,
        targetRoleCode: roleCode,
        reason,
        beforeJson: { roleActive: true, assignedAt: activeRole.assignedAt.toISOString() },
        afterJson: { roleActive: false, revokedAt: revoked.revokedAt?.toISOString() ?? null },
      });

      return {
        success: true,
        revokedAt: revoked.revokedAt?.toISOString() ?? new Date().toISOString(),
        actorUserId,
        targetUserId,
        reason,
        actionType: AccessActionType.ROLE_REVOKED,
      };
    });
  }

  async grantPermission(
    actorUserId: string,
    targetUserId: string,
    permissionCode: PermissionCode,
    scopeType: PermissionScopeType,
    subTestId?: string,
    expiresAt?: string,
    reason?: string,
  ) {
    this.validatePermissionScope(scopeType, subTestId);
    this.validateGrantExpiry(expiresAt);

    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);
      await this.assertUserExists(tx, targetUserId);

      const permission = await tx.permission.findUnique({ where: { code: permissionCode } });
      if (!permission) {
        throw new NotFoundException(`Permission ${permissionCode} not found.`);
      }

      if (scopeType === PermissionScopeType.SUB_TEST && subTestId) {
        const subTest = await tx.subTest.findUnique({ where: { id: subTestId } });
        if (!subTest) {
          throw new NotFoundException(`SubTest ${subTestId} not found.`);
        }
      }

      const activeGrant = await tx.userPermissionScope.findFirst({
        where: {
          userId: targetUserId,
          permissionId: permission.id,
          scopeType,
          subTestId: subTestId ?? null,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });

      if (activeGrant) {
        return {
          success: true,
          grantId: activeGrant.id,
          actorUserId,
          targetUserId,
          permissionCode,
          scopeType,
          subTestId: subTestId ?? null,
          effectiveFrom: activeGrant.createdAt.toISOString(),
          expiresAt: activeGrant.expiresAt?.toISOString() ?? null,
          reason: reason ?? null,
          actionType: AccessActionType.PERMISSION_GRANTED,
          alreadyGranted: true,
        };
      }

      const created = await tx.userPermissionScope.create({
        data: {
          userId: targetUserId,
          permissionId: permission.id,
          scopeType,
          subTestId: scopeType === PermissionScopeType.SUB_TEST ? subTestId : null,
          grantedByUserId: actorUserId,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      await this.bumpPermissionVersion(tx, targetUserId);
      await this.writeAuditLog(tx, {
        actorUserId,
        actionType: AccessActionType.PERMISSION_GRANTED,
        targetUserId,
        targetPermissionCode: permissionCode,
        scopeType,
        subTestId,
        reason,
        beforeJson: { grantActive: false },
        afterJson: {
          grantActive: true,
          grantId: created.id,
          expiresAt: created.expiresAt?.toISOString() ?? null,
        },
      });

      return {
        success: true,
        grantId: created.id,
        actorUserId,
        targetUserId,
        permissionCode,
        scopeType,
        subTestId: subTestId ?? null,
        effectiveFrom: created.createdAt.toISOString(),
        expiresAt: created.expiresAt?.toISOString() ?? null,
        reason: reason ?? null,
        actionType: AccessActionType.PERMISSION_GRANTED,
      };
    });
  }

  async revokePermission(
    actorUserId: string,
    targetUserId: string,
    permissionCode: PermissionCode,
    scopeType: PermissionScopeType,
    reason: string,
    subTestId?: string,
  ) {
    this.validatePermissionScope(scopeType, subTestId);

    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);
      await this.assertUserExists(tx, targetUserId);

      const permission = await tx.permission.findUnique({ where: { code: permissionCode } });
      if (!permission) {
        throw new NotFoundException(`Permission ${permissionCode} not found.`);
      }

      const activeGrant = await tx.userPermissionScope.findFirst({
        where: {
          userId: targetUserId,
          permissionId: permission.id,
          scopeType,
          subTestId: subTestId ?? null,
          revokedAt: null,
        },
      });
      if (!activeGrant) {
        throw new NotFoundException('Active permission grant not found.');
      }

      const revoked = await tx.userPermissionScope.update({
        where: { id: activeGrant.id },
        data: { revokedAt: new Date() },
      });

      await this.bumpPermissionVersion(tx, targetUserId);
      await this.writeAuditLog(tx, {
        actorUserId,
        actionType: AccessActionType.PERMISSION_REVOKED,
        targetUserId,
        targetPermissionCode: permissionCode,
        scopeType,
        subTestId,
        reason,
        beforeJson: {
          grantActive: true,
          grantId: activeGrant.id,
          expiresAt: activeGrant.expiresAt?.toISOString() ?? null,
        },
        afterJson: {
          grantActive: false,
          revokedAt: revoked.revokedAt?.toISOString() ?? null,
        },
      });

      return {
        success: true,
        revokedAt: revoked.revokedAt?.toISOString() ?? new Date().toISOString(),
        actorUserId,
        targetUserId,
        permissionCode,
        scopeType,
        subTestId: subTestId ?? null,
        reason,
        actionType: AccessActionType.PERMISSION_REVOKED,
      };
    });
  }

  async getEffectivePermissions(userId: string, actorUserId?: string) {
    // Authorization: only self-query or MASTER_ADMIN can view another user's permissions
    if (actorUserId && actorUserId !== userId) {
      const actorRole = await this.prisma.userRole.findFirst({
        where: {
          userId: actorUserId,
          revokedAt: null,
          role: { code: UserRoleCode.MASTER_ADMIN },
        },
      });
      if (!actorRole) {
        throw new ForbiddenException('Hanya MASTER_ADMIN yang dapat melihat permissions user lain.');
      }
    }

    await this.assertUserExists(this.prisma, userId);

    const activeRoles = await this.prisma.userRole.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    const directScopes = await this.prisma.userPermissionScope.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        permission: true,
      },
    });

    const roleCodes = activeRoles.map((item: any) => item.role.code);
    const permissionSet = new Set<PermissionCode>();
    const scopes: EffectiveScopes = {};

    for (const item of activeRoles) {
      for (const rp of item.role.rolePermissions) {
        permissionSet.add(rp.permission.code as PermissionCode);
        const key = rp.permission.code;
        if (!scopes[key]) {
          scopes[key] = { global: false, subTestIds: [] };
        }
        scopes[key].global = true;
      }
    }

    for (const grant of directScopes) {
      const key = grant.permission.code;
      permissionSet.add(key as PermissionCode);
      if (!scopes[key]) {
        scopes[key] = { global: false, subTestIds: [] };
      }
      if (grant.scopeType === PermissionScopeType.GLOBAL) {
        scopes[key].global = true;
      }
      if (grant.scopeType === PermissionScopeType.SUB_TEST && grant.subTestId) {
        scopes[key].subTestIds = Array.from(new Set([...scopes[key].subTestIds, grant.subTestId]));
      }
    }

    return {
      userId,
      roles: roleCodes,
      permissions: Array.from(permissionSet),
      scopes,
      permissionVersion: (await this.prisma.user.findUnique({ where: { id: userId }, select: { permissionVersion: true } }))
        ?.permissionVersion,
    };
  }

  async getAuditLogs(filters?: {
    requesterUserId?: string;
    actorUserId?: string;
    targetUserId?: string;
    actionType?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    // Authorization: only MASTER_ADMIN can view audit logs
    if (filters?.requesterUserId) {
      const requesterRole = await this.prisma.userRole.findFirst({
        where: {
          userId: filters.requesterUserId,
          revokedAt: null,
          role: { code: UserRoleCode.MASTER_ADMIN },
        },
      });
      if (!requesterRole) {
        throw new ForbiddenException('Hanya MASTER_ADMIN yang dapat mengakses audit logs.');
      }
    }
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters?.pageSize ?? 20));

    const where: any = {
      actorUserId: filters?.actorUserId,
      targetUserId: filters?.targetUserId,
      actionType: filters?.actionType as AccessActionType | undefined,
      occurredAt:
        filters?.from || filters?.to
          ? {
              gte: filters.from ? new Date(filters.from) : undefined,
              lte: filters.to ? new Date(filters.to) : undefined,
            }
          : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.accessAuditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.accessAuditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async listUsers(actorUserId: string, search?: string, roleCode?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      const keyword = search?.trim();
      const normalizedRole = roleCode?.trim().toUpperCase();
      const users = await tx.user.findMany({
        where: {
          ...(keyword
            ? {
                OR: [
                  { fullName: { contains: keyword, mode: 'insensitive' } },
                  { email: { contains: keyword, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(normalizedRole
            ? {
                userRoles: {
                  some: {
                    revokedAt: null,
                    role: {
                      code: normalizedRole,
                    },
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          createdAt: true,
          userRoles: {
            where: { revokedAt: null },
            select: {
              role: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      return {
        items: users.map((user: any) => ({
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          roles: user.userRoles.map((entry: any) => entry.role.code),
          createdAt: user.createdAt,
        })),
        total: users.length,
      };
    });
  }

  async listActiveSubTests(actorUserId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      const subTests = await tx.subTest.findMany({
        where: { isActive: true },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          component: true,
        },
      });

      return {
        items: subTests,
        total: subTests.length,
      };
    });
  }

  async deleteUser(actorUserId: string, targetUserId: string, reason?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      if (actorUserId === targetUserId) {
        throw new BadRequestException('Akun kamu sendiri tidak dapat dihapus dari panel ini.');
      }

      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          fullName: true,
          email: true,
          userRoles: {
            where: { revokedAt: null },
            include: { role: true },
          },
        },
      });

      if (!targetUser) {
        throw new NotFoundException(`User ${targetUserId} not found.`);
      }

      const hasMasterRole = targetUser.userRoles.some((entry: any) => entry.role.code === UserRoleCode.MASTER_ADMIN);
      if (hasMasterRole) {
        throw new ForbiddenException('Akun dengan role MASTER_ADMIN tidak dapat dihapus dari endpoint ini.');
      }

      const authoredQuestionCount = await tx.question.count({
        where: {
          createdById: targetUserId,
        },
      });

      if (authoredQuestionCount > 0) {
        await tx.question.updateMany({
          where: { createdById: targetUserId },
          data: { createdById: actorUserId },
        });
      }

      await this.writeAuditLog(tx, {
        actorUserId,
        actionType: AccessActionType.USER_LOCKED,
        targetUserId,
        reason: reason ?? 'User deleted by master admin.',
        beforeJson: {
          fullName: targetUser.fullName,
          email: targetUser.email,
          roles: targetUser.userRoles.map((entry: any) => entry.role.code),
        },
        afterJson: {
          deleted: true,
          reassignQuestionAuthorTo: actorUserId,
          reassignedQuestionCount: authoredQuestionCount,
        },
      });

      await tx.user.delete({
        where: { id: targetUserId },
      });

      return {
        success: true,
        deletedUserId: targetUserId,
        deletedEmail: targetUser.email,
        reassignedQuestionCount: authoredQuestionCount,
      };
    });
  }

  async createParticipantToken(actorUserId: string, label?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      const participantRole = await tx.role.findUnique({
        where: { code: UserRoleCode.PARTICIPANT },
      });
      if (!participantRole) {
        throw new NotFoundException('Role PARTICIPANT belum tersedia. Jalankan seed prisma terlebih dahulu.');
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const tokenKey = this.generateTokenKey();
        const plainToken = this.generateParticipantToken(tokenKey);
        const tokenHash = await argon2.hash(plainToken);

        try {
          const user = await tx.user.create({
            data: {
              fullName: `Participant ${tokenKey}`,
              email: `participant-${tokenKey.toLowerCase()}-${Date.now()}@token.local`,
              passwordHash: await argon2.hash(randomUUID()),
              isEmailVerified: true,
            },
          });

          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: participantRole.id,
              assignedByUserId: actorUserId,
            },
          });

          const tokenRow = await tx.participantAccessToken.create({
            data: {
              tokenKey,
              tokenHash,
              label: label?.trim() || null,
              userId: user.id,
              generatedByUserId: actorUserId,
            },
          });

          return {
            success: true,
            token: plainToken,
            tokenId: tokenRow.id,
            tokenKey: tokenRow.tokenKey,
            label: tokenRow.label,
            createdAt: tokenRow.createdAt,
            status: 'UNUSED',
          };
        } catch {
          // Retry when key/email collision happens.
        }
      }

      throw new BadRequestException('Gagal membuat token participant. Silakan coba lagi.');
    });
  }

  async listParticipantTokens(actorUserId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      const tokens = await tx.participantAccessToken.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          examSessions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              participantName: true,
              participantCongregation: true,
              participantSchool: true,
              scoreSummaryJson: true,
              submittedAt: true,
            },
          },
          _count: {
            select: {
              examSessions: true,
            },
          },
        },
      });

      return {
        success: true,
        items: tokens.map((item: any) => ({
          id: item.id,
          tokenKey: item.tokenKey,
          label: item.label,
          createdAt: item.createdAt,
          usedAt: item.usedAt,
          revokedAt: item.revokedAt,
          used: Boolean(item.usedAt),
          user: item.user,
          sessionCount: item._count.examSessions,
          latestSession: item.examSessions[0] ?? null,
        })),
        total: tokens.length,
      };
    });
  }

  async deleteParticipantToken(actorUserId: string, tokenId: string, reason?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      const token = await tx.participantAccessToken.findUnique({
        where: { id: tokenId },
        include: {
          _count: {
            select: {
              examSessions: true,
            },
          },
        },
      });

      if (!token) {
        throw new NotFoundException('Token participant tidak ditemukan.');
      }

      await tx.participantAccessToken.update({
        where: { id: token.id },
        data: {
          revokedAt: new Date(),
        },
      });

      return {
        success: true,
        tokenId: token.id,
        tokenKey: token.tokenKey,
        revokedAt: new Date().toISOString(),
        hadSessions: token._count.examSessions > 0,
        reason: reason ?? null,
      };
    });
  }

  async regenerateParticipantToken(actorUserId: string, tokenKey: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await this.assertMasterAdmin(tx, actorUserId);

      const normalizedKey = tokenKey.trim().toUpperCase();
      const token = await tx.participantAccessToken.findUnique({
        where: { tokenKey: normalizedKey },
      });
      if (!token) {
        throw new NotFoundException('Token key tidak ditemukan.');
      }
      if (token.revokedAt) {
        throw new BadRequestException('Token sudah nonaktif. Aktifkan token baru dengan generate token baru.');
      }

      const newToken = this.generateParticipantToken(normalizedKey);
      const newTokenHash = await argon2.hash(newToken);

      await tx.participantAccessToken.update({
        where: { id: token.id },
        data: {
          tokenHash: newTokenHash,
          usedAt: null,
          usedByIp: null,
        },
      });

      return {
        success: true,
        tokenId: token.id,
        tokenKey: normalizedKey,
        token: newToken,
      };
    });
  }
}
