import type { CallableRequest } from "firebase-functions/v2/https";
import { CommandError } from "../security/command-error.js";

export function authenticatedUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new CommandError("unauthenticated", "Firebase Authentication is required.");
  }
  return uid;
}
