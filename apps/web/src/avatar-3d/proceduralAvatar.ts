import { avatarCatalog } from "@daifugo/avatar-schema";

export type CatalogKey = keyof typeof avatarCatalog;

export interface ProceduralPartStyle {
  active: boolean;
  index: number;
  total: number;
  /** A catalog-wide unique value. It is deliberately not reduced to a small modulo bucket. */
  signature: number;
  wave: number;
  sweep: number;
  family: number;
}

export function proceduralPartStyle(key: CatalogKey, id: string): ProceduralPartStyle {
  const values = avatarCatalog[key] as readonly string[];
  const slot = values.indexOf(id);
  const hasNone = values[0] === "none";
  const firstPartSlot = hasNone ? 1 : 0;
  const total = values.length - firstPartSlot;
  const index = slot < firstPartSlot ? 0 : slot - firstPartSlot + 1;
  const signature = index > 0 && total > 1 ? (index - 1) / (total - 1) : 0;
  return {
    active: index > 0,
    index,
    total,
    signature,
    wave: index > 0 ? (Math.sin(index * 2.399963229728653) + 1) / 2 : 0,
    sweep: index > 0 ? (Math.sin(index * 1.324717957244746) + 1) / 2 : 0,
    family: index > 0 ? Math.min(5, Math.floor(signature * 6)) : 0,
  };
}

export interface AvatarPose {
  rootY: number;
  rootX: number;
  rootYaw: number;
  rootRoll: number;
  bodyPitch: number;
  headPitch: number;
  headYaw: number;
  leftArm: number;
  rightArm: number;
  leftArmLift: number;
  rightArmLift: number;
  legLift: number;
}

/**
 * The avatar mesh faces +Z, while a first-person yaw of zero looks toward -Z.
 * Apply the half turn here so callers can pass their camera/view yaw directly.
 */
export function avatarFacingYaw(viewYaw: number | undefined, animationYaw = 0): number {
  const yaw = (viewYaw === undefined ? 0 : viewYaw + Math.PI) + animationYaw;
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

const still = (): AvatarPose => ({
  rootY: 0,
  rootX: 0,
  rootYaw: 0,
  rootRoll: 0,
  bodyPitch: 0,
  headPitch: 0,
  headYaw: 0,
  leftArm: 0,
  rightArm: 0,
  leftArmLift: 0,
  rightArmLift: 0,
  legLift: 0,
});

export const animationNames = [
  "呼吸",
  "ゆったり揺れる",
  "場を注視",
  "思案",
  "拍手",
  "歓喜",
  "驚き",
  "悔しがる",
  "お辞儀",
  "手を振る",
  "うなずく",
  "首を振る",
  "伸び",
  "足で拍子",
  "カードを構える",
  "勝利ポーズ",
  "笑う",
  "肩をすくめる",
  "ステップ",
  "正装の静止",
  "うとうと",
  "身を乗り出す",
  "瞑想",
  "弾む待機",
] as const;

/** 24 IDs are explicit semantic motions, not speed variants of one idle loop. */
export function animationPose(animationId: string, time: number, active = false): AvatarPose {
  const index = (avatarCatalog.animationSetId as readonly string[]).indexOf(animationId) + 1;
  const pose = still();
  const s = Math.sin(time * 2.2);
  const slow = Math.sin(time * 0.85);
  const pulse = Math.max(0, Math.sin(time * 4.4));
  switch (index) {
    case 1:
      pose.rootY = s * 0.012;
      pose.bodyPitch = s * 0.012;
      break;
    case 2:
      pose.rootRoll = slow * 0.055;
      pose.headYaw = -slow * 0.08;
      break;
    case 3:
      pose.bodyPitch = -0.075 + s * 0.01;
      pose.headPitch = -0.06;
      pose.leftArm = 0.16;
      pose.rightArm = -0.16;
      break;
    case 4:
      pose.headPitch = 0.12 + slow * 0.035;
      pose.headYaw = slow * 0.14;
      pose.rightArm = -0.72;
      pose.rightArmLift = 0.24;
      break;
    case 5:
      pose.leftArm = 0.9 + s * 0.24;
      pose.rightArm = -0.9 - s * 0.24;
      pose.leftArmLift = pose.rightArmLift = 0.35;
      break;
    case 6:
      pose.rootY = pulse * 0.16;
      pose.leftArm = 1.35;
      pose.rightArm = -1.35;
      pose.rootYaw = s * 0.08;
      break;
    case 7:
      pose.rootY = pulse * 0.09;
      pose.rootX = -0.08;
      pose.leftArm = -0.62;
      pose.rightArm = 0.62;
      pose.headPitch = -0.18;
      break;
    case 8:
      pose.bodyPitch = 0.18;
      pose.headPitch = 0.26;
      pose.leftArm = slow * 0.08;
      pose.rightArm = -slow * 0.08;
      break;
    case 9:
      pose.bodyPitch = 0.34 * pulse;
      pose.headPitch = 0.22 * pulse;
      break;
    case 10:
      pose.rightArm = -1.15 + s * 0.36;
      pose.rightArmLift = 0.58;
      pose.headYaw = 0.12;
      break;
    case 11:
      pose.headPitch = s * 0.22;
      pose.bodyPitch = -0.035;
      break;
    case 12:
      pose.headYaw = Math.sin(time * 3.1) * 0.28;
      pose.rootYaw = -pose.headYaw * 0.12;
      break;
    case 13:
      pose.leftArm = 1.5;
      pose.rightArm = -1.5;
      pose.rootY = slow * 0.025;
      pose.bodyPitch = -0.1;
      break;
    case 14:
      pose.legLift = pulse * 0.16;
      pose.rootRoll = s * 0.018;
      break;
    case 15:
      pose.bodyPitch = -0.12;
      pose.leftArm = 0.44;
      pose.rightArm = -0.44;
      pose.leftArmLift = pose.rightArmLift = 0.22;
      pose.headPitch = -0.09;
      break;
    case 16:
      pose.leftArm = 1.42;
      pose.rightArm = -0.42;
      pose.rootYaw = slow * 0.16;
      pose.rootY = pulse * 0.06;
      break;
    case 17:
      pose.rootY = pulse * 0.045;
      pose.bodyPitch = s * 0.055;
      pose.headPitch = -0.08;
      pose.leftArm = -0.22;
      pose.rightArm = 0.22;
      break;
    case 18:
      pose.leftArm = -0.76 + slow * 0.08;
      pose.rightArm = 0.76 - slow * 0.08;
      pose.leftArmLift = pose.rightArmLift = 0.2;
      pose.headYaw = slow * 0.1;
      break;
    case 19:
      pose.rootX = Math.sin(time * 2.7) * 0.12;
      pose.rootYaw = Math.sin(time * 1.35) * 0.24;
      pose.leftArm = s * 0.52;
      pose.rightArm = s * 0.52;
      pose.legLift = pulse * 0.1;
      break;
    case 20:
      pose.rootY = Math.sin(time * 1.1) * 0.006;
      pose.leftArm = 0.04;
      pose.rightArm = -0.04;
      pose.headPitch = -0.025;
      break;
    case 21:
      pose.headPitch = 0.18 + slow * 0.1;
      pose.rootRoll = slow * 0.025;
      pose.bodyPitch = 0.08;
      break;
    case 22:
      pose.bodyPitch = -0.2 + slow * 0.025;
      pose.headPitch = -0.14;
      pose.headYaw = s * 0.1;
      pose.rootX = 0.045;
      break;
    case 23:
      pose.rootY = Math.sin(time * 0.65) * 0.02;
      pose.leftArm = 0.48;
      pose.rightArm = -0.48;
      pose.headPitch = 0.07;
      break;
    case 24:
      pose.rootY = Math.abs(Math.sin(time * 3.4)) * 0.11;
      pose.rootRoll = s * 0.045;
      pose.leftArm = s * 0.22;
      pose.rightArm = -s * 0.22;
      break;
    default:
      pose.rootY = s * 0.012;
  }
  if (active) {
    pose.rootY += Math.max(0, Math.sin(time * 3.2)) * 0.018;
    pose.headPitch -= 0.025;
  }
  return pose;
}
