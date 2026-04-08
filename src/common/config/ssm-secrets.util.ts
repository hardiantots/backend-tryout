import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';

export async function loadSecretsFromSsm() {
  if (process.env.NODE_ENV !== 'production') {
    return { loaded: 0, skipped: true };
  }

  const region = process.env.AWS_REGION?.trim() || 'ap-southeast-2';
  const basePath = (process.env.AWS_SSM_PARAMETER_PATH?.trim() || '/project-tryout/prod/backend/').replace(/\/?$/, '/');

  const ssmClient = new SSMClient({ region });
  let nextToken: string | undefined;
  let loaded = 0;

  do {
    const response = await ssmClient.send(
      new GetParametersByPathCommand({
        Path: basePath,
        WithDecryption: true,
        Recursive: true,
        NextToken: nextToken,
      }),
    );

    for (const param of response.Parameters ?? []) {
      const key = param.Name?.replace(basePath, '').trim();
      if (!key || !param.Value) {
        continue;
      }

      process.env[key] = param.Value;
      loaded += 1;
      console.log(`[SSM] Loaded secret: ${key}`);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return {
    loaded,
    skipped: false,
    region,
    basePath,
  };
}