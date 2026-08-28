import policy from "../ai/cpu-policy-v3.json";

type WebPolicy = {
  schemaVersion: number;
  modelClass: string;
  sourceCheckpointSha256: string;
  stateDim: number;
  actionDim: number;
  hiddenDim: number;
  tensorEncoding: string;
  stateFeatureNames: string[];
  actionFeatureNames: string[];
  tensors: Record<string, { length: number; base64: string }>;
};

const model = policy as WebPolicy;
const EXPECTED_SHA256 = "2dba4efb677c6664ca543b31ce08882dafb7127a6969dd0852dc9486724910f8";

function tensor(name: string, expectedLength: number): readonly number[] {
  const encoded = model.tensors[name];
  if (!encoded || encoded.length !== expectedLength || encoded.base64.length > expectedLength * 8) {
    throw new Error(`invalid CPU policy tensor: ${name}`);
  }
  const bytes = Uint8Array.from(atob(encoded.base64), (character) => character.charCodeAt(0));
  if (bytes.byteLength !== expectedLength * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`invalid CPU policy tensor bytes: ${name}`);
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = Array.from({ length: expectedLength }, (_, index) =>
    data.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true),
  );
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`non-finite CPU policy tensor: ${name}`);
  }
  return values;
}

function dense(
  input: readonly number[],
  weight: readonly number[],
  bias: readonly number[],
  outputSize: number,
): number[] {
  const output = new Array<number>(outputSize);
  for (let row = 0; row < outputSize; row += 1) {
    let value = bias[row] ?? 0;
    const offset = row * input.length;
    for (let column = 0; column < input.length; column += 1) {
      value += (weight[offset + column] ?? 0) * (input[column] ?? 0);
    }
    output[row] = value;
  }
  return output;
}

function layerNorm(
  input: readonly number[],
  weight: readonly number[],
  bias: readonly number[],
): number[] {
  const mean = input.reduce((sum, value) => sum + value, 0) / input.length;
  const variance =
    input.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / input.length;
  const inverseStandardDeviation = 1 / Math.sqrt(variance + 1e-5);
  return input.map(
    (value, index) =>
      (value - mean) * inverseStandardDeviation * (weight[index] ?? 1) + (bias[index] ?? 0),
  );
}

function silu(values: readonly number[]): number[] {
  return values.map((value) => value / (1 + Math.exp(-value)));
}

function validateModel(): void {
  if (
    model.schemaVersion !== 1 ||
    model.modelClass !== "CandidateScorer" ||
    model.sourceCheckpointSha256 !== EXPECTED_SHA256 ||
    model.tensorEncoding !== "float32-le-base64" ||
    model.stateDim !== model.stateFeatureNames.length ||
    model.actionDim !== model.actionFeatureNames.length ||
    model.hiddenDim < 8 ||
    model.hiddenDim > 512
  ) {
    throw new Error("CPU policy metadata does not match the browser runtime");
  }
}

validateModel();

const hidden = model.hiddenDim;
const stateWeight1 = tensor("state_encoder.0.weight", hidden * model.stateDim);
const stateBias1 = tensor("state_encoder.0.bias", hidden);
const stateNormWeight = tensor("state_encoder.1.weight", hidden);
const stateNormBias = tensor("state_encoder.1.bias", hidden);
const stateWeight2 = tensor("state_encoder.3.weight", hidden * hidden);
const stateBias2 = tensor("state_encoder.3.bias", hidden);
const actionWeight = tensor("action_encoder.0.weight", hidden * model.actionDim);
const actionBias = tensor("action_encoder.0.bias", hidden);
const actionNormWeight = tensor("action_encoder.1.weight", hidden);
const actionNormBias = tensor("action_encoder.1.bias", hidden);
const scoreWeight1 = tensor("scorer.0.weight", hidden * hidden * 2);
const scoreBias1 = tensor("scorer.0.bias", hidden);
const scoreWeight2 = tensor("scorer.2.weight", hidden);
const scoreBias2 = tensor("scorer.2.bias", 1);

export const cpuPolicyMetadata = Object.freeze({
  checkpointSha256: model.sourceCheckpointSha256,
  stateDim: model.stateDim,
  actionDim: model.actionDim,
  hiddenDim: model.hiddenDim,
  parameterCount: Object.values(model.tensors).reduce((sum, value) => sum + value.length, 0),
});

export function scoreCpuCandidates(
  state: readonly number[],
  actions: readonly (readonly number[])[],
): number[] {
  if (
    state.length !== model.stateDim ||
    actions.some((action) => action.length !== model.actionDim)
  ) {
    throw new Error("CPU policy feature dimensions do not match the trained model");
  }
  if (!state.every(Number.isFinite) || actions.some((action) => !action.every(Number.isFinite))) {
    throw new Error("CPU policy received non-finite features");
  }
  const stateHidden = silu(
    dense(
      silu(
        layerNorm(dense(state, stateWeight1, stateBias1, hidden), stateNormWeight, stateNormBias),
      ),
      stateWeight2,
      stateBias2,
      hidden,
    ),
  );
  return actions.map((action) => {
    const actionHidden = silu(
      layerNorm(dense(action, actionWeight, actionBias, hidden), actionNormWeight, actionNormBias),
    );
    const combined = [...stateHidden, ...actionHidden];
    const scoreHidden = silu(dense(combined, scoreWeight1, scoreBias1, hidden));
    return dense(scoreHidden, scoreWeight2, scoreBias2, 1)[0] ?? Number.NEGATIVE_INFINITY;
  });
}
