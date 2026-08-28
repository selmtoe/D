import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  LinearFilter,
  Matrix4,
  Quaternion,
  Raycaster,
  Vector3,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";

type ThreeXrSession = NonNullable<Parameters<WebGLRenderer["xr"]["setSession"]>[0]>;

export type ImmersiveVrSupport = "checking" | "supported" | "unsupported";

type ImmersiveVrSystem = {
  isSessionSupported(mode: "immersive-vr"): Promise<boolean>;
  requestSession(
    mode: "immersive-vr",
    options?: { optionalFeatures?: string[] },
  ): Promise<ThreeXrSession>;
};

export type VrPanelAction = {
  id: string;
  label: string;
  enabled: boolean;
  selected?: boolean | undefined;
  confirm?: boolean | undefined;
  tone?: "primary" | "neutral" | "danger" | undefined;
  activate: () => void;
};

export type VrPanelModel = {
  title: string;
  status: string;
  resetKey?: string | undefined;
  actions: readonly VrPanelAction[];
  options?: readonly VrPanelAction[] | undefined;
};

function immersiveVrSystem(): ImmersiveVrSystem | undefined {
  return (navigator as Navigator & { xr?: ImmersiveVrSystem }).xr;
}

export async function detectImmersiveVrSupport(
  xr: Pick<ImmersiveVrSystem, "isSessionSupported"> | undefined,
): Promise<boolean> {
  if (!xr || !window.isSecureContext) return false;
  try {
    return await xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}

export function webXrErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "VRの利用が許可されませんでした。ブラウザーの権限を確認してください。";
  if (name === "NotSupportedError") return "この端末では没入型VRを開始できません。";
  return "VRを開始できませんでした。ヘッドセットの接続を確認してください。";
}

export function xrActionFromObject(object: Object3D | null): (() => void) | undefined {
  let current: Object3D | null = object;
  while (current) {
    const action = current.userData.xrAction as (() => void) | undefined;
    if (action) return action;
    current = current.parent;
  }
  return undefined;
}

export function WebXrSessionButton({
  renderer,
  onPresentingChange,
}: {
  renderer: WebGLRenderer | undefined;
  onPresentingChange: (presenting: boolean) => void;
}) {
  const [support, setSupport] = useState<ImmersiveVrSupport>("checking");
  const [session, setSession] = useState<ThreeXrSession>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const sessionRef = useRef<ThreeXrSession | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void detectImmersiveVrSupport(immersiveVrSystem()).then((supported) => {
      if (live) setSupport(supported ? "supported" : "unsupported");
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      const active = sessionRef.current;
      sessionRef.current = undefined;
      if (active) void active.end().catch(() => undefined);
    },
    [],
  );

  if (support !== "supported" && !session) return null;

  const toggle = async () => {
    if (starting || !renderer) return;
    if (session) {
      await session.end().catch(() => undefined);
      return;
    }
    const xr = immersiveVrSystem();
    if (!xr) return;
    setStarting(true);
    setError(undefined);
    let requestedSession: ThreeXrSession | undefined;
    try {
      if (document.pointerLockElement) document.exitPointerLock?.();
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType("local-floor");
      renderer.xr.setFramebufferScaleFactor(0.9);
      const next = await xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      requestedSession = next;
      const ended = () => {
        if (sessionRef.current !== next) return;
        sessionRef.current = undefined;
        setSession(undefined);
        onPresentingChange(false);
      };
      next.addEventListener("end", ended, { once: true });
      await renderer.xr.setSession(next);
      renderer.xr.setFoveation(0.45);
      sessionRef.current = next;
      setSession(next);
      onPresentingChange(true);
    } catch (nextError) {
      if (requestedSession) await requestedSession.end().catch(() => undefined);
      setError(webXrErrorMessage(nextError));
      onPresentingChange(false);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="webxr-entry" data-webxr-presenting={session ? "true" : "false"}>
      <button type="button" disabled={starting || !renderer} onClick={() => void toggle()}>
        {starting ? "VRを準備中…" : session ? "VRを終了" : "VRで遊ぶ"}
      </button>
      {error && (
        <p role="alert" onClick={() => setError(undefined)}>
          {error}
        </p>
      )}
    </div>
  );
}

const rayOrigin = new Vector3();
const rayDirection = new Vector3();
const rayQuaternion = new Quaternion();

function VrController({ index }: { index: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const controller = useMemo(() => gl.xr.getController(index), [gl, index]);
  const raycaster = useMemo(() => new Raycaster(), []);
  const laser = useRef<Mesh>(null);
  const reticle = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const currentAction = useRef<(() => void) | undefined>(undefined);

  const updateTarget = useCallback(() => {
    rayOrigin.setFromMatrixPosition(controller.matrixWorld);
    controller.getWorldQuaternion(rayQuaternion);
    rayDirection.set(0, 0, -1).applyQuaternion(rayQuaternion).normalize();
    raycaster.set(rayOrigin, rayDirection);
    raycaster.far = 12;
    const intersections = raycaster.intersectObjects(scene.children, true);
    const target = intersections.find((intersection) => xrActionFromObject(intersection.object));
    currentAction.current = target ? xrActionFromObject(target.object) : undefined;
    return target?.distance ?? 5;
  }, [controller, raycaster, scene]);

  useEffect(() => {
    const select = () => currentAction.current?.();
    controller.addEventListener("selectstart", select);
    return () => controller.removeEventListener("selectstart", select);
  }, [controller]);

  useFrame(() => {
    const distance = updateTarget();
    if (laser.current) {
      laser.current.position.z = -distance / 2;
      laser.current.scale.z = distance;
    }
    if (reticle.current) reticle.current.position.z = -distance;
    if (material.current) {
      material.current.color.set(currentAction.current ? "#7dffc2" : "#d6e6e1");
      material.current.opacity = currentAction.current ? 0.92 : 0.5;
    }
  });

  return (
    <primitive object={controller}>
      <mesh ref={laser} scale={[1, 1, 5]} position={[0, 0, -2.5]}>
        <boxGeometry args={[0.008, 0.008, 1]} />
        <meshBasicMaterial ref={material} color="#d6e6e1" transparent opacity={0.5} />
      </mesh>
      <mesh ref={reticle} position={[0, 0, -5]}>
        <ringGeometry args={[0.018, 0.032, 24]} />
        <meshBasicMaterial color="#7dffc2" side={DoubleSide} depthTest={false} />
      </mesh>
      <mesh position={[0, -0.055, 0.04]} rotation={[0.28, 0, 0]}>
        <capsuleGeometry args={[0.035, 0.12, 4, 10]} />
        <meshStandardMaterial color={index === 0 ? "#8fb8aa" : "#c9a868"} roughness={0.55} />
      </mesh>
    </primitive>
  );
}

export function VrControllers({ presenting }: { presenting: boolean }) {
  if (!presenting) return null;
  return (
    <>
      <VrController index={0} />
      <VrController index={1} />
    </>
  );
}

export function VrOrigin({
  presenting,
  viewpointIndex,
  playerCount,
}: {
  presenting: boolean;
  viewpointIndex: number;
  playerCount: number;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const rotation = (viewpointIndex / Math.max(playerCount, 1)) * Math.PI * 2;
  useEffect(() => {
    if (!presenting) return;
    const position = new Vector3(0, 0, 6.65).applyAxisAngle(new Vector3(0, 1, 0), -rotation);
    camera.position.copy(position);
    camera.rotation.set(0, -rotation, 0, "YXZ");
    camera.updateMatrixWorld(true);
    gl.domElement.dataset.webxrViewpoint = `${viewpointIndex}/${Math.max(playerCount, 1)}`;
    return () => {
      delete gl.domElement.dataset.webxrViewpoint;
    };
  }, [camera, gl, playerCount, presenting, rotation, viewpointIndex]);
  return null;
}

function textTexture(text: string, selected = false, danger = false): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = danger ? "#6d252b" : selected ? "#745f23" : "#102d29";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = selected ? "#ffe08b" : "#9dbab1";
    context.lineWidth = 8;
    context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    context.fillStyle = "#fff8e7";
    context.font = "700 54px 'Yu Gothic UI', 'Noto Sans JP', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const display = text.length > 18 ? `${text.slice(0, 17)}…` : text;
    context.fillText(display, canvas.width / 2, canvas.height / 2, canvas.width - 52);
  }
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

function VrTextPlate({
  action,
  position,
  size,
  armed,
  activate,
}: {
  action: VrPanelAction;
  position: [number, number, number];
  size: [number, number];
  armed: boolean;
  activate: () => void;
}) {
  const label = armed ? `確定: ${action.label}` : action.label;
  const texture = useMemo(
    () => textTexture(label, action.selected || armed, action.tone === "danger"),
    [action.selected, action.tone, armed, label],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group
      position={position}
      userData={{ xrAction: action.enabled ? activate : undefined }}
      scale={action.enabled ? 1 : 0.96}
    >
      <mesh>
        <boxGeometry args={[size[0], size[1], 0.055]} />
        <meshStandardMaterial
          color={action.enabled ? new Color("#d7c27f") : new Color("#3f4b48")}
          emissive={action.selected || armed ? new Color("#80671c") : new Color("#07110f")}
          emissiveIntensity={action.selected || armed ? 0.28 : 0.08}
          roughness={0.72}
        />
      </mesh>
      <mesh position={[0, 0, 0.031]}>
        <planeGeometry args={[size[0] - 0.04, size[1] - 0.04]} />
        <meshBasicMaterial map={texture} transparent opacity={action.enabled ? 1 : 0.42} />
      </mesh>
    </group>
  );
}

function VrLabel({
  text,
  position,
  size,
}: {
  text: string;
  position: [number, number, number];
  size: [number, number];
}) {
  const texture = useMemo(() => textTexture(text), [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} transparent />
    </mesh>
  );
}

export function VrGameHud({
  presenting,
  panel,
  viewpointIndex,
  playerCount,
}: {
  presenting: boolean;
  panel: VrPanelModel | undefined;
  viewpointIndex: number;
  playerCount: number;
}) {
  const [armedActionId, setArmedActionId] = useState<string>();
  const rotation = (viewpointIndex / Math.max(playerCount, 1)) * Math.PI * 2;
  const transform = useMemo(() => new Matrix4().makeRotationY(-rotation), [rotation]);
  const position = useMemo(() => new Vector3(2.5, 1.72, 3.55).applyMatrix4(transform), [transform]);
  useEffect(() => setArmedActionId(undefined), [panel?.resetKey, panel?.status, panel?.title]);
  if (!presenting || !panel) return null;

  const activate = (action: VrPanelAction) => {
    if (!action.enabled) return;
    if (action.confirm && armedActionId !== action.id) {
      setArmedActionId(action.id);
      return;
    }
    setArmedActionId(undefined);
    action.activate();
  };
  const options = panel.options ?? [];
  const optionColumns = options.length > 8 ? 4 : options.length > 4 ? 3 : 2;
  const optionWidth = 2.52 / optionColumns;
  const optionRows = Math.ceil(options.length / optionColumns);
  const panelHeight = Math.max(1.75, 1.45 + optionRows * 0.34);

  return (
    <group position={position.toArray()} rotation={[0, -rotation, 0]}>
      <mesh position={[0, -0.05, -0.065]}>
        <boxGeometry args={[2.78, panelHeight, 0.1]} />
        <meshStandardMaterial color="#071713" roughness={0.82} metalness={0.08} />
      </mesh>
      <VrLabel text={panel.title} position={[0, panelHeight / 2 - 0.23, 0]} size={[2.52, 0.34]} />
      <VrLabel text={panel.status} position={[0, panelHeight / 2 - 0.59, 0]} size={[2.52, 0.28]} />
      {options.map((option, index) => {
        const column = index % optionColumns;
        const row = Math.floor(index / optionColumns);
        return (
          <VrTextPlate
            key={option.id}
            action={option}
            armed={armedActionId === option.id}
            activate={() => activate(option)}
            position={[
              (column - (optionColumns - 1) / 2) * optionWidth,
              panelHeight / 2 - 0.94 - row * 0.34,
              0,
            ]}
            size={[optionWidth - 0.08, 0.27]}
          />
        );
      })}
      {panel.actions.map((action, index) => {
        const width = 2.52 / Math.max(panel.actions.length, 1);
        return (
          <VrTextPlate
            key={action.id}
            action={action}
            armed={armedActionId === action.id}
            activate={() => activate(action)}
            position={[
              (index - (panel.actions.length - 1) / 2) * width,
              -panelHeight / 2 + 0.27,
              0,
            ]}
            size={[width - 0.08, 0.38]}
          />
        );
      })}
    </group>
  );
}
