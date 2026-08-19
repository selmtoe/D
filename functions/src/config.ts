import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const FIREBASE_PROJECT_ID = "daifugo-8e039";
export const SCHEMA_VERSION = 2 as const;
export const TURN_TIMEOUT_MS = 60_000;
export const RECONNECT_GRACE_MS = 120_000;
export const ROOM_RETENTION_MS = 24 * 60 * 60 * 1_000;

const detectedProject = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;

if (detectedProject && detectedProject !== FIREBASE_PROJECT_ID) {
  throw new Error(
    `Refusing to initialize v2 against ${detectedProject}; expected ${FIREBASE_PROJECT_ID}.`,
  );
}

if (getApps().length === 0) {
  initializeApp({ projectId: FIREBASE_PROJECT_ID });
}

export const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });

export const paths = {
  room: (roomId: string) => firestore.doc(`v2Rooms/${roomId}`),
  roomView: (roomId: string) => firestore.doc(`v2RoomViews/${roomId}`),
  viewer: (roomId: string, uid: string) => firestore.doc(`v2RoomViews/${roomId}/viewers/${uid}`),
  action: (roomId: string, clientActionId: string) =>
    firestore.doc(`v2Events/${roomId}/actions/${clientActionId}`),
  createAction: (uid: string, clientActionId: string) =>
    firestore.doc(`v2Events/_create/actions/${uid}_${clientActionId}`),
  profileAction: (uid: string, clientActionId: string) =>
    firestore.doc(`v2Events/_profile/actions/${uid}_${clientActionId}`),
  audit: (roomId: string, revision: number, clientActionId: string) =>
    firestore.doc(
      `v2Events/${roomId}/audit/${String(revision).padStart(12, "0")}_${clientActionId}`,
    ),
};
