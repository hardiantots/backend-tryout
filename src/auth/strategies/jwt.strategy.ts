import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getRequiredEnv } from '../../common/config/env.util';
import { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getRequiredEnv('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AuthUser) {
    if (!payload?.sub || payload.tokenType !== 'access') {
      throw new UnauthorizedException('Invalid access token payload.');
    }
    return payload;
  }
}
