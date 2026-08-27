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
