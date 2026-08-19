import { Timestamp } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { firestore, paths } from "../config.js";
import type { StoredActionResult } from "../model.js";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import { saveAvatarProfileSchema } from "../security/schemas.js";
import { authenticatedUid } from "./context.js";
import { callableOptions } from "./options.js";

export const saveAvatarProfile = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(saveAvatarProfileSchema, request.data);
    const actionRef = paths.profileAction(uid, input.clientActionId);
    const avatarRef = firestore.doc(`avatars/${uid}`);
    const now = Timestamp.now();
    return await firestore.runTransaction(async (transaction) => {
      const prior = await transaction.get(actionRef);
      if (prior.exists) {
        const stored = prior.data() as StoredActionResult;
        if (stored.uid !== uid || stored.command !== "saveAvatarProfile") {
          throw new CommandError(
            "already-exists",
            "The action id was already used by another command.",
          );
        }
        return stored.response;
      }
      const priorAvatar = await transaction.get(avatarRef);
      const response = { ok: true, schemaVersion: 1 };
      transaction.set(avatarRef, {
        schemaVersion: 1,
        profile: input.avatar,
        createdAt: priorAvatar.exists ? priorAvatar.get("createdAt") : now,
        updatedAt: now,
      });
      const stored: StoredActionResult = {
        schemaVersion: 2,
        uid,
        command: "saveAvatarProfile",
        roomId: "_profile",
        clientActionId: input.clientActionId,
        response,
        createdAt: now,
      };
      transaction.create(actionRef, stored);
      return response;
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});
