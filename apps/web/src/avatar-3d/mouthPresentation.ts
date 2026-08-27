import { proceduralPartStyle } from "./proceduralAvatar";

export type MouthShape = "neutral" | "smile" | "frown" | "toothy" | "surprised";

export interface MouthPresentation {
  shape: MouthShape;
  /** The visible long axis is always horizontal in face-local coordinates. */
  orientation: "horizontal";
  rotationZ: number;
  arc: number;
  widthScale: number;
  heightScale: number;
  thickness: number;
}

export interface BeardPresentation {
  /** Beard arcs surround the chin in face-local XY coordinates. */
  orientation: "horizontal";
  rotationZ: number;
  widthScale: number;
  heightScale: number;
  thickness: number;
}

const mouthShapes: readonly MouthShape[] = ["neutral", "smile", "frown", "toothy", "surprised"];

/**
 * Turns every existing mouth catalog ID into one of five visibly distinct shapes.
 * TorusGeometry already lies in the XY plane: rotating its half arc by π/2 was
 * the reason the old mouth appeared sideways.
 */
export function mouthPresentation(mouthId: string, expressionId: string): MouthPresentation {
  const mouth = proceduralPartStyle("mouth", mouthId);
  const expression = proceduralPartStyle("expression", expressionId);
  const shape = mouthShapes[(Math.max(1, mouth.index) - 1) % mouthShapes.length]!;
  return {
    shape,
    orientation: "horizontal",
    rotationZ: shape === "smile" ? Math.PI : shape === "neutral" ? Math.PI / 2 : 0,
    arc: shape === "surprised" ? Math.PI * 2 : shape === "smile" || shape === "frown" ? Math.PI : 0,
    widthScale: 0.86 + mouth.signature * 0.42,
    heightScale: 0.82 + expression.wave * 0.24,
    thickness: 0.014 + mouth.sweep * 0.012,
  };
}

/**
 * TorusGeometry's half arc is already horizontal in the XY plane. A half turn
 * places that arc below the mouth; the old quarter turn produced a sideways C.
 */
export function beardPresentation(beardId: string): BeardPresentation {
  const beard = proceduralPartStyle("beard", beardId);
  return {
    orientation: "horizontal",
    rotationZ: Math.PI,
    widthScale: 0.9 + beard.signature * 0.42,
    heightScale: 0.88 + beard.wave * 0.25,
    thickness: 0.035 + beard.sweep * 0.035,
  };
}
