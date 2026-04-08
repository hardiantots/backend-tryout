import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateRequiredEnvForProduction } from './common/config/env.util';

async function bootstrap() {
  validateRequiredEnvForProduction();

  const app = await NestFactory.create(AppModule);

  const trustProxyRaw = process.env.TRUST_PROXY?.trim();
  if (trustProxyRaw) {
    const numericTrustProxy = Number(trustProxyRaw);
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', Number.isNaN(numericTrustProxy) ? trustProxyRaw === 'true' : numericTrustProxy);
  }

  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  app.enableCors({
    origin: '*', // Untuk tahap testing tanpa domain, ini yang paling aman
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  // Enable graceful shutdown for EC2 restarts / deployments
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[SNBT API] Listening on port ${port} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`);
}

bootstrap();
