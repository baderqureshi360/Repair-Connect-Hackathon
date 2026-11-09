import { env } from '../config/env.js';
import { redactMongoUri } from '../config/loadEnv.js';

console.log(
  JSON.stringify(
    {
      rootDir: env.rootDir,
      envFile: env.envFile,
      nodeEnv: env.nodeEnv,
      useMemoryDb: env.useMemoryDb,
      mongodbUriConfigured: Boolean(env.mongodbUri),
      mongodbUriRedacted: env.mongodbUri ? redactMongoUri(env.mongodbUri) : '(empty)',
      clientUrl: env.clientUrl,
      port: env.port
    },
    null,
    2
  )
);
