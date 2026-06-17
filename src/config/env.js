import dotenv from "dotenv";

dotenv.config();

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3020),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wabflow",
  jwtSecret: () => required("JWT_SECRET"),
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  appleClientId: process.env.APPLE_CLIENT_ID || "",
  metaAppId: process.env.META_APP_ID || "",
  metaAppSecret: process.env.META_APP_SECRET || "",
  metaGraphVersion: process.env.META_GRAPH_VERSION || "v25.0",
  metaFlowJsonVersion: process.env.META_FLOW_JSON_VERSION || "7.2",
  metaVerifyToken: process.env.META_VERIFY_TOKEN || "",
  whatsappPin: process.env.WHATSAPP_2FA_PIN || "123456",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
};
