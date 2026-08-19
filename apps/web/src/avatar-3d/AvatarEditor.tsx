import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import {
  avatarCatalog,
  randomAvatar,
  type AvatarPartKey,
  type AvatarProfileV1,
} from "@daifugo/avatar-schema";
import { Avatar3D } from "./Avatar3D";
import { loadPresets, savePresets } from "./avatarStorage";
import { firebaseErrorMessage, sendCommand } from "../network/firebaseClient";

type Tab = "face" | "hair" | "expression" | "clothes" | "decor" | "body";
const tabs: { id: Tab; label: string }[] = [
  { id: "face", label: "顔" },
  { id: "hair", label: "髪" },
  { id: "expression", label: "表情" },
  { id: "clothes", label: "服" },
  { id: "decor", label: "装飾" },
  { id: "body", label: "体格" },
];
const colors = [
  "#f1c7a5",
  "#d89b72",
  "#bd7e5a",
  "#8c583c",
  "#5c3828",
  "#30211d",
  "#151619",
  "#402416",
  "#d9be85",
  "#123f32",
  "#21375a",
  "#682e3d",
  "#5b3268",
];

function PartChoices({
  part,
  values,
  value,
  setValue,
}: {
  part: AvatarPartKey;
  values: readonly string[];
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div className="part-grid" role="listbox" aria-label={`${part}のパーツ`}>
      {values.slice(0, 72).map((id, index) => (
        <button
          key={id}
          type="button"
          role="option"
          aria-selected={value === id}
          className="part-choice"
          onClick={() => setValue(id)}
        >
          <span className={`part-glyph glyph-${index % 6}`} aria-hidden="true" />
          {index + 1}
        </button>
      ))}
    </div>
  );
}

export function AvatarEditor({
  value,
  onCancel,
  onSave,
  lowPower,
}: {
  value: AvatarProfileV1;
  onCancel: () => void;
  onSave: (profile: AvatarProfileV1) => void;
  lowPower: boolean;
}) {
  const [draft, setDraft] = useState(() => structuredClone(value));
  const [history, setHistory] = useState<AvatarProfileV1[]>([]);
  const [future, setFuture] = useState<AvatarProfileV1[]>([]);
  const [tab, setTab] = useState<Tab>("face");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [presets, setPresetState] = useState(loadPresets);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    document.body.classList.add("modal-open");
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])",
        ),
      ];
      const first = focusable[0],
        last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", keydown);
      previousFocus.current?.focus();
    };
  }, [onCancel]);

  const commit = (next: AvatarProfileV1) => {
    setHistory((items) => [...items.slice(-29), structuredClone(draft)]);
    setFuture([]);
    setDraft(next);
  };
  const patchPart = (part: AvatarPartKey, id: string) =>
    commit({ ...draft, parts: { ...draft.parts, [part]: id } });
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [structuredClone(draft), ...items]);
    setDraft(previous);
    setHistory((items) => items.slice(0, -1));
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, structuredClone(draft)]);
    setDraft(next);
    setFuture((items) => items.slice(1));
  };
  const persistPreset = () => {
    const next = [
      ...presets,
      {
        id: crypto.randomUUID(),
        name: `仕立て ${presets.length + 1}`,
        profile: structuredClone(draft),
      },
    ].slice(-8);
    setPresetState(next);
    savePresets(next);
  };
  const deletePreset = (id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    setPresetState(next);
    savePresets(next);
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await sendCommand("saveAvatarProfile", { avatar: draft });
      onSave(draft);
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="avatar-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-title"
        aria-describedby="avatar-description"
        tabIndex={-1}
        ref={dialog}
      >
        <header>
          <div>
            <p className="eyebrow">CHARACTER ATELIER</p>
            <h2 id="avatar-title">アバターを仕立てる</h2>
            <p id="avatar-description">共通3Dパーツから、ゲームをまたいで使う姿を選びます。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="アバター編集を閉じる"
          >
            ×
          </button>
        </header>
        <div className="editor-layout">
          <section
            className="turntable"
            aria-label="3Dアバタープレビュー"
            onPointerMove={(event) => {
              if (event.buttons === 1) setRotation((angle) => angle + event.movementX * 0.01);
            }}
            onWheel={(event) => {
              event.preventDefault();
              setZoom((current) => Math.max(0.75, Math.min(1.35, current - event.deltaY * 0.001)));
            }}
          >
            <Canvas dpr={lowPower ? 0.8 : 1.3} camera={{ position: [0, 1.25, 5], fov: 36 }}>
              <ambientLight intensity={1.8} />
              <directionalLight position={[3, 5, 4]} intensity={3} />
              <group position={[0, -0.62, 0]} rotation={[0, rotation, 0]} scale={zoom}>
                <Avatar3D profile={draft} lowPower={lowPower} />
              </group>
            </Canvas>
            <div className="turntable-actions">
              <button
                type="button"
                onClick={() => {
                  setRotation(0);
                  setZoom(1);
                }}
              >
                正面へ戻す
              </button>
              <button type="button" onClick={() => commit(randomAvatar())}>
                ランダム生成
              </button>
            </div>
            <p className="comparison">
              <span>
                変更前 <i style={{ background: value.colors.outfit }} />
              </span>
              <span>
                編集中 <i style={{ background: draft.colors.outfit }} />
              </span>
            </p>
          </section>
          <section className="parts-panel">
            <nav className="avatar-tabs" role="tablist" aria-label="編集項目">
              {tabs.map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  key={item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="parts-scroll">
              {tab === "face" && (
                <>
                  <h3>頭部形状</h3>
                  <div className="part-grid">
                    {avatarCatalog.headPresetId.map((id, index) => (
                      <button
                        type="button"
                        key={id}
                        className="part-choice"
                        aria-pressed={draft.headPresetId === id}
                        onClick={() => commit({ ...draft, headPresetId: id })}
                      >
                        <span className={`head-glyph head-${index % 4}`} />
                        {index + 1}
                      </button>
                    ))}
                  </div>
                  <h3>肌トーン</h3>
                  <PartChoices
                    part="skinTone"
                    values={avatarCatalog.skinTone}
                    value={draft.parts.skinTone}
                    setValue={(id) => patchPart("skinTone", id)}
                  />
                  <div className="color-grid">
                    {colors.slice(0, 6).map((color) => (
                      <button
                        type="button"
                        key={color}
                        aria-label={`肌色 ${color}`}
                        aria-pressed={draft.colors.skin === color}
                        style={{ background: color }}
                        onClick={() =>
                          commit({ ...draft, colors: { ...draft.colors, skin: color } })
                        }
                      />
                    ))}
                  </div>
                  <h3>鼻</h3>
                  <PartChoices
                    part="nose"
                    values={avatarCatalog.nose}
                    value={draft.parts.nose}
                    setValue={(id) => patchPart("nose", id)}
                  />
                  <h3>耳</h3>
                  <PartChoices
                    part="ears"
                    values={avatarCatalog.ears}
                    value={draft.parts.ears}
                    setValue={(id) => patchPart("ears", id)}
                  />
                  <h3>髭・フェイスマーク</h3>
                  <PartChoices
                    part="beard"
                    values={avatarCatalog.beard}
                    value={draft.parts.beard}
                    setValue={(id) => patchPart("beard", id)}
                  />
                  <PartChoices
                    part="marks"
                    values={avatarCatalog.marks}
                    value={draft.parts.marks}
                    setValue={(id) => patchPart("marks", id)}
                  />
                </>
              )}
              {tab === "hair" && (
                <>
                  <h3>髪型</h3>
                  <PartChoices
                    part="hair"
                    values={avatarCatalog.hair}
                    value={draft.parts.hair}
                    setValue={(id) => patchPart("hair", id)}
                  />
                  <h3>髪の色</h3>
                  <div className="color-grid">
                    {colors.slice(5, 10).map((color) => (
                      <button
                        type="button"
                        key={color}
                        aria-label={`髪色 ${color}`}
                        aria-pressed={draft.colors.hair === color}
                        style={{ background: color }}
                        onClick={() =>
                          commit({ ...draft, colors: { ...draft.colors, hair: color } })
                        }
                      />
                    ))}
                  </div>
                </>
              )}
              {tab === "expression" && (
                <>
                  <h3>目</h3>
                  <PartChoices
                    part="eyes"
                    values={avatarCatalog.eyes}
                    value={draft.parts.eyes}
                    setValue={(id) => patchPart("eyes", id)}
                  />
                  <h3>虹彩</h3>
                  <PartChoices
                    part="iris"
                    values={avatarCatalog.iris}
                    value={draft.parts.iris}
                    setValue={(id) => patchPart("iris", id)}
                  />
                  <h3>眉</h3>
                  <PartChoices
                    part="brows"
                    values={avatarCatalog.brows}
                    value={draft.parts.brows}
                    setValue={(id) => patchPart("brows", id)}
                  />
                  <h3>口</h3>
                  <PartChoices
                    part="mouth"
                    values={avatarCatalog.mouth}
                    value={draft.parts.mouth}
                    setValue={(id) => patchPart("mouth", id)}
                  />
                  <h3>表情プリセット</h3>
                  <PartChoices
                    part="expression"
                    values={avatarCatalog.expression}
                    value={draft.parts.expression}
                    setValue={(id) => patchPart("expression", id)}
                  />
                </>
              )}
              {tab === "clothes" && (
                <>
                  <h3>トップス</h3>
                  <PartChoices
                    part="tops"
                    values={avatarCatalog.tops}
                    value={draft.parts.tops}
                    setValue={(id) => patchPart("tops", id)}
                  />
                  <h3>アウター</h3>
                  <PartChoices
                    part="outerwear"
                    values={avatarCatalog.outerwear}
                    value={draft.parts.outerwear}
                    setValue={(id) => patchPart("outerwear", id)}
                  />
                  <h3>ボトムス</h3>
                  <PartChoices
                    part="bottoms"
                    values={avatarCatalog.bottoms}
                    value={draft.parts.bottoms}
                    setValue={(id) => patchPart("bottoms", id)}
                  />
                  <h3>全身衣装</h3>
                  <PartChoices
                    part="fullOutfit"
                    values={avatarCatalog.fullOutfit}
                    value={draft.parts.fullOutfit}
                    setValue={(id) => patchPart("fullOutfit", id)}
                  />
                  <h3>色と素材</h3>
                  <div className="color-grid">
                    {colors.slice(8).map((color) => (
                      <button
                        type="button"
                        key={color}
                        aria-label={`服色 ${color}`}
                        aria-pressed={draft.colors.outfit === color}
                        style={{ background: color }}
                        onClick={() =>
                          commit({ ...draft, colors: { ...draft.colors, outfit: color } })
                        }
                      />
                    ))}
                  </div>
                  <select
                    aria-label="服の素材"
                    value={draft.materials.outfit}
                    onChange={(event) =>
                      commit({
                        ...draft,
                        materials: {
                          ...draft.materials,
                          outfit: event.target.value as AvatarProfileV1["materials"]["outfit"],
                        },
                      })
                    }
                  >
                    <option value="velvet">ベルベット</option>
                    <option value="satin">サテン</option>
                    <option value="wool">ウール</option>
                    <option value="silk">シルク</option>
                  </select>
                </>
              )}
              {tab === "decor" && (
                <>
                  <h3>眼鏡</h3>
                  <PartChoices
                    part="eyewear"
                    values={avatarCatalog.eyewear}
                    value={draft.parts.eyewear}
                    setValue={(id) => patchPart("eyewear", id)}
                  />
                  <h3>帽子・冠</h3>
                  <PartChoices
                    part="headwear"
                    values={avatarCatalog.headwear}
                    value={draft.parts.headwear}
                    setValue={(id) => patchPart("headwear", id)}
                  />
                  <h3>イヤリング</h3>
                  <PartChoices
                    part="earrings"
                    values={avatarCatalog.earrings}
                    value={draft.parts.earrings}
                    setValue={(id) => patchPart("earrings", id)}
                  />
                  <h3>ジュエリー</h3>
                  <PartChoices
                    part="jewelry"
                    values={avatarCatalog.jewelry}
                    value={draft.parts.jewelry}
                    setValue={(id) => patchPart("jewelry", id)}
                  />
                  <h3>手袋</h3>
                  <PartChoices
                    part="gloves"
                    values={avatarCatalog.gloves}
                    value={draft.parts.gloves}
                    setValue={(id) => patchPart("gloves", id)}
                  />
                </>
              )}
              {tab === "body" && (
                <>
                  <h3>体格プリセット</h3>
                  <div className="part-grid">
                    {avatarCatalog.bodyPresetId.map((id, index) => (
                      <button
                        type="button"
                        key={id}
                        className="part-choice"
                        aria-pressed={draft.bodyPresetId === id}
                        onClick={() => commit({ ...draft, bodyPresetId: id })}
                      >
                        <span className={`body-glyph body-${index % 4}`} />
                        {index + 1}
                      </button>
                    ))}
                  </div>
                  {(["height", "build", "faceWidth"] as const).map((key) => (
                    <label className="range-field" key={key}>
                      <span>{{ height: "身長", build: "体格", faceWidth: "顔幅" }[key]}</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={draft.morphs[key]}
                        onChange={(event) =>
                          commit({
                            ...draft,
                            morphs: { ...draft.morphs, [key]: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  ))}
                  <h3>靴</h3>
                  <PartChoices
                    part="shoes"
                    values={avatarCatalog.shoes}
                    value={draft.parts.shoes}
                    setValue={(id) => patchPart("shoes", id)}
                  />
                </>
              )}
              <section className="presets">
                <h3>プリセット</h3>
                <button type="button" onClick={persistPreset} disabled={presets.length >= 8}>
                  現在の姿を保存
                </button>
                {presets.map((preset) => (
                  <div key={preset.id}>
                    <button type="button" onClick={() => commit(structuredClone(preset.profile))}>
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`${preset.name}を複製`}
                      onClick={() => {
                        const next = [
                          ...presets,
                          { ...preset, id: crypto.randomUUID(), name: `${preset.name} コピー` },
                        ].slice(-8);
                        setPresetState(next);
                        savePresets(next);
                      }}
                    >
                      複製
                    </button>
                    <button
                      type="button"
                      aria-label={`${preset.name}を削除`}
                      onClick={() => deletePreset(preset.id)}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </section>
            </div>
          </section>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <div>
            <button type="button" onClick={undo} disabled={!history.length}>
              元に戻す
            </button>
            <button type="button" onClick={redo} disabled={!future.length}>
              やり直す
            </button>
          </div>
          <div>
            <button type="button" onClick={onCancel}>
              キャンセル
            </button>
            <button type="button" className="primary" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存する"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
