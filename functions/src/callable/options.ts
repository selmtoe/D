import type { CallableOptions } from "firebase-functions/v2/https";

export const callableOptions: CallableOptions = {
  region: "asia-northeast1",
  cors: ["https://selmtoe.github.io", /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
  timeoutSeconds: 30,
  memory: "256MiB",
  concurrency: 40,
  maxInstances: 50,
};
