(function () {
  "use strict";

  const STORAGE_KEY = "daifugo-avatar-v2";
  const defaults = {
    name: "",
    skin: "#e3ad82",
    face: "oval",
    hair: "side",
    hairColor: "#2d211d",
    eyes: "soft",
    eyeColor: "#2b2624",
    brows: "natural",
    nose: "soft",
    mouth: "smile",
    marks: "none",
    accessory: "none",
    outfit: "jacket",
    outfitColor: "#243d63",
    background: "midnight",
    strokes: [],
  };

  const choices = {
    skin: [
      ["#f6d7bd", "磁器"], ["#edc39f", "砂糖"], ["#e3ad82", "蜂蜜"], ["#c8875f", "琥珀"],
      ["#a96948", "栗"], ["#805139", "胡桃"], ["#5b3a2d", "珈琲"], ["#dca07c", "薔薇"],
    ],
    face: [["round", "まる"], ["oval", "たまご"], ["square", "四角"], ["heart", "ハート"], ["slim", "ほっそり"]],
    hair: [
      ["round", "マッシュ"], ["side", "サイド"], ["spike", "スパイク"], ["bob", "ボブ"], ["long", "ロング"],
      ["pony", "ポニー"], ["bun", "おだんご"], ["wave", "ウェーブ"], ["undercut", "ツーブロック"], ["fringe", "前髪"],
      ["twin", "ツイン"], ["afro", "アフロ"], ["cap", "キャップ"], ["bald", "なし"],
    ],
    hairColor: [
      ["#171416", "墨"], ["#2d211d", "黒茶"], ["#67402b", "栗"], ["#aa6c3d", "蜂蜜"], ["#d4a766", "金"],
      ["#9b3d50", "葡萄"], ["#36537a", "藍"], ["#567166", "苔"], ["#d6d0c5", "銀"], ["#f0b5c2", "桜"],
    ],
    eyes: [
      ["soft", "やさしい"], ["bright", "ぱっちり"], ["cool", "クール"], ["wink", "ウインク"], ["sleepy", "ねむい"],
      ["happy", "にっこり"], ["sharp", "きりり"], ["round", "まんまる"], ["star", "きらきら"], ["line", "ほそめ"],
    ],
    eyeColor: [["#2b2624", "黒"], ["#684630", "茶"], ["#3c6b75", "青"], ["#4e6a4e", "緑"], ["#7a4e78", "紫"]],
    brows: [["natural", "自然"], ["straight", "まっすぐ"], ["arch", "アーチ"], ["bold", "太め"], ["fine", "細め"], ["sad", "困り"], ["angry", "きりり"], ["none", "なし"]],
    nose: [["soft", "ちいさめ"], ["button", "ボタン"], ["line", "すっきり"], ["round", "まる"], ["sharp", "高め"], ["none", "なし"]],
    mouth: [
      ["smile", "にっこり"], ["open", "わくわく"], ["calm", "まじめ"], ["cat", "ねこ"], ["grin", "にやり"],
      ["o", "びっくり"], ["kiss", "おすまし"], ["teeth", "歯みせ"], ["tongue", "ぺろり"], ["sad", "しょんぼり"],
    ],
    marks: [["none", "なし"], ["freckles", "そばかす"], ["blush", "ほっぺ"], ["beauty", "ほくろ"], ["scar", "きず"], ["star", "星"], ["paint", "ペイント"], ["whiskers", "ひげ"]],
    accessory: [
      ["none", "なし"], ["glasses", "スクエア"], ["roundGlasses", "丸メガネ"], ["sunglasses", "サングラス"], ["monocle", "モノクル"],
      ["earrings", "ピアス"], ["starPin", "星ピン"], ["flower", "花"], ["headband", "バンド"], ["crown", "クラウン"],
      ["ribbon", "リボン"], ["mask", "マスク"], ["headphones", "ヘッドホン"], ["eyepatch", "眼帯"],
    ],
    outfit: [["jacket", "ジャケット"], ["tuxedo", "タキシード"], ["hoodie", "フーディ"], ["kimono", "着物"], ["sailor", "セーラー"], ["turtle", "タートル"], ["dress", "ドレス"], ["vest", "ベスト"], ["uniform", "制服"], ["tee", "Tシャツ"]],
    outfitColor: [["#243d63", "夜空"], ["#193f37", "深緑"], ["#6e2735", "葡萄酒"], ["#17191f", "黒"], ["#e7e2d7", "生成"], ["#b3843f", "金茶"], ["#5d416d", "紫"], ["#426a7f", "青"], ["#8e5845", "煉瓦"], ["#c98291", "桜"]],
    background: [["midnight", "夜会"], ["emerald", "翡翠"], ["wine", "葡萄酒"], ["royal", "群青"], ["ivory", "象牙"], ["sunset", "夕映え"], ["sakura", "桜"], ["mono", "銀幕"]],
  };

  let profile = loadProfile();
  let draft = clone(profile);
  let overlay;
  let drawingCanvas;
  let drawingContext;
  let activeStroke = null;
  let activeTab = "face";
  let previouslyFocusedElement = null;
  let previousBodyOverflow = "";

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function loadProfile() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return clone(defaults); }
  }
  function safeChoice(key, value) {
    const valid = choices[key]?.some(([candidate]) => candidate === value);
    return valid ? value : defaults[key];
  }
  function safeColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback; }
  function esc(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

  function backgroundSvg(kind) {
    const colors = {
      midnight: ["#1e3154", "#080c18"], emerald: ["#2b6c5b", "#102722"], wine: ["#7a3442", "#241018"], royal: ["#4167a3", "#111d3a"],
      ivory: ["#f1dfbd", "#9f7d5c"], sunset: ["#de8a64", "#67425c"], sakura: ["#e8a7b8", "#72455d"], mono: ["#a5adba", "#333944"],
    }[kind] || ["#1e3154", "#080c18"];
    return `<defs><radialGradient id="avatar-bg" cx="36%" cy="24%"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></radialGradient><linearGradient id="avatar-shirt" x2="0" y2="1"><stop stop-color="rgba(255,255,255,.22)"/><stop offset="1" stop-color="rgba(0,0,0,.2)"/></linearGradient></defs><circle cx="256" cy="256" r="252" fill="url(#avatar-bg)"/><circle cx="256" cy="256" r="239" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="3"/>`;
  }

  function faceShape(kind, skin) {
    const shapes = {
      round: `<ellipse cx="256" cy="247" rx="130" ry="142" fill="${skin}"/>`,
      oval: `<path d="M138 218c0-94 49-145 118-145s118 51 118 145c0 101-48 167-118 167s-118-66-118-167Z" fill="${skin}"/>`,
      square: `<path d="M137 190q0-108 119-108t119 108v105q0 90-119 104-119-14-119-104Z" fill="${skin}"/>`,
      heart: `<path d="M131 198q0-122 125-122t125 122q0 120-125 198-125-78-125-198Z" fill="${skin}"/>`,
      slim: `<path d="M150 187q0-105 106-105t106 105q0 121-106 210-106-89-106-210Z" fill="${skin}"/>`,
    };
    return shapes[kind] || shapes.oval;
  }

  function hairSvg(kind, color) {
    const pieces = {
      round: `<path d="M128 209Q116 75 255 57q141 18 128 158-54-84-128-60-66 21-127 54Z" fill="${color}"/>`,
      side: `<path d="M128 216Q113 75 254 58q137 13 130 157-62-71-160-53-45 8-96 54Z" fill="${color}"/><path d="M139 153Q228 145 298 61 183 42 139 153Z" fill="${color}"/>`,
      spike: `<path d="m130 209-25-101 53 26 8-70 48 46 39-72 34 69 70-50-15 77 65-21-29 103q-122-95-248-7Z" fill="${color}"/>`,
      bob: `<path d="M108 302Q77 79 250 54q184 18 151 255l-65-13q25-155-81-155T172 301Z" fill="${color}"/>`,
      long: `<path d="M105 378Q66 81 253 51q191 25 153 331l-80-9q38-222-71-230-108 6-75 230Z" fill="${color}"/>`,
      pony: `<path d="M131 212Q115 76 255 57q133 17 127 153-60-70-138-55-69 12-113 57Z" fill="${color}"/><path d="M357 117q94 25 53 188-17-92-90-102Z" fill="${color}"/>`,
      bun: `<circle cx="256" cy="55" r="57" fill="${color}"/><path d="M128 209Q116 75 255 70q141 8 128 145-54-84-128-60-66 21-127 54Z" fill="${color}"/>`,
      wave: `<path d="M105 330Q62 132 143 77q49-34 111-20 93-23 144 64 35 61 2 212-21-50-62-64 34-107-27-124-40 41-87 10-61 16-38 116-48 17-81 59Z" fill="${color}"/>`,
      undercut: `<path d="M141 161Q163 55 282 59q93 3 102 92-97-37-243 10Z" fill="${color}"/><path d="M317 83q-53 82-168 101 37-107 168-101Z" fill="${color}"/>`,
      fringe: `<path d="M125 218Q105 76 254 56q148 19 130 164-35-73-82-79l-31 75-31-67-43 67-15-66q-32 17-57 68Z" fill="${color}"/>`,
      twin: `<path d="M126 214Q111 77 254 57q143 17 130 157-62-79-129-57-72-23-129 57Z" fill="${color}"/><ellipse cx="112" cy="225" rx="58" ry="100" fill="${color}"/><ellipse cx="399" cy="225" rx="58" ry="100" fill="${color}"/>`,
      afro: `<g fill="${color}"><circle cx="155" cy="129" r="67"/><circle cx="232" cy="90" r="74"/><circle cx="315" cy="96" r="72"/><circle cx="374" cy="156" r="65"/><circle cx="128" cy="202" r="54"/></g>`,
      cap: `<path d="M133 160Q163 50 282 63q103 12 109 102Z" fill="${color}"/><path d="M245 153q107-18 176 33-100 19-176-33Z" fill="#c7a15b"/>`,
      bald: "",
    };
    return pieces[kind] || pieces.side;
  }

  function eyesSvg(kind, color) {
    const c = safeColor(color, "#2b2624");
    const pieces = {
      soft: `<path d="M176 241q25-22 50 0M286 241q25-22 50 0" fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round"/>`,
      bright: `<g fill="${c}"><ellipse cx="201" cy="238" rx="16" ry="22"/><ellipse cx="311" cy="238" rx="16" ry="22"/></g><g fill="#fff"><circle cx="195" cy="231" r="5"/><circle cx="305" cy="231" r="5"/></g>`,
      cool: `<path d="m176 234 52 8m56 0 52-8" stroke="${c}" stroke-width="12" stroke-linecap="round"/>`,
      wink: `<path d="M176 241q25-22 50 0" fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round"/><ellipse cx="311" cy="238" rx="16" ry="22" fill="${c}"/>`,
      sleepy: `<path d="M176 245q25 15 50 0m58 0q25 15 50 0" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`,
      happy: `<path d="M175 247q26-34 52 0m57 0q26-34 52 0" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`,
      sharp: `<path d="m174 235 54-12m56 0 54 12" stroke="${c}" stroke-width="11" stroke-linecap="round"/><circle cx="211" cy="235" r="9" fill="${c}"/><circle cx="301" cy="235" r="9" fill="${c}"/>`,
      round: `<circle cx="201" cy="239" r="22" fill="#fff"/><circle cx="311" cy="239" r="22" fill="#fff"/><circle cx="201" cy="239" r="14" fill="${c}"/><circle cx="311" cy="239" r="14" fill="${c}"/>`,
      star: `<path d="m201 214 7 16 18 2-14 12 4 18-15-9-16 9 4-18-14-12 19-2Z" fill="${c}"/><path d="m311 214 7 16 18 2-14 12 4 18-15-9-16 9 4-18-14-12 19-2Z" fill="${c}"/>`,
      line: `<path d="M177 240h48m62 0h48" stroke="${c}" stroke-width="9" stroke-linecap="round"/>`,
    };
    return pieces[kind] || pieces.soft;
  }

  function browsSvg(kind, color) {
    if (kind === "none") return "";
    const style = {
      natural: ["M174 201q26-18 53-3", "M285 198q27-15 53 3", 8],
      straight: ["M174 202h54", "M284 202h54", 8], arch: ["M174 205q25-35 54 0", "M284 205q29-35 54 0", 8],
      bold: ["M171 202q28-22 58-2", "M283 200q30-20 58 2", 14], fine: ["M176 202q25-13 50 0", "M286 202q25-13 50 0", 4],
      sad: ["M175 198q28 8 51 1", "M286 199q23 7 51-1", 8], angry: ["m174 194 54 17", "m284 211 54-17", 10],
    }[kind] || ["M174 201q26-18 53-3", "M285 198q27-15 53 3", 8];
    return `<path d="${style[0]}" fill="none" stroke="${color}" stroke-width="${style[2]}" stroke-linecap="round"/><path d="${style[1]}" fill="none" stroke="${color}" stroke-width="${style[2]}" stroke-linecap="round"/>`;
  }

  function noseSvg(kind) {
    const pieces = {
      soft: '<path d="M256 250v34q0 10 13 7" fill="none" stroke="rgba(96,54,39,.38)" stroke-width="7" stroke-linecap="round"/>',
      button: '<path d="M244 286q12 12 24 0" fill="none" stroke="rgba(96,54,39,.42)" stroke-width="8" stroke-linecap="round"/>',
      line: '<path d="m260 249-8 43 19 1" fill="none" stroke="rgba(96,54,39,.38)" stroke-width="6" stroke-linecap="round"/>',
      round: '<ellipse cx="256" cy="287" rx="14" ry="10" fill="rgba(128,68,46,.18)"/>',
      sharp: '<path d="m260 248-15 46 28-2" fill="none" stroke="rgba(96,54,39,.42)" stroke-width="6" stroke-linecap="round"/>', none: "",
    };
    return pieces[kind] || pieces.soft;
  }

  function mouthSvg(kind) {
    const pieces = {
      smile: '<path d="M218 319q38 36 76 0" fill="none" stroke="#9b504b" stroke-width="11" stroke-linecap="round"/>',
      open: '<ellipse cx="256" cy="326" rx="39" ry="29" fill="#8d4148"/><path d="M226 334q30 17 60 0" stroke="#e98991" stroke-width="9"/>',
      calm: '<path d="M225 325h62" stroke="#96504b" stroke-width="9" stroke-linecap="round"/>',
      cat: '<path d="M210 320q23 28 46 0 23 28 46 0" fill="none" stroke="#96504b" stroke-width="9" stroke-linecap="round"/>',
      grin: '<path d="M215 316q41 45 82 0-42 21-82 0Z" fill="#8d4148"/>', o: '<ellipse cx="256" cy="326" rx="19" ry="26" fill="#8d4148"/>',
      kiss: '<path d="M238 324q18-15 36 0-18 15-36 0Z" fill="#a94e59"/>', teeth: '<path d="M215 316q41 48 82 0Z" fill="#8d4148"/><path d="M224 320h64q-31 20-64 0Z" fill="#fff"/>',
      tongue: '<path d="M216 316q40 50 80 0Z" fill="#8d4148"/><ellipse cx="256" cy="339" rx="22" ry="12" fill="#ed8291"/>',
      sad: '<path d="M222 337q34-27 68 0" fill="none" stroke="#96504b" stroke-width="9" stroke-linecap="round"/>',
    };
    return pieces[kind] || pieces.smile;
  }

  function marksSvg(kind) {
    const pieces = {
      none: "", freckles: '<g fill="rgba(117,67,45,.45)"><circle cx="190" cy="286" r="4"/><circle cx="206" cy="291" r="3"/><circle cx="322" cy="286" r="4"/><circle cx="306" cy="291" r="3"/></g>',
      blush: '<g fill="#e78983" opacity=".35"><ellipse cx="185" cy="290" rx="32" ry="16"/><ellipse cx="327" cy="290" rx="32" ry="16"/></g>', beauty: '<circle cx="316" cy="292" r="5" fill="#4d3329"/>',
      scar: '<path d="m319 206-24 65m10-44 18 7" stroke="rgba(117,55,48,.55)" stroke-width="5"/>', star: '<path d="m176 277 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2Z" fill="#d19b42"/>',
      paint: '<path d="m157 266 55-19-21 61-20-12Z" fill="#6c8fb7" opacity=".7"/>', whiskers: '<path d="m162 297-41-8m43 25-42 8m226-25 41-8m-43 25 42 8" stroke="rgba(73,48,39,.55)" stroke-width="5" stroke-linecap="round"/>',
    };
    return pieces[kind] || "";
  }

  function accessorySvg(kind) {
    const pieces = {
      none: "", glasses: '<g fill="none" stroke="#252b38" stroke-width="9"><rect x="161" y="215" width="85" height="58" rx="16"/><rect x="266" y="215" width="85" height="58" rx="16"/><path d="M246 233h20M161 231l-29-9M351 231l29-9"/></g>',
      roundGlasses: '<g fill="none" stroke="#4b352b" stroke-width="9"><circle cx="204" cy="241" r="40"/><circle cx="308" cy="241" r="40"/><path d="M244 236h24"/></g>',
      sunglasses: '<g fill="#171b25" stroke="#c7a15b" stroke-width="7"><path d="m157 216 91 6-13 57h-57Z"/><path d="m264 222 91-6-21 63h-57Z"/></g><path d="M246 233h20" stroke="#c7a15b" stroke-width="8"/>',
      monocle: '<circle cx="309" cy="241" r="43" fill="none" stroke="#c7a15b" stroke-width="8"/><path d="M343 267q19 45 2 86" fill="none" stroke="#c7a15b" stroke-width="5"/>',
      earrings: '<g fill="#e3b85f"><circle cx="131" cy="287" r="10"/><circle cx="381" cy="287" r="10"/><path d="m131 297-9 25 9 12 9-12Zm250 0-9 25 9 12 9-12Z"/></g>',
      starPin: '<path d="m365 134 10 20 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3Z" fill="#ffd66f" stroke="#a9782d" stroke-width="5"/>',
      flower: '<g transform="translate(365 142)" fill="#e9a2ae"><circle cx="0" cy="-17" r="15"/><circle cx="17" cy="0" r="15"/><circle cx="0" cy="17" r="15"/><circle cx="-17" cy="0" r="15"/><circle r="10" fill="#f2cf71"/></g>',
      headband: '<path d="M134 155q122-90 245 0" fill="none" stroke="#d2a64d" stroke-width="17"/>', crown: '<path d="m185 90 19-62 52 45 52-45 19 62Z" fill="#dfb653" stroke="#8e6828" stroke-width="7"/><circle cx="256" cy="67" r="8" fill="#a73d52"/>',
      ribbon: '<path d="M350 124q35-48 65-10l-34 35 35 35q-36 35-66-16-30 51-66 16l35-35-34-35q30-38 65 10Z" fill="#a9425a"/>',
      mask: '<path d="M166 215q90 42 180 0l-14 74q-76 44-152 0Z" fill="#182238" opacity=".92"/><path d="m181 236 56 3m38 0 56-3" stroke="#d0ae68" stroke-width="8"/>',
      headphones: '<path d="M116 238q-2-155 140-166 143 11 140 166" fill="none" stroke="#232a39" stroke-width="25"/><rect x="102" y="227" width="46" height="89" rx="20" fill="#c7a15b"/><rect x="364" y="227" width="46" height="89" rx="20" fill="#c7a15b"/>',
      eyepatch: '<path d="M167 225q43-31 83 2l-13 54q-44 23-73-13Z" fill="#23232a"/><path d="m133 203 238 19" stroke="#23232a" stroke-width="8"/>',
    };
    return pieces[kind] || "";
  }

  function outfitSvg(kind, color) {
    const base = `<path d="M74 512q15-128 182-137 168 9 182 137" fill="${color}"/>`;
    const detail = {
      jacket: '<path d="m181 390 75 122 75-122-75 37Z" fill="rgba(10,15,25,.45)"/><path d="m256 426-17 36 17 35 17-35Z" fill="#b48b4d"/>',
      tuxedo: '<path d="m172 390 84 122 84-122-84 46Z" fill="#f4efe5"/><path d="m219 421 37 24 37-24-10 43-27-18-27 18Z" fill="#17191f"/>',
      hoodie: '<path d="M155 414q101-79 202 0l-28 48-73-35-73 35Z" fill="rgba(255,255,255,.15)"/><path d="M220 441v58m72-58v58" stroke="#e8dfcc" stroke-width="7"/>',
      kimono: '<path d="m170 390 86 122 86-122-86 58Z" fill="rgba(255,255,255,.2)"/><path d="M119 473h274" stroke="#d4a94c" stroke-width="28"/>',
      sailor: '<path d="m153 394 103 93 103-93-25 85-78 33-78-33Z" fill="#f0eadc"/><path d="M256 451v61" stroke="#b44754" stroke-width="18"/>',
      turtle: '<path d="M202 375h108v88H202Z" fill="${color}"/><path d="M202 416h108" stroke="rgba(255,255,255,.18)" stroke-width="5"/>',
      dress: '<path d="m173 389 83 75 83-75 64 123H109Z" fill="rgba(255,255,255,.13)"/><path d="M219 411q37 32 74 0" fill="none" stroke="#d4b160" stroke-width="9"/>',
      vest: '<path d="m177 393 79 54 79-54 22 119H155Z" fill="rgba(10,15,25,.43)"/><circle cx="256" cy="463" r="6" fill="#d4b160"/><circle cx="256" cy="489" r="6" fill="#d4b160"/>',
      uniform: '<path d="M159 398h194v114H159Z" fill="rgba(10,15,25,.25)"/><path d="M159 431h194M256 398v114" stroke="#d4b160" stroke-width="7"/><path d="m221 404 35 29 35-29" fill="none" stroke="#eee6d8" stroke-width="12"/>',
      tee: '<path d="M175 389h162l31 68-43 18-18-43v80H205v-80l-18 43-43-18Z" fill="rgba(255,255,255,.12)"/>',
    }[kind] || "";
    return base + detail;
  }

  function pointCoordinates(point) {
    if (Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) return [point[0], point[1]];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return [point.x, point.y];
    return null;
  }

  function strokesSvg(strokes) {
    return (Array.isArray(strokes) ? strokes : []).slice(0, 80).map((stroke) => {
      const points = (stroke.points || []).slice(0, 500).map(pointCoordinates).filter(Boolean);
      if (!points.length) return "";
      const path = points.map(([x, y], index) => `${index ? "L" : "M"}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join(" ");
      return `<path d="${path}" fill="none" stroke="${safeColor(stroke.color, "#ffffff")}" stroke-width="${Math.max(1, Math.min(40, Number(stroke.size) || 6))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join("");
  }

  function renderSvg(input = profile) {
    const config = { ...defaults, ...(input || {}) };
    const skin = safeColor(config.skin, defaults.skin);
    const hairColor = safeColor(config.hairColor, defaults.hairColor);
    const outfitColor = safeColor(config.outfitColor, defaults.outfitColor);
    return `<svg viewBox="0 0 512 512" role="img" aria-label="アバター" xmlns="http://www.w3.org/2000/svg">
      ${backgroundSvg(safeChoice("background", config.background))}
      ${outfitSvg(safeChoice("outfit", config.outfit), outfitColor)}
      <ellipse cx="139" cy="252" rx="25" ry="43" fill="${skin}"/><ellipse cx="373" cy="252" rx="25" ry="43" fill="${skin}"/>
      ${faceShape(safeChoice("face", config.face), skin)}
      ${hairSvg(safeChoice("hair", config.hair), hairColor)}
      ${browsSvg(safeChoice("brows", config.brows), hairColor)}
      ${eyesSvg(safeChoice("eyes", config.eyes), safeColor(config.eyeColor, defaults.eyeColor))}
      ${noseSvg(safeChoice("nose", config.nose))}${mouthSvg(safeChoice("mouth", config.mouth))}${marksSvg(safeChoice("marks", config.marks))}
      ${accessorySvg(safeChoice("accessory", config.accessory))}${strokesSvg(config.strokes)}
    </svg>`;
  }

  function toNetworkProfile(input = profile) {
    const config = { ...defaults, ...(input || {}) };
    const networkStrokes = (Array.isArray(config.strokes) ? config.strokes : []).slice(0, 24).map((stroke) => {
      const validPoints = (stroke.points || []).map(pointCoordinates).filter(Boolean);
      const step = Math.max(1, Math.ceil(validPoints.length / 120));
      const sampledPoints = validPoints.filter((_, index) => index % step === 0).slice(0, 120);
      const lastPoint = validPoints.at(-1);
      if (lastPoint && sampledPoints.length && sampledPoints.at(-1) !== lastPoint && sampledPoints.length < 120) sampledPoints.push(lastPoint);
      return {
        color: safeColor(stroke.color, "#ffffff"),
        size: Math.max(1, Math.min(40, Number(stroke.size) || 7)),
        points: sampledPoints.map(([x, y]) => ({ x: Math.round(Math.max(0, Math.min(512, x)) * 10) / 10, y: Math.round(Math.max(0, Math.min(512, y)) * 10) / 10 })),
      };
    }).filter((stroke) => stroke.points.length);
    return {
      name: String(config.name || "").slice(0, 12),
      skin: safeColor(config.skin, defaults.skin),
      face: safeChoice("face", config.face),
      hair: safeChoice("hair", config.hair),
      hairColor: safeColor(config.hairColor, defaults.hairColor),
      eyes: safeChoice("eyes", config.eyes),
      eyeColor: safeColor(config.eyeColor, defaults.eyeColor),
      brows: safeChoice("brows", config.brows),
      nose: safeChoice("nose", config.nose),
      mouth: safeChoice("mouth", config.mouth),
      marks: safeChoice("marks", config.marks),
      accessory: safeChoice("accessory", config.accessory),
      outfit: safeChoice("outfit", config.outfit),
      outfitColor: safeColor(config.outfitColor, defaults.outfitColor),
      background: safeChoice("background", config.background),
      strokes: networkStrokes,
    };
  }

  const groups = {
    face: [["face", "顔のかたち"], ["skin", "肌の色"], ["marks", "フェイスパーツ"]],
    hair: [["hair", "髪型"], ["hairColor", "髪の色"]],
    expression: [["eyes", "目"], ["eyeColor", "瞳の色"], ["brows", "眉"], ["nose", "鼻"], ["mouth", "口"]],
    style: [["accessory", "アクセサリー"], ["outfit", "服"], ["outfitColor", "服の色"], ["background", "背景"]],
  };

  function createStudio() {
    overlay = document.createElement("div");
    overlay.id = "avatar-studio-overlay";
    overlay.className = "avatar-studio-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="avatar-studio-panel" role="dialog" aria-modal="true" aria-labelledby="avatar-studio-title">
        <header class="avatar-studio-head"><div><small>PRIVATE PORTRAIT ATELIER</small><h2 id="avatar-studio-title">アバターを仕立てる</h2></div><button type="button" class="avatar-studio-close" aria-label="閉じる">×</button></header>
        <div class="avatar-studio-body">
          <aside class="avatar-preview-column">
            <div class="avatar-large-preview"><div id="avatar-studio-svg"></div><canvas id="avatar-drawing-canvas" width="512" height="512"></canvas></div>
            <label class="avatar-name-field"><span>DISPLAY NAME</span><input id="avatar-profile-name" maxlength="12" autocomplete="nickname" placeholder="なまえ"></label>
            <p class="avatar-combination-count">100億通り以上の組み合わせ + 自由描画</p>
          </aside>
          <div class="avatar-editor-column">
            <nav class="avatar-tabs" role="tablist" aria-label="アバターの編集項目">
              <button type="button" role="tab" data-avatar-tab="face">顔</button><button type="button" role="tab" data-avatar-tab="hair">髪</button><button type="button" role="tab" data-avatar-tab="expression">表情</button><button type="button" role="tab" data-avatar-tab="style">装い</button><button type="button" role="tab" data-avatar-tab="draw">自由に描く</button>
            </nav>
            <div id="avatar-parts-panel" class="avatar-parts-panel"></div>
            <div id="avatar-draw-panel" class="avatar-draw-panel" hidden>
              <div><span class="avatar-control-label">ブラシの色</span><div class="avatar-draw-colors"></div></div>
              <label><span class="avatar-control-label">太さ</span><input id="avatar-brush-size" type="range" min="2" max="28" value="7"></label>
              <p>左のアバターへ直接描けます。髪飾り、ひげ、タトゥーなど、好きなパーツを足してください。</p>
              <div class="avatar-draw-actions"><button type="button" data-draw-action="undo">ひとつ戻す</button><button type="button" data-draw-action="clear">描画を消す</button></div>
            </div>
          </div>
        </div>
        <footer class="avatar-studio-footer"><button type="button" class="avatar-cancel">キャンセル</button><button type="button" class="avatar-save">保存する</button></footer>
      </section>`;
    document.body.appendChild(overlay);
    drawingCanvas = overlay.querySelector("#avatar-drawing-canvas");
    drawingContext = drawingCanvas.getContext("2d");
    overlay.querySelector(".avatar-studio-close").addEventListener("click", close);
    overlay.querySelector(".avatar-cancel").addEventListener("click", close);
    overlay.querySelector(".avatar-save").addEventListener("click", save);
    overlay.querySelector(".avatar-tabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-avatar-tab]");
      if (!tab) return;
      activeTab = tab.dataset.avatarTab;
      renderEditor();
    });
    overlay.querySelector("#avatar-parts-panel").addEventListener("click", (event) => {
      const choice = event.target.closest("[data-avatar-key]");
      if (!choice) return;
      draft[choice.dataset.avatarKey] = choice.dataset.avatarValue;
      renderPreview();
      renderEditor();
    });
    overlay.querySelector(".avatar-draw-colors").addEventListener("click", (event) => {
      const color = event.target.closest("[data-brush-color]");
      if (!color) return;
      overlay.dataset.brushColor = color.dataset.brushColor;
      renderEditor();
    });
    overlay.querySelector(".avatar-draw-actions").addEventListener("click", (event) => {
      const action = event.target.closest("[data-draw-action]")?.dataset.drawAction;
      if (action === "undo") draft.strokes.pop();
      if (action === "clear") draft.strokes = [];
      renderPreview();
    });
    drawingCanvas.addEventListener("pointerdown", beginStroke);
    drawingCanvas.addEventListener("pointermove", continueStroke);
    drawingCanvas.addEventListener("pointerup", endStroke);
    drawingCanvas.addEventListener("pointercancel", endStroke);
    overlay.addEventListener("keydown", trapDialogFocus);
  }

  function trapDialogFocus(event) {
    if (!overlay?.classList.contains("visible")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderEditor() {
    overlay.querySelectorAll("[data-avatar-tab]").forEach((button) => {
      const selected = button.dataset.avatarTab === activeTab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
    const parts = overlay.querySelector("#avatar-parts-panel");
    const draw = overlay.querySelector("#avatar-draw-panel");
    parts.hidden = activeTab === "draw";
    draw.hidden = activeTab !== "draw";
    drawingCanvas.classList.toggle("drawing-enabled", activeTab === "draw");
    if (activeTab !== "draw") {
      parts.innerHTML = groups[activeTab].map(([key, label]) => `<fieldset><legend>${label}</legend><div class="avatar-choice-grid ${["skin", "hairColor", "eyeColor", "outfitColor"].includes(key) ? "colors" : ""}">${choices[key].map(([value, name]) => `<button type="button" class="avatar-choice${draft[key] === value ? " selected" : ""}" data-avatar-key="${key}" data-avatar-value="${value}" ${value.startsWith("#") ? `style="--choice-color:${value}"` : ""}>${value.startsWith("#") ? `<i></i><span>${name}</span>` : name}</button>`).join("")}</div></fieldset>`).join("");
    } else {
      const colors = ["#ffffff", "#171416", "#e3b95d", "#a54154", "#3e6e9f", "#4f8069", "#9b63a0", "#ef9fa8", "#6e4530", "#d5d0c8"];
      const selected = overlay.dataset.brushColor || colors[0];
      overlay.querySelector(".avatar-draw-colors").innerHTML = colors.map((color) => `<button type="button" data-brush-color="${color}" class="${selected === color ? "selected" : ""}" style="--brush-color:${color}" aria-label="${color}"></button>`).join("");
    }
  }

  function renderDrawing() {
    drawingContext.clearRect(0, 0, 512, 512);
    (draft.strokes || []).forEach((stroke) => {
      if (!stroke.points?.length) return;
      drawingContext.beginPath();
      drawingContext.strokeStyle = safeColor(stroke.color, "#ffffff");
      drawingContext.lineWidth = Math.max(1, Math.min(40, Number(stroke.size) || 7));
      drawingContext.lineCap = "round";
      drawingContext.lineJoin = "round";
      stroke.points.map(pointCoordinates).filter(Boolean).forEach(([x, y], index) => index ? drawingContext.lineTo(x, y) : drawingContext.moveTo(x, y));
      drawingContext.stroke();
    });
  }

  function renderPreview() {
    overlay.querySelector("#avatar-studio-svg").innerHTML = renderSvg({ ...draft, strokes: [] });
    renderDrawing();
  }

  function pointerPosition(event) {
    const rect = drawingCanvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * 512 / rect.width, (event.clientY - rect.top) * 512 / rect.height];
  }
  function beginStroke(event) {
    if (activeTab !== "draw") return;
    drawingCanvas.setPointerCapture(event.pointerId);
    activeStroke = { color: overlay.dataset.brushColor || "#ffffff", size: Number(overlay.querySelector("#avatar-brush-size").value), points: [pointerPosition(event)] };
    draft.strokes = [...(draft.strokes || []), activeStroke];
  }
  function continueStroke(event) {
    if (!activeStroke || activeTab !== "draw") return;
    const point = pointerPosition(event);
    const previous = activeStroke.points.at(-1);
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 2.5) return;
    if (activeStroke.points.length < 500) activeStroke.points.push(point);
    renderDrawing();
  }
  function endStroke() { activeStroke = null; }

  function open() {
    if (!overlay) createStudio();
    previouslyFocusedElement = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    draft = clone(profile);
    const nameInput = document.getElementById("name-input");
    draft.name = nameInput?.value.trim() || profile.name || "";
    overlay.querySelector("#avatar-profile-name").value = draft.name;
    activeTab = "face";
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
    renderEditor();
    renderPreview();
    requestAnimationFrame(() => overlay.querySelector("#avatar-profile-name")?.focus());
  }
  function close() {
    overlay?.classList.remove("visible");
    overlay?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = previousBodyOverflow;
    previouslyFocusedElement?.focus?.();
    previouslyFocusedElement = null;
  }
  function save() {
    draft.name = overlay.querySelector("#avatar-profile-name").value.trim().slice(0, 12);
    profile = clone(draft);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    const nameInput = document.getElementById("name-input");
    if (nameInput && profile.name) nameInput.value = profile.name;
    refreshPageAvatars();
    document.dispatchEvent(new CustomEvent("luxe-avatar-saved", { detail: clone(profile) }));
    close();
  }
  function refreshPageAvatars() {
    document.querySelectorAll("[data-luxe-avatar]").forEach((element) => { element.innerHTML = renderSvg(profile); });
  }

  window.LuxeAvatar = {
    defaults: clone(defaults),
    getProfile: () => clone(profile),
    toNetworkProfile,
    renderSvg,
    open,
    refresh: refreshPageAvatars,
  };

  document.addEventListener("DOMContentLoaded", () => {
    const nameInput = document.getElementById("name-input");
    if (nameInput && profile.name) nameInput.value = profile.name;
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-open-avatar-studio]")) open();
    });
    refreshPageAvatars();
  });
})();
