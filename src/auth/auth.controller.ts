import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ParticipantTokenLoginDto } from './dto/participant-token-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateParticipantTokenDto } from './dto/validate-participant-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.headers['user-agent'], req.ip);
  }

  @Post('participant-token-login')
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  async participantTokenLogin(@Body() dto: ParticipantTokenLoginDto, @Req() req: Request) {
    return this.authService.participantTokenLogin(dto.token, req.headers['user-agent'], req.ip);
  }

  @Post('participant-token-validate')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async participantTokenValidate(@Body() dto: ValidateParticipantTokenDto) {
    return this.authService.validateParticipantToken(dto.token);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, req.headers['user-agent'], req.ip);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.sub);
  }
}
