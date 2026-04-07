import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { AccessService } from '../access/access.service';
import { getRequiredEnv } from '../common/config/env.util';
import { UserRoleCode } from '../access/access.types';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_TOKEN_TTL, LOCK_MINUTES, MAX_FAILED_LOGIN, REFRESH_TOKEN_TTL } from './auth.constants';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly participantTokenPattern = /^[A-HJ-NP-Z2-9]{6}$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly accessService: AccessService,
  ) {}

  private async issueTokens(user: { id: string; email: string }) {
    const accessPayload = { sub: user.id, email: user.email, tokenType: 'access' as const };
    const refreshPayload = { sub: user.id, email: user.email, tokenType: 'refresh' as const };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: getRequiredEnv('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: getRequiredEnv('JWT_REFRESH_SECRET'),
      expiresIn: REFRESH_TOKEN_TTL,
    });

    return { accessToken, refreshToken };
  }

  private extractParticipantTokenKey(rawToken: string): string {
    const normalized = rawToken.trim().toUpperCase();
    if (!normalized) {
      throw new UnauthorizedException('Format token participant tidak valid.');
    }

    if (!this.participantTokenPattern.test(normalized)) {
      throw new UnauthorizedException('Format token participant tidak valid. Gunakan 6 karakter kombinasi huruf/angka.');
    }

    return normalized;
  }

  private normalizeSubmittedParticipantToken(rawToken: string): string {
    return this.extractParticipantTokenKey(rawToken);
  }

  async validateParticipantToken(rawToken: string) {
    try {
      const tokenKey = this.extractParticipantTokenKey(rawToken);
      const submittedToken = this.normalizeSubmittedParticipantToken(rawToken);
      const tokenRecord = await this.prisma.participantAccessToken.findUnique({
        where: { tokenKey },
      });

      if (!tokenRecord) {
        return {
          success: true,
          valid: false,
          message: 'Token tidak ditemukan.',
        };
      }

      if (tokenRecord.revokedAt) {
        return {
          success: true,
          valid: false,
          message: 'Token sudah dinonaktifkan oleh admin.',
        };
      }

      const tokenMatch = await argon2.verify(tokenRecord.tokenHash, submittedToken);
      if (!tokenMatch) {
        return {
          success: true,
          valid: false,
          message: 'Token tidak sesuai.',
        };
      }

      const loginCount = tokenRecord.loginCount ?? 0;
      const MAX_PARTICIPANT_LOGINS = 3;

      if (loginCount > MAX_PARTICIPANT_LOGINS) {
        return {
          success: true,
          valid: true,
          message: 'Token valid, tetapi batas login sudah tercapai. Ujian telah diakhiri otomatis.',
          loginExceeded: true,
          loginCount,
        };
      }

      if (loginCount > 0 && loginCount <= MAX_PARTICIPANT_LOGINS) {
        const remaining = MAX_PARTICIPANT_LOGINS - loginCount;
        return {
          success: true,
          valid: true,
          message: `Token valid (sudah login ${loginCount}x, sisa ${remaining}x sebelum ujian diakhiri otomatis).`,
          loginCount,
        };
      }

      return {
        success: true,
        valid: true,
        message: 'Token valid dan siap digunakan.',
        loginCount: 0,
      };
    } catch {
      return {
        success: true,
        valid: false,
        message: 'Format token tidak valid.',
      };
    }
  }

  private async incrementFailedLogin(userId: string) {
    const next = await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: {
          increment: 1,
        },
      },
      select: {
        failedLoginCount: true,
      },
    });

    if (next.failedLoginCount >= MAX_FAILED_LOGIN) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil },
      });
    }
  }

  private async persistRefreshToken(userId: string, refreshToken: string, userAgent?: string, ipAddress?: string) {
    const tokenHash = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        userAgent: userAgent ?? null,
        ipAddress: ipAddress ?? null,
        expiresAt,
      },
    });
  }

  private async sendResetPasswordEmail(email: string, resetLink: string) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT ?? 587);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const fromEmail = process.env.SMTP_FROM_EMAIL ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass || !fromEmail) {
      throw new InternalServerErrorException('Layanan email reset password belum terkonfigurasi.');
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    try {
      await transporter.sendMail({
        from: fromEmail,
        to: email,
        subject: 'Reset Password Akun SNBT',
        html: `<p>Halo,</p><p>Klik tautan berikut untuk mengubah password akun kamu:</p><p><a href="${resetLink}">${resetLink}</a></p><p>Tautan ini berlaku selama 30 menit.</p>`,
      });
    } catch {
      throw new InternalServerErrorException('Gagal mengirim email reset password. Silakan coba lagi.');
    }
  }

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(`Account is temporarily locked until ${user.lockedUntil.toISOString()}.`);
    }

    const validPassword = await argon2.verify(user.passwordHash, dto.password);
    if (!validPassword) {
      await this.incrementFailedLogin(user.id);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const activeRoles = await this.prisma.userRole.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      include: {
        role: {
          select: {
            code: true,
          },
        },
      },
    });

    const roleCodes = activeRoles.map((entry) => entry.role.code as UserRoleCode);
    const isAdminLogin = roleCodes.includes(UserRoleCode.ADMIN) || roleCodes.includes(UserRoleCode.MASTER_ADMIN);
    if (!isAdminLogin) {
      throw new ForbiddenException('Participant hanya dapat login menggunakan token dari master admin.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const tokens = await this.issueTokens({ id: user.id, email: user.email });
    await this.persistRefreshToken(user.id, tokens.refreshToken, userAgent, ipAddress);

    return {
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
      ...tokens,
    };
  }

  async participantTokenLogin(rawToken: string, userAgent?: string, ipAddress?: string) {
    const tokenKey = this.extractParticipantTokenKey(rawToken);
    const submittedToken = this.normalizeSubmittedParticipantToken(rawToken);
    const tokenRecord = await this.prisma.participantAccessToken.findUnique({
      where: { tokenKey },
      include: {
        user: true,
      },
    });

    if (!tokenRecord || tokenRecord.revokedAt) {
      throw new UnauthorizedException('Token participant tidak valid atau sudah dinonaktifkan.');
    }

    const tokenMatch = await argon2.verify(tokenRecord.tokenHash, submittedToken);
    if (!tokenMatch) {
      throw new UnauthorizedException('Token participant tidak valid.');
    }

    const activeParticipantRole = await this.prisma.userRole.findFirst({
      where: {
        userId: tokenRecord.userId,
        revokedAt: null,
        role: {
          code: UserRoleCode.PARTICIPANT,
        },
      },
    });
    if (!activeParticipantRole) {
      throw new ForbiddenException('Akun pada token tidak memiliki role PARTICIPANT aktif.');
    }

    await this.prisma.user.update({
      where: { id: tokenRecord.userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Track login count to detect logout/re-login abuse
    const currentLoginCount = (tokenRecord as any).loginCount ?? 0;
    const MAX_PARTICIPANT_LOGINS = 3;
    const nextLoginCount = currentLoginCount + 1;

    await this.prisma.participantAccessToken.update({
      where: { id: tokenRecord.id },
      data: {
        usedAt: tokenRecord.usedAt ?? new Date(),
        usedByIp: tokenRecord.usedByIp ?? ipAddress ?? null,
        loginCount: nextLoginCount,
      },
    });

    const tokens = await this.issueTokens({ id: tokenRecord.user.id, email: tokenRecord.user.email });
    await this.persistRefreshToken(tokenRecord.user.id, tokens.refreshToken, userAgent, ipAddress);

    // If login count exceeds max allowed, auto-submit any active exam session
    if (nextLoginCount > MAX_PARTICIPANT_LOGINS) {
      const activeSession = await this.prisma.examSession.findFirst({
        where: {
          userId: tokenRecord.userId,
          status: 'IN_PROGRESS',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeSession) {
        await this.prisma.examSession.update({
          where: { id: activeSession.id },
          data: {
            status: 'AUTO_SUBMITTED',
            forceSubmitted: true,
            submittedAt: activeSession.submittedAt ?? new Date(),
            warningCount: activeSession.warningCount,
          },
        });

        await this.prisma.proctoringEvent.create({
          data: {
            examSessionId: activeSession.id,
            eventType: 'FORCE_SUBMIT_TRIGGERED',
            warningNumber: activeSession.warningCount,
            metadataJson: {
              reason: 'RELOGIN_LIMIT_EXCEEDED',
              loginCount: nextLoginCount,
            },
          },
        });
      }

      return {
        success: true,
        user: {
          id: tokenRecord.user.id,
          fullName: tokenRecord.user.fullName,
          email: tokenRecord.user.email,
        },
        loginType: 'participant-token',
        examAutoCompleted: true,
        examAutoCompleteReason: 'RELOGIN_LIMIT_EXCEEDED',
        loginCount: nextLoginCount,
        ...tokens,
      };
    }

    return {
      success: true,
      user: {
        id: tokenRecord.user.id,
        fullName: tokenRecord.user.fullName,
        email: tokenRecord.user.email,
      },
      loginType: 'participant-token',
      loginCount: nextLoginCount,
      ...tokens,
    };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Do not expose whether email exists.
    if (!user) {
      return {
        success: true,
        message: 'Jika email terdaftar, link reset password akan dikirim.',
      };
    }

    await this.prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        usedAt: new Date(),
      },
    });

    const resetToken = randomUUID();
    const resetTokenHash = await argon2.hash(resetToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: resetTokenHash,
        expiresAt,
      },
    });

    const resetBaseUrl = process.env.PASSWORD_RESET_BASE_URL ?? 'http://localhost:5173/reset-password';
    const separator = resetBaseUrl.includes('?') ? '&' : '?';
    const resetLink = `${resetBaseUrl.replace(/\/$/, '')}${separator}token=${encodeURIComponent(resetToken)}`;
    await this.sendResetPasswordEmail(user.email, resetLink);

    return {
      success: true,
      message: 'Jika email terdaftar, link reset password akan dikirim.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    let matched: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const isMatch = await argon2.verify(candidate.tokenHash, token);
      if (isMatch) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      throw new UnauthorizedException('Token reset password tidak valid atau sudah kedaluwarsa.');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: matched.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      await tx.passwordResetToken.update({
        where: { id: matched.id },
        data: { usedAt: new Date() },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: matched.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    return {
      success: true,
      message: 'Password berhasil diubah. Silakan login kembali.',
    };
  }

  private async findActiveRefreshToken(userId: string, refreshToken: string) {
    const candidates = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const candidate of candidates) {
      const match = await argon2.verify(candidate.tokenHash, refreshToken);
      if (match) {
        return candidate;
      }
    }
    return null;
  }

  async refresh(refreshToken: string, userAgent?: string, ipAddress?: string) {
    let payload: { sub: string; email: string; tokenType: 'refresh' };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: getRequiredEnv('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token type.');
    }

    const stored = await this.findActiveRefreshToken(payload.sub, refreshToken);
    if (!stored) {
      throw new UnauthorizedException('Refresh token has been revoked or expired.');
    }

    const tokens = await this.issueTokens({ id: payload.sub, email: payload.email });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: {
          userId: payload.sub,
          tokenHash: await argon2.hash(tokens.refreshToken),
          userAgent: userAgent ?? null,
          ipAddress: ipAddress ?? null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    });

    return {
      success: true,
      ...tokens,
    };
  }

  async logout(refreshToken: string) {
    let payload: { sub: string; email: string; tokenType: 'refresh' };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: getRequiredEnv('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const stored = await this.findActiveRefreshToken(payload.sub, refreshToken);
    if (!stored) {
      return { success: true, revoked: 0 };
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return {
      success: true,
      revoked: 1,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        permissionVersion: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const effective = await this.accessService.getEffectivePermissions(user.id);
    return {
      success: true,
      user,
      roles: effective.roles,
      permissions: effective.permissions,
      scopes: effective.scopes,
      permissionVersion: user.permissionVersion,
    };
  }
}
