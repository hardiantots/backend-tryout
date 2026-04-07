export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getAllowedCorsOrigins(): string[] {
  const raw = (process.env.APP_ORIGINS ?? process.env.FRONTEND_URL)?.trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }

  if (!allowedOrigins.length) {
    return process.env.NODE_ENV !== 'production';
  }

  return allowedOrigins.includes(origin);
}

export function validateRequiredEnvForProduction() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  for (const key of required) {
    getRequiredEnv(key);
  }

  const hasCorsOrigins = Boolean((process.env.APP_ORIGINS ?? process.env.FRONTEND_URL)?.trim());
  if (!hasCorsOrigins) {
    throw new Error('Missing required environment variable: APP_ORIGINS (or FRONTEND_URL).');
  }
}
