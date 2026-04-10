// entrypoint.js
// Pre-loads all secrets from AWS SSM Parameter Store before NestJS boots.
// Required because EC2 instance does not use .env files in production.
const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');

async function startApp() {
  const region = process.env.AWS_REGION || 'ap-southeast-2';
  const basePath = process.env.AWS_SSM_PARAMETER_PATH || '/project-tryout/prod/backend/';
  const normalizedPath = basePath.endsWith('/') ? basePath : `${basePath}/`;

  console.log(`⏳ Loading secrets from AWS SSM path: ${normalizedPath}`);

  const ssmClient = new SSMClient({ region });
  let nextToken;
  let loaded = 0;

  try {
    do {
      const response = await ssmClient.send(
        new GetParametersByPathCommand({
          Path: normalizedPath,
          WithDecryption: true,
          Recursive: true,
          NextToken: nextToken,
        }),
      );

      for (const param of response.Parameters ?? []) {
        const key = param.Name?.replace(normalizedPath, '').trim();
        if (key && param.Value) {
          process.env[key] = param.Value;
          loaded += 1;
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    // Set NODE_ENV sebelum NestJS boot agar validasi env dan guard SSM berjalan benar
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'production';
    }

    console.log(`✅ ${loaded} secret(s) loaded. Starting NestJS (NODE_ENV=${process.env.NODE_ENV})...`);
    require('./dist/src/main');
  } catch (error) {
    console.error('❌ Failed to load secrets from SSM:', error);
    process.exit(1);
  }
}

startApp();