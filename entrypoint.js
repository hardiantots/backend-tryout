// entrypoint.js
const { SSMClient, GetParametersByPathCommand } = require("@aws-sdk/client-ssm");

async function startApp() {
  console.log("⏳ Pre-loading secrets from AWS SSM...");
  
  const ssmClient = new SSMClient({ region: "ap-southeast-2" });
  const basePath = "/project-tryout/prod/backend/";

  try {
    const command = new GetParametersByPathCommand({
      Path: basePath,
      WithDecryption: true,
      Recursive: true,
    });

    const response = await ssmClient.send(command);
    
    response.Parameters.forEach(param => {
      const key = param.Name.replace(basePath, "");
      process.env[key] = param.Value;
      // console.log(`✅ Loaded: ${key}`); // Aktifkan hanya untuk debug
    });

    console.log("🚀 Secrets loaded. Starting NestJS...");
    
    // BARU panggil file dist/main.js hasil build
    require("./dist/src/main"); 
  } catch (error) {
    console.error("❌ Failed to load secrets:", error);
    process.exit(1);
  }
}

startApp();