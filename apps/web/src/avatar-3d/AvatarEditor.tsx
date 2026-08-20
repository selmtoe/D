import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  avatarBodyMetrics,
  avatarCatalog,
  avatarColorPalettes,
  bodyPresetIdFor,
  randomAvatar,
  type AvatarPartKey,
  type AvatarProfileV1,
} from "@daifugo/avatar-schema";
import { Avatar3D } from "./Avatar3D";
import { FacePaintEditor } from "./FacePaintEditor";
import { animationNames, proceduralPartStyle } from "./proceduralAvatar";
import { loadPresets, savePresets } from "./avatarStorage";
import { firebaseErrorMessage, sendCommand } from "../network/firebaseClient";

type Tab = "face" | "paint" | "hair" | "expression" | "clothes" | "decor" | "body";
const tabs: { id: Tab; label: string }[] = [
  { id: "face", label: "顔" },
  { id: "paint", label: "ペイント" },
  { id: "hair", label: "髪" },
  { id: "expression", label: "表情" },
  { id: "clothes", label: "服" },
  { id: "decor", label: "装飾" },
  { id: "body", label: "体格" },
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
      {values.map((id, index) => {
        const preview = proceduralPartStyle(part, id);
        const previewStyle = {
          "--preview-scale-x": String(0.68 + preview.signature * 0.62),
          "--preview-scale-y": String(0.72 + preview.wave * 0.5),
          "--preview-rotate": `${(preview.sweep - 0.5) * 34}deg`,
          "--preview-hue": `${Math.round(preview.signature * 85)}deg`,
        } as CSSProperties;
        return (
          <button
            key={id}
            type="button"
            role="option"
            aria-label={`${part} ${id === "none" ? "なし" : index + 1}`}
            aria-selected={value === id}
            className="part-choice"
            onClick={() => setValue(id)}
          >
            <span
              className={`part-glyph part-preview preview-family-${preview.family}${id === "none" ? " preview-none" : ""}`}
              style={previewStyle}
              aria-hidden="true"
            >
              <i />
            </span>
            <span>{id === "none" ? "なし" : index + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

function ColorChoices({
  label,
  colors,
  value,
  setValue,
}: {
  label: string;
  colors: readonly string[];
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div className="color-picker-group">
      <div className="color-grid" role="listbox" aria-label={`${label}プリセット`}>
        {colors.map((color, index) => (
          <button
            type="button"
            role="option"
            key={`${label}-${color}-${index}`}
            aria-label={`${label} ${index + 1}`}
            aria-selected={value.toLowerCase() === color.toLowerCase()}
            aria-pressed={value.toLowerCase() === color.toLowerCase()}
            style={{ background: color }}
            onClick={() => setValue(color)}
          />
        ))}
      </div>
      <label className="custom-color">
        <span>{label}を細かく選ぶ</span>
        <input
          type="color"
          value={value}
          aria-label={`${label}のカスタム色`}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
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
  const pointerX = useRef<number | null>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const bodyMetrics = avatarBodyMetrics(draft);

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
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button,input")) return;
              pointerX.current = event.clientX;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (pointerX.current === null) return;
              const delta = event.clientX - pointerX.current;
              pointerX.current = event.clientX;
              setRotation((angle) => angle + delta * 0.012);
            }}
            onPointerUp={(event) => {
              pointerX.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              pointerX.current = null;
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
              <button type="button" onClick={() => setRotation((angle) => angle - Math.PI / 4)}>
                左へ回す
              </button>
              <button
                type="button"
                onClick={() => {
                  setRotation(0);
                  setZoom(1);
                }}
              >
                正面へ戻す
              </button>
              <button type="button" onClick={() => setRotation((angle) => angle + Math.PI / 4)}>
                右へ回す
              </button>
              <button
                type="button"
                aria-label="プレビューを縮小"
                onClick={() => setZoom((current) => Math.max(0.75, current - 0.1))}
              >
                −
              </button>
              <button
                type="button"
                aria-label="プレビューを拡大"
                onClick={() => setZoom((current) => Math.min(1.35, current + 0.1))}
              >
                ＋
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
            <output className="body-readout" aria-live="polite">
              身長 {Math.round(draft.morphs.height * 100)}・肩幅{" "}
              {Math.round(draft.morphs.build * 100)}・ 胴脚 {bodyMetrics.torsoLegStep + 1}/4
            </output>
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
                    {avatarCatalog.headPresetId.map((id, index) => {
                      const preview = proceduralPartStyle("headPresetId", id);
                      return (
                        <button
                          type="button"
                          key={id}
                          className="part-choice"
                          aria-label={`頭部形状 ${index + 1}`}
                          aria-pressed={draft.headPresetId === id}
                          onClick={() => commit({ ...draft, headPresetId: id })}
                        >
                          <span
                            className={`head-glyph preview-family-${preview.family}`}
                            style={{
                              transform: `scale(${0.72 + preview.signature * 0.56}, ${0.76 + preview.wave * 0.44}) rotate(${(preview.sweep - 0.5) * 16}deg)`,
                            }}
                            aria-hidden="true"
                          />
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                  <h3>肌トーン</h3>
                  <PartChoices
                    part="skinTone"
                    values={avatarCatalog.skinTone}
                    value={draft.parts.skinTone}
                    setValue={(id) => patchPart("skinTone", id)}
                  />
                  <ColorChoices
                    label="肌色"
                    colors={avatarColorPalettes.skin}
                    value={draft.colors.skin}
                    setValue={(color) => {
                      const toneIndex = (avatarColorPalettes.skin as readonly string[]).indexOf(
                        color,
                      );
                      commit({
                        ...draft,
                        parts: {
                          ...draft.parts,
                          ...(toneIndex >= 0 ? { skinTone: `skin-${toneIndex + 1}` } : {}),
                        },
                        colors: { ...draft.colors, skin: color },
                      });
                    }}
                  />
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
                  <ColorChoices
                    label="髪色"
                    colors={avatarColorPalettes.hair}
                    value={draft.colors.hair}
                    setValue={(color) =>
                      commit({ ...draft, colors: { ...draft.colors, hair: color } })
                    }
                  />
                </>
              )}
              {tab === "paint" && (
                <FacePaintEditor
                  layer={draft.facePaint}
                  skinColor={draft.colors.skin}
                  onChange={(facePaint) => {
                    const next = structuredClone(draft);
                    if (facePaint) next.facePaint = facePaint;
                    else delete next.facePaint;
                    commit(next);
                  }}
                />
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
                  <h3>瞳の色</h3>
                  <ColorChoices
                    label="瞳色"
                    colors={avatarColorPalettes.eyes}
                    value={draft.colors.eyes}
                    setValue={(color) =>
                      commit({ ...draft, colors: { ...draft.colors, eyes: color } })
                    }
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
                  <h3>待機アニメーション</h3>
                  <select
                    aria-label="待機アニメーション"
                    value={draft.animationSetId}
                    onChange={(event) => commit({ ...draft, animationSetId: event.target.value })}
                  >
                    {avatarCatalog.animationSetId.map((id, index) => (
                      <option key={id} value={id}>
                        {index + 1}. {animationNames[index]}
                      </option>
                    ))}
                  </select>
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
                  <ColorChoices
                    label="服色"
                    colors={avatarColorPalettes.outfit}
                    value={draft.colors.outfit}
                    setValue={(color) =>
                      commit({ ...draft, colors: { ...draft.colors, outfit: color } })
                    }
                  />
                  <ColorChoices
                    label="装飾色"
                    colors={avatarColorPalettes.accent}
                    value={draft.colors.accent}
                    setValue={(color) =>
                      commit({ ...draft, colors: { ...draft.colors, accent: color } })
                    }
                  />
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
                  <h3>眼鏡・サングラス・バイザー</h3>
                  <PartChoices
                    part="eyewear"
                    values={avatarCatalog.eyewear}
                    value={draft.parts.eyewear}
                    setValue={(id) => patchPart("eyewear", id)}
                  />
                  <h3>帽子・冠・ヘッドドレス</h3>
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
                    {avatarCatalog.bodyPresetId.map((id, index) => {
                      const metrics = avatarBodyMetrics({ ...draft, bodyPresetId: id });
                      return (
                        <button
                          type="button"
                          key={id}
                          className="part-choice"
                          aria-label={`体格 ${index + 1}、骨格 ${metrics.frame + 1}、胴脚 ${metrics.torsoLegStep + 1}`}
                          aria-pressed={draft.bodyPresetId === id}
                          onClick={() => commit({ ...draft, bodyPresetId: id })}
                        >
                          <span
                            className="body-glyph body-preview"
                            style={{
                              transform: `scale(${metrics.shoulderWidth}, ${metrics.torsoLength})`,
                            }}
                            aria-hidden="true"
                          />
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                  <h3>骨格</h3>
                  <div className="segmented-control" role="group" aria-label="骨格">
                    {["すっきり", "標準", "しっかり"].map((label, frame) => (
                      <button
                        type="button"
                        key={label}
                        aria-pressed={bodyMetrics.frame === frame}
                        onClick={() =>
                          commit({
                            ...draft,
                            bodyPresetId: bodyPresetIdFor(frame, bodyMetrics.torsoLegStep),
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(["height", "build", "faceWidth"] as const).map((key) => (
                    <label className="range-field" key={key}>
                      <span>{{ height: "身長", build: "肩幅", faceWidth: "顔幅" }[key]}</span>
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
                      <output>{Math.round(draft.morphs[key] * 100)}</output>
                    </label>
                  ))}
                  <label className="range-field">
                    <span>胴と脚</span>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="1"
                      value={bodyMetrics.torsoLegStep}
                      aria-valuetext={`胴脚バランス ${bodyMetrics.torsoLegStep + 1}/4`}
                      onChange={(event) =>
                        commit({
                          ...draft,
                          bodyPresetId: bodyPresetIdFor(
                            bodyMetrics.frame,
                            Number(event.target.value),
                          ),
                        })
                      }
                    />
                    <output>{bodyMetrics.torsoLegStep + 1}/4</output>
                  </label>
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
