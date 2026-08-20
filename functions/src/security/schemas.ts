import { z } from "zod";

const roomId = z.string().regex(/^[A-HJ-NP-Z2-9]{5}$/);
const gameId = z
  .string()
  .min(4)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)
  .nullable();
const clientActionId = z
  .string()
  .min(16)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const expectedRevision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const uid = z.string().min(1).max(128);
const cardId = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9:_-]+$/);

function containsNameControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- reject control bytes at the API boundary
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function containsChatControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- preserve newline/tab while rejecting unsafe controls
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

const name = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .refine((value) => !containsNameControlCharacter(value), "control characters are not allowed");

const avatar = z.lazy(() => avatarProfileSchema);

const commandBase = z
  .object({
    roomId,
    gameId,
    expectedRevision,
    clientActionId,
  })
  .strict();

export const createRoomSchema = z
  .object({
    clientActionId,
    profile: z.object({ name, avatar }).strict(),
    visibility: z.enum(["public", "private"]).default("public"),
    settings: z
      .object({
        mode: z.enum(["normal", "blind"]),
        blindCount: z.number().int().min(0).max(10),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.settings.mode === "normal" && value.settings.blindCount !== 0) {
      context.addIssue({
        code: "custom",
        path: ["settings", "blindCount"],
        message: "normal mode requires zero blind cards",
      });
    }
    if (value.settings.mode === "blind" && value.settings.blindCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["settings", "blindCount"],
        message: "blind mode requires 1-10 blind cards",
      });
    }
  });

export const joinRoomSchema = commandBase
  .extend({ profile: z.object({ name, avatar }).strict() })
  .strict();
export const simpleCommandSchema = commandBase;
export const reconnectRoomSchema = commandBase
  .extend({ reconnectToken: z.string().min(32).max(128) })
  .strict();
export const transferHostSchema = commandBase.extend({ targetUid: uid }).strict();
export const updateRoomSettingsSchema = commandBase
  .extend({
    settings: z
      .object({ mode: z.enum(["normal", "blind"]), blindCount: z.number().int().min(0).max(10) })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.settings.mode === "normal" && value.settings.blindCount !== 0) {
      context.addIssue({
        code: "custom",
        path: ["settings", "blindCount"],
        message: "normal mode requires zero blind cards",
      });
    }
    if (value.settings.mode === "blind" && value.settings.blindCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["settings", "blindCount"],
        message: "blind mode requires 1-10 blind cards",
      });
    }
  });

const mimic = z
  .object({
    cardId,
    suit: z.enum(["spade", "heart", "diamond", "club"]),
    rank: z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"]),
  })
  .strict();

export const submitPlaySchema = commandBase
  .extend({
    cardIds: z.array(cardId).min(1).max(14),
    mimics: z.array(mimic).max(2).default([]),
    blindConfirmed: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.cardIds).size !== value.cardIds.length) {
      context.addIssue({ code: "custom", path: ["cardIds"], message: "card ids must be unique" });
    }
  });

export const declareJokerMimicSchema = commandBase
  .extend({
    mimics: z.array(mimic).min(1).max(2),
    blindConfirmed: z.literal(true),
  })
  .strict();
export const resolveStealSchema = commandBase
  .extend({
    selections: z
      .array(z.object({ targetUid: uid, cardId }).strict())
      .min(1)
      .max(6),
  })
  .strict();
export const resolveGiveSchema = commandBase
  .extend({
    transfers: z
      .array(z.object({ targetUid: uid, cardId }).strict())
      .min(1)
      .max(6),
  })
  .strict();
export const resolveDiscardSchema = commandBase
  .extend({ cardIds: z.array(cardId).min(1).max(6) })
  .strict();
export const resolveBomberSchema = commandBase
  .extend({
    ranks: z
      .array(z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "Joker"]))
      .min(1)
      .max(6),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.ranks).size !== value.ranks.length) {
      context.addIssue({ code: "custom", path: ["ranks"], message: "ranks must be unique" });
    }
  });
export const resolveCollectSchema = commandBase
  .extend({ cardIds: z.array(cardId).min(1).max(6) })
  .strict();
export const focusSchema = commandBase.extend({ focusPlayerId: uid.nullable() }).strict();
export const chatSchema = commandBase
  .extend({
    text: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (value) => !containsChatControlCharacter(value),
        "control characters are not allowed",
      ),
  })
  .strict();

const catalogId = (prefix: string, maximum: number, allowNone = false) =>
  z.string().refine((value) => {
    if (allowNone && value === "none") return true;
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
    const index = match?.[1] ? Number(match[1]) : 0;
    return index >= 1 && index <= maximum;
  }, `unsupported ${prefix} id`);

const facePaintPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

const facePaintStrokeSchema = z
  .object({
    mode: z.enum(["paint", "erase"]),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    width: z.number().finite().min(0.004).max(0.12),
    points: z.array(facePaintPointSchema).min(1).max(128),
  })
  .strict();

const facePaintSchema = z
  .object({
    version: z.literal(1),
    strokes: z.array(facePaintStrokeSchema).max(32),
  })
  .strict()
  .superRefine((layer, context) => {
    const totalPoints = layer.strokes.reduce((total, stroke) => total + stroke.points.length, 0);
    if (totalPoints > 2_048) {
      context.addIssue({
        code: "custom",
        path: ["strokes"],
        message: "face paint has too many points",
      });
    }
    if (JSON.stringify(layer).length > 65_536) {
      context.addIssue({ code: "custom", message: "face paint payload is too large" });
    }
  });

export const avatarProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    bodyPresetId: catalogId("body", 12),
    headPresetId: catalogId("head", 16),
    morphs: z
      .object({
        height: z.number().min(0).max(1),
        build: z.number().min(0).max(1),
        faceWidth: z.number().min(0).max(1),
      })
      .strict(),
    parts: z
      .object({
        skinTone: catalogId("skin", 24),
        hair: catalogId("hair", 144),
        eyes: catalogId("eyes", 36),
        iris: catalogId("iris", 18),
        brows: catalogId("brows", 28),
        nose: catalogId("nose", 24),
        mouth: catalogId("mouth", 32),
        ears: catalogId("ears", 12),
        beard: catalogId("beard", 24, true),
        marks: catalogId("marks", 96, true),
        eyewear: catalogId("eyewear", 80, true),
        headwear: catalogId("headwear", 120, true),
        earrings: catalogId("earrings", 28, true),
        jewelry: catalogId("jewelry", 32, true),
        tops: catalogId("tops", 60),
        outerwear: catalogId("outerwear", 36, true),
        bottoms: catalogId("bottoms", 40),
        fullOutfit: catalogId("full-outfit", 40, true),
        shoes: catalogId("shoes", 36),
        gloves: catalogId("gloves", 20, true),
        expression: catalogId("expression", 20),
      })
      .strict(),
    colors: z
      .object({
        skin: z.string().regex(/^#[0-9a-f]{6}$/i),
        hair: z.string().regex(/^#[0-9a-f]{6}$/i),
        eyes: z.string().regex(/^#[0-9a-f]{6}$/i),
        outfit: z.string().regex(/^#[0-9a-f]{6}$/i),
        accent: z.string().regex(/^#[0-9a-f]{6}$/i),
      })
      .strict(),
    materials: z
      .object({
        outfit: z.enum(["velvet", "satin", "wool", "silk"]),
        accent: z.enum(["brass", "silver", "enamel"]),
      })
      .strict(),
    animationSetId: catalogId("animation", 24),
    facePaint: facePaintSchema.optional(),
  })
  .strict();

export const saveAvatarProfileSchema = z
  .object({ clientActionId, avatar: avatarProfileSchema })
  .strict();

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type RoomCommandInput = z.infer<typeof simpleCommandSchema>;
export type SubmitPlayInput = z.infer<typeof submitPlaySchema>;
