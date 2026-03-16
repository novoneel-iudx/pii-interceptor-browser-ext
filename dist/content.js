"use strict";
(() => {
  // src/detector.ts
  var EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  var PHONE_REGEX = /(?<!\w)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)/g;
  var IN_PHONE_REGEX = /(?<!\d)[6-9]\d{9}(?!\d)/g;
  var SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
  var CREDIT_CARD_REGEX = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
  var NAME_REGEX = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b/g;
  var MY_NAME_IS_REGEX = /\bmy\s+name\s+is\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{1,30}){0,2})\b/gi;
  var ADDRESS_IS_REGEX = /\b(?:my\s+)?address\s+is\s+([^\n.]{8,140})/gi;
  var CANONICAL_TOKEN_REGEX = /^PII_[a-z_]+_\d+$/;
  var LEGACY_TOKEN_REGEX = /^\{\{PII_[A-Z_]+_\d+\}\}$/;
  function isTokenLike(value) {
    const v = value.trim();
    return CANONICAL_TOKEN_REGEX.test(v) || LEGACY_TOKEN_REGEX.test(v);
  }
  function containsFieldKeyword(value) {
    return /\b(phone|number|email|address|ssn|credit|card)\b/i.test(value);
  }
  var NAME_STOPWORDS = /* @__PURE__ */ new Set([
    "United",
    "States",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "Please",
    "Thanks",
    "Hello",
    "Regards"
  ]);
  var CONFIDENCE_SCORE = {
    high: 3,
    medium: 2,
    low: 1
  };
  function makeId(type, index) {
    return `${type}_${index}`;
  }
  function normalize(type, value) {
    switch (type) {
      case "EMAIL":
        return value.trim().toLowerCase();
      case "PHONE":
        return value.replace(/\D/g, "");
      case "SSN":
        return value.replace(/\D/g, "");
      case "CREDIT_CARD":
        return value.replace(/\D/g, "");
      case "PERSON_NAME":
        return value.trim().replace(/\s+/g, " ");
      case "ADDRESS":
        return value.trim().replace(/\s+/g, " ");
      default:
        return value;
    }
  }
  function collectGroupMatches(text, type, regex, confidence, groupIndex, predicate) {
    const detections = [];
    regex.lastIndex = 0;
    let match;
    let index = 0;
    while ((match = regex.exec(text)) !== null) {
      const group = match[groupIndex];
      if (!group) {
        continue;
      }
      const full = match[0];
      const rel = full.toLowerCase().indexOf(String(group).toLowerCase());
      const start = match.index + Math.max(0, rel);
      const end = start + group.length;
      const value = text.slice(start, end);
      if (isTokenLike(value)) {
        continue;
      }
      if (predicate && !predicate(value)) {
        continue;
      }
      detections.push({
        id: makeId(type, index++),
        type,
        start,
        end,
        text: value,
        normalized: normalize(type, value),
        confidence
      });
    }
    return detections;
  }
  function collectMatches(text, type, regex, confidence, predicate) {
    const detections = [];
    regex.lastIndex = 0;
    let match;
    let index = 0;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      if (isTokenLike(value)) {
        continue;
      }
      if (predicate && !predicate(value)) {
        continue;
      }
      detections.push({
        id: makeId(type, index++),
        type,
        start: match.index,
        end: match.index + value.length,
        text: value,
        normalized: normalize(type, value),
        confidence
      });
    }
    return detections;
  }
  function passesLuhn(value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) {
      return false;
    }
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let digit = Number(digits[i]);
      if (Number.isNaN(digit)) {
        return false;
      }
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }
  function isLikelyPersonName(value) {
    const tokens = value.split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3) {
      return false;
    }
    if (tokens.some((token) => NAME_STOPWORDS.has(token))) {
      return false;
    }
    return true;
  }
  function resolveOverlaps(detections) {
    const sorted = [...detections].sort((a, b) => {
      const confidenceDiff = CONFIDENCE_SCORE[b.confidence] - CONFIDENCE_SCORE[a.confidence];
      if (confidenceDiff !== 0) {
        return confidenceDiff;
      }
      const lengthDiff = b.end - b.start - (a.end - a.start);
      if (lengthDiff !== 0) {
        return lengthDiff;
      }
      return a.start - b.start;
    });
    const accepted = [];
    for (const candidate of sorted) {
      const conflicts = accepted.some((existing) => candidate.start < existing.end && candidate.end > existing.start);
      if (!conflicts) {
        accepted.push(candidate);
      }
    }
    return accepted.sort((a, b) => a.start - b.start);
  }
  function detectPII(text, settings) {
    const detections = [];
    if (settings.enabledTypes.EMAIL) {
      detections.push(...collectMatches(text, "EMAIL", EMAIL_REGEX, "high"));
    }
    if (settings.enabledTypes.PHONE) {
      detections.push(...collectMatches(text, "PHONE", PHONE_REGEX, "high"));
      detections.push(...collectMatches(text, "PHONE", IN_PHONE_REGEX, "high"));
    }
    if (settings.enabledTypes.SSN) {
      detections.push(...collectMatches(text, "SSN", SSN_REGEX, "high"));
    }
    if (settings.enabledTypes.CREDIT_CARD) {
      detections.push(...collectMatches(text, "CREDIT_CARD", CREDIT_CARD_REGEX, "high", passesLuhn));
    }
    if (settings.enabledTypes.PERSON_NAME) {
      detections.push(...collectMatches(text, "PERSON_NAME", NAME_REGEX, "low", isLikelyPersonName));
      detections.push(
        ...collectGroupMatches(text, "PERSON_NAME", MY_NAME_IS_REGEX, "medium", 1, (value) => {
          if (containsFieldKeyword(value)) return false;
          if (/[\d.,]/.test(value)) return false;
          return true;
        })
      );
    }
    if (settings.enabledTypes.ADDRESS) {
      detections.push(
        ...collectGroupMatches(text, "ADDRESS", ADDRESS_IS_REGEX, "medium", 1, (value) => {
          if (isTokenLike(value)) return false;
          return true;
        })
      );
    }
    return resolveOverlaps(detections);
  }

  // src/mapper.ts
  function createCounters() {
    return {
      EMAIL: 0,
      PHONE: 0,
      SSN: 0,
      CREDIT_CARD: 0,
      PERSON_NAME: 0,
      ORG: 0,
      LOCATION: 0,
      ADDRESS: 0
    };
  }
  function typeTag(type) {
    switch (type) {
      case "CREDIT_CARD":
        return "credit_card";
      case "PERSON_NAME":
        return "name";
      default:
        return type.toLowerCase();
    }
  }
  function simpleHash(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  var TabMapper = class {
    state = {
      tokenToOriginal: /* @__PURE__ */ new Map(),
      originalToToken: /* @__PURE__ */ new Map(),
      countersByType: createCounters()
    };
    getExistingToken(type, normalized) {
      const key = `${type}:${simpleHash(normalized)}`;
      return this.state.originalToToken.get(key);
    }
    peekNextToken(type) {
      const next = this.state.countersByType[type] + 1;
      return `PII_${typeTag(type)}_${next}`;
    }
    getOrCreateToken(type, original, normalized) {
      const key = `${type}:${simpleHash(normalized)}`;
      const existingToken = this.state.originalToToken.get(key);
      if (existingToken) {
        return existingToken;
      }
      this.state.countersByType[type] += 1;
      const token = `PII_${typeTag(type)}_${this.state.countersByType[type]}`;
      this.state.originalToToken.set(key, token);
      this.state.tokenToOriginal.set(token, original);
      return token;
    }
    restoreToken(token) {
      return this.state.tokenToOriginal.get(token);
    }
    unmaskText(text) {
      let restoredCount = 0;
      const replaced = text.replace(
        /(\{\{PII_[A-Z_]+_\d+\}\})|(PII_[a-z_]+_\d+)/g,
        (token) => {
          const original = this.restoreToken(token);
          if (!original) {
            return token;
          }
          restoredCount += 1;
          return original;
        }
      );
      return { text: replaced, restoredCount };
    }
    getTokenMapJson() {
      return Object.fromEntries(this.state.tokenToOriginal.entries());
    }
    getStats() {
      const countsByTypeTag = {};
      for (const token of this.state.tokenToOriginal.keys()) {
        const m = /^PII_([a-z_]+)_\d+$/.exec(token);
        const tag = m?.[1] ?? "unknown";
        countsByTypeTag[tag] = (countsByTypeTag[tag] ?? 0) + 1;
      }
      return { totalTokens: this.state.tokenToOriginal.size, countsByTypeTag };
    }
    clearSession() {
      this.state.tokenToOriginal.clear();
      this.state.originalToToken.clear();
      this.state.countersByType = createCounters();
    }
  };

  // src/settings.ts
  var PII_TYPES = [
    "EMAIL",
    "PHONE",
    "SSN",
    "CREDIT_CARD",
    "PERSON_NAME",
    "ORG",
    "LOCATION",
    "ADDRESS"
  ];
  var DEFAULT_SETTINGS = {
    enabledTypes: {
      EMAIL: true,
      PHONE: true,
      SSN: true,
      CREDIT_CARD: true,
      PERSON_NAME: true,
      ORG: true,
      LOCATION: true,
      ADDRESS: true
    },
    maxPasteSize: 5e4,
    maskOnType: false,
    nerMinConfidence: 0.6
  };
  async function getSettings() {
    const data = await chrome.storage.sync.get(["settings"]);
    const raw = data.settings;
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const enabledTypes = { ...DEFAULT_SETTINGS.enabledTypes, ...raw.enabledTypes ?? {} };
    for (const type of PII_TYPES) {
      if (typeof enabledTypes[type] !== "boolean") {
        enabledTypes[type] = DEFAULT_SETTINGS.enabledTypes[type];
      }
    }
    const maxPasteSize = Number(raw.maxPasteSize);
    const nerMinConfidenceRaw = Number(raw.nerMinConfidence);
    const nerMinConfidence = Number.isFinite(nerMinConfidenceRaw) && nerMinConfidenceRaw >= 0 && nerMinConfidenceRaw <= 1 ? nerMinConfidenceRaw : DEFAULT_SETTINGS.nerMinConfidence;
    return {
      enabledTypes,
      maxPasteSize: Number.isFinite(maxPasteSize) && maxPasteSize >= 256 ? maxPasteSize : DEFAULT_SETTINGS.maxPasteSize,
      maskOnType: typeof raw.maskOnType === "boolean" ? raw.maskOnType : DEFAULT_SETTINGS.maskOnType,
      nerMinConfidence
    };
  }

  // src/analyzer.ts
  function extractAnalysisWindow(fullText, cursor, windowSize = 250) {
    const start = Math.max(0, cursor - windowSize);
    const end = Math.min(fullText.length, cursor + 50);
    return {
      text: fullText.slice(start, end),
      offset: start
    };
  }
  function analyzeNearCursor(text, cursor, settings) {
    const { text: windowText, offset } = extractAnalysisWindow(text, cursor);
    const detections = detectPII(windowText, settings);
    return detections.map((d) => ({
      ...d,
      start: d.start + offset,
      end: d.end + offset
    }));
  }

  // src/suggestionEngine.ts
  var CANONICAL_TOKEN_REGEX2 = /PII_[a-z_]+_\d+/g;
  var LEGACY_TOKEN_REGEX2 = /\{\{PII_[A-Z_]+_\d+\}\}/g;
  function buildSuggestions(text, detections, mapper2) {
    const suggestions = [];
    for (const d of detections) {
      const existing = mapper2.getExistingToken(d.type, d.normalized);
      const token = existing ?? mapper2.peekNextToken(d.type);
      suggestions.push({
        id: crypto.randomUUID(),
        type: "MASK",
        piiType: d.type,
        original: d.text,
        replacement: token,
        normalized: d.normalized,
        confidence: d.confidence,
        start: d.start,
        end: d.end
      });
    }
    const tokenRegexes = [CANONICAL_TOKEN_REGEX2, LEGACY_TOKEN_REGEX2];
    for (const re of tokenRegexes) {
      re.lastIndex = 0;
      let m;
      while (m = re.exec(text)) {
        const token = m[0];
        const original = mapper2.restoreToken(token);
        if (!original) continue;
        suggestions.push({
          id: crypto.randomUUID(),
          type: "UNMASK",
          original: token,
          replacement: original,
          start: m.index,
          end: m.index + token.length
        });
      }
    }
    return suggestions;
  }

  // src/suggestionUI.ts
  var currentPanel = null;
  var lastLeftPx = null;
  var lastTopPx = null;
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
  function chip(bg, fg, text) {
    const el = document.createElement("span");
    el.textContent = text;
    el.style.display = "inline-flex";
    el.style.alignItems = "center";
    el.style.padding = "2px 6px";
    el.style.borderRadius = "999px";
    el.style.fontSize = "10px";
    el.style.fontWeight = "600";
    el.style.background = bg;
    el.style.color = fg;
    return el;
  }
  function confidenceChip(conf) {
    if (!conf) return null;
    if (conf === "high") return chip("#dcfce7", "#166534", "HIGH");
    if (conf === "medium") return chip("#fef9c3", "#854d0e", "MED");
    return chip("#e5e7eb", "#374151", "LOW");
  }
  function typeIcon(type) {
    const el = document.createElement("span");
    el.style.display = "inline-flex";
    el.style.width = "18px";
    el.style.height = "18px";
    el.style.borderRadius = "6px";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.fontSize = "11px";
    el.style.fontWeight = "700";
    el.style.flex = "0 0 auto";
    const t = type ?? "EMAIL";
    const map = {
      EMAIL: { bg: "#eef2ff", fg: "#3730a3", text: "@" },
      PHONE: { bg: "#ecfeff", fg: "#155e75", text: "\u260E" },
      SSN: { bg: "#fef2f2", fg: "#991b1b", text: "#" },
      CREDIT_CARD: { bg: "#fff7ed", fg: "#9a3412", text: "\u{1F4B3}" },
      PERSON_NAME: { bg: "#f0fdf4", fg: "#166534", text: "A" },
      ORG: { bg: "#f5f3ff", fg: "#5b21b6", text: "\u{1F3E2}" },
      LOCATION: { bg: "#eff6ff", fg: "#1d4ed8", text: "\u2316" },
      ADDRESS: { bg: "#f0f9ff", fg: "#075985", text: "\u2302" }
    };
    const cfg = map[t] ?? { bg: "#e5e7eb", fg: "#111827", text: "?" };
    el.style.background = cfg.bg;
    el.style.color = cfg.fg;
    el.textContent = cfg.text;
    return el;
  }
  function button(label, variant, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.borderRadius = "8px";
    b.style.padding = "6px 10px";
    b.style.fontSize = "12px";
    b.style.fontWeight = "600";
    b.style.cursor = "pointer";
    b.style.border = variant === "primary" ? "1px solid #2563eb" : "1px solid #d1d5db";
    b.style.background = variant === "primary" ? "#2563eb" : "#ffffff";
    b.style.color = variant === "primary" ? "#ffffff" : "#111827";
    b.onclick = onClick;
    return b;
  }
  function buildColumn(title, items, onClick, onHover) {
    const col = document.createElement("div");
    col.style.flex = "1";
    col.style.minWidth = "0";
    const header = document.createElement("div");
    header.textContent = title;
    header.style.fontSize = "11px";
    header.style.fontWeight = "600";
    header.style.color = "#374151";
    header.style.marginBottom = "6px";
    const list = document.createElement("div");
    list.style.border = "1px solid #e5e7eb";
    list.style.borderRadius = "8px";
    list.style.overflowY = "auto";
    list.style.background = "#ffffff";
    list.style.maxHeight = `${2 * 38}px`;
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "\u2014";
      empty.style.padding = "10px";
      empty.style.fontSize = "12px";
      empty.style.color = "#6b7280";
      list.appendChild(empty);
    } else {
      for (const s of items) {
        const row = document.createElement("div");
        row.style.padding = "8px 10px";
        row.style.fontSize = "12px";
        row.style.cursor = "pointer";
        row.style.userSelect = "none";
        row.style.borderBottom = "1px solid #f3f4f6";
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.alignItems = "flex-start";
        row.onmouseenter = () => {
          row.style.background = "#f9fafb";
          onHover(s);
        };
        row.onmouseleave = () => {
          row.style.background = "#ffffff";
          onHover(null);
        };
        const icon = typeIcon(s.piiType);
        const txt = document.createElement("div");
        txt.style.flex = "1";
        txt.style.minWidth = "0";
        const top = document.createElement("div");
        top.style.display = "flex";
        top.style.alignItems = "center";
        top.style.justifyContent = "space-between";
        top.style.gap = "8px";
        const main = document.createElement("div");
        main.textContent = s.type === "MASK" ? s.original : s.original;
        main.style.fontWeight = "600";
        main.style.color = "#111827";
        main.style.overflow = "hidden";
        main.style.textOverflow = "ellipsis";
        main.style.whiteSpace = "nowrap";
        const chips = document.createElement("div");
        chips.style.display = "flex";
        chips.style.gap = "6px";
        const cchip = confidenceChip(s.confidence);
        if (cchip) chips.appendChild(cchip);
        if (s.type === "UNMASK") {
          chips.appendChild(chip("#e0f2fe", "#075985", "TOKEN"));
        }
        top.appendChild(main);
        top.appendChild(chips);
        const bottom = document.createElement("div");
        bottom.textContent = s.type === "MASK" ? `\u2192 ${s.replacement}` : `\u2192 ${s.replacement}`;
        bottom.style.fontSize = "11px";
        bottom.style.color = "#6b7280";
        bottom.style.marginTop = "2px";
        bottom.style.overflow = "hidden";
        bottom.style.textOverflow = "ellipsis";
        bottom.style.whiteSpace = "nowrap";
        txt.appendChild(top);
        txt.appendChild(bottom);
        row.appendChild(icon);
        row.appendChild(txt);
        row.onclick = () => onClick(s);
        list.appendChild(row);
      }
    }
    col.appendChild(header);
    col.appendChild(list);
    return col;
  }
  function hideSuggestion() {
    if (!currentPanel) return;
    currentPanel.remove();
    currentPanel = null;
  }
  function showSuggestion(anchorRect, maskSuggestions, unmaskSuggestions, onClickSuggestion, onHoverSuggestion, stats, actions) {
    if (currentPanel) {
      currentPanel.remove();
      currentPanel = null;
    }
    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.zIndex = "2147483647";
    panel.style.background = "#ffffff";
    panel.style.color = "#111827";
    panel.style.border = "1px solid #e5e7eb";
    panel.style.borderRadius = "10px";
    panel.style.boxShadow = "0 10px 24px rgba(0,0,0,0.18)";
    panel.style.padding = "10px";
    panel.style.fontFamily = "system-ui, sans-serif";
    panel.style.width = "560px";
    panel.style.maxWidth = "calc(100vw - 24px)";
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "8px";
    header.style.cursor = "move";
    header.style.userSelect = "none";
    const title = document.createElement("div");
    title.textContent = "PII Suggestions";
    title.style.fontSize = "12px";
    title.style.fontWeight = "600";
    const sub = document.createElement("div");
    sub.textContent = `${stats.totalTokens} token(s) in session`;
    sub.style.fontSize = "11px";
    sub.style.color = "#6b7280";
    sub.style.marginTop = "2px";
    const titleWrap = document.createElement("div");
    titleWrap.style.display = "flex";
    titleWrap.style.flexDirection = "column";
    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);
    const close = document.createElement("div");
    close.textContent = "\u2715";
    close.style.cursor = "pointer";
    close.style.fontSize = "12px";
    close.style.color = "#6b7280";
    close.onclick = () => hideSuggestion();
    header.appendChild(titleWrap);
    header.appendChild(close);
    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.marginBottom = "10px";
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search suggestions\u2026";
    search.style.flex = "1";
    search.style.border = "1px solid #d1d5db";
    search.style.borderRadius = "8px";
    search.style.padding = "6px 10px";
    search.style.fontSize = "12px";
    search.style.outline = "none";
    const statsBtn = document.createElement("button");
    statsBtn.type = "button";
    statsBtn.textContent = "Stats";
    statsBtn.style.border = "1px solid #d1d5db";
    statsBtn.style.background = "#ffffff";
    statsBtn.style.color = "#111827";
    statsBtn.style.borderRadius = "8px";
    statsBtn.style.padding = "6px 10px";
    statsBtn.style.cursor = "pointer";
    statsBtn.style.fontSize = "12px";
    statsBtn.style.fontWeight = "600";
    controls.appendChild(search);
    controls.appendChild(statsBtn);
    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.gap = "10px";
    body.style.width = "100%";
    const leftCol = document.createElement("div");
    leftCol.style.flex = "1";
    const rightCol = document.createElement("div");
    rightCol.style.flex = "1";
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const filterFn = (s) => {
        if (!q) return true;
        return s.original.toLowerCase().includes(q) || s.replacement.toLowerCase().includes(q) || (s.piiType ? s.piiType.toLowerCase().includes(q) : false);
      };
      leftCol.innerHTML = "";
      rightCol.innerHTML = "";
      const left = buildColumn("Mask (max 10)", maskSuggestions.filter(filterFn).slice(0, 10), onClickSuggestion, onHoverSuggestion);
      const right = buildColumn("Unmask (max 10)", unmaskSuggestions.filter(filterFn).slice(0, 10), onClickSuggestion, onHoverSuggestion);
      leftCol.appendChild(left);
      rightCol.appendChild(right);
    };
    search.oninput = () => render();
    body.appendChild(leftCol);
    body.appendChild(rightCol);
    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "space-between";
    footer.style.alignItems = "center";
    footer.style.marginTop = "10px";
    footer.style.gap = "10px";
    const leftActions = document.createElement("div");
    leftActions.style.display = "flex";
    leftActions.style.gap = "8px";
    leftActions.appendChild(button("Mask all", "primary", actions.onMaskAll));
    leftActions.appendChild(button("Unmask all", "secondary", actions.onUnmaskAll));
    const rightActions = document.createElement("div");
    rightActions.style.display = "flex";
    rightActions.style.gap = "8px";
    rightActions.appendChild(button("Copy masked", "secondary", actions.onCopyMasked));
    footer.appendChild(leftActions);
    footer.appendChild(rightActions);
    const statsDrawer = document.createElement("div");
    statsDrawer.style.display = "none";
    statsDrawer.style.marginTop = "10px";
    statsDrawer.style.borderTop = "1px solid #e5e7eb";
    statsDrawer.style.paddingTop = "10px";
    const statsTitle = document.createElement("div");
    statsTitle.textContent = "Session Stats";
    statsTitle.style.fontSize = "12px";
    statsTitle.style.fontWeight = "700";
    statsTitle.style.color = "#111827";
    statsDrawer.appendChild(statsTitle);
    const grid = document.createElement("div");
    grid.style.display = "flex";
    grid.style.flexWrap = "wrap";
    grid.style.gap = "8px";
    grid.style.marginTop = "8px";
    const entries = Object.entries(stats.countsByTypeTag).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      grid.appendChild(chip("#f3f4f6", "#374151", "No tokens yet"));
    } else {
      for (const [tag, count] of entries) {
        grid.appendChild(chip("#f3f4f6", "#111827", `${tag}: ${count}`));
      }
    }
    statsDrawer.appendChild(grid);
    const clearRow = document.createElement("div");
    clearRow.style.marginTop = "10px";
    clearRow.appendChild(button("Clear session", "secondary", actions.onClearSession));
    statsDrawer.appendChild(clearRow);
    statsBtn.onclick = () => {
      statsDrawer.style.display = statsDrawer.style.display === "none" ? "block" : "none";
    };
    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(body);
    panel.appendChild(footer);
    panel.appendChild(statsDrawer);
    document.body.appendChild(panel);
    render();
    const margin = 12;
    const width = panel.getBoundingClientRect().width;
    const height = panel.getBoundingClientRect().height;
    const positionPanel = (left, top) => {
      const leftPx = clamp(left, margin, window.innerWidth - width - margin);
      const topPx = clamp(top, margin, window.innerHeight - height - margin);
      panel.style.left = `${leftPx}px`;
      panel.style.top = `${topPx}px`;
      lastLeftPx = leftPx;
      lastTopPx = topPx;
    };
    if (typeof lastLeftPx === "number" && typeof lastTopPx === "number") {
      positionPanel(lastLeftPx, lastTopPx);
    } else {
      const desiredLeft = anchorRect.left;
      const desiredTop = anchorRect.bottom + 8;
      let topPx = clamp(desiredTop, margin, window.innerHeight - height - margin);
      if (desiredTop + height + margin > window.innerHeight && anchorRect.top - height - 8 > margin) {
        topPx = clamp(anchorRect.top - height - 8, margin, window.innerHeight - height - margin);
      }
      positionPanel(desiredLeft, topPx);
    }
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    const onMove = (e) => {
      if (!dragging) return;
      positionPanel(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    header.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    currentPanel = panel;
  }

  // src/ui.ts
  function shouldDefaultChecked(detection) {
    return detection.type !== "PERSON_NAME" && detection.confidence !== "low";
  }
  function showToast(message, timeoutMs = 1800) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.right = "20px";
    toast.style.zIndex = "2147483647";
    toast.style.background = "#111827";
    toast.style.color = "white";
    toast.style.padding = "8px 10px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "12px";
    toast.style.fontFamily = "system-ui, sans-serif";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, timeoutMs);
  }
  function showMaskConfirmation(detections) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0, 0, 0, 0.22)";
      overlay.style.zIndex = "2147483646";
      overlay.style.colorScheme = "light";
      const panel = document.createElement("div");
      panel.style.position = "fixed";
      panel.style.top = "20px";
      panel.style.right = "20px";
      panel.style.width = "420px";
      panel.style.maxHeight = "70vh";
      panel.style.overflow = "auto";
      panel.style.background = "#ffffff";
      panel.style.color = "#111827";
      panel.style.border = "1px solid #d1d5db";
      panel.style.borderRadius = "10px";
      panel.style.padding = "12px";
      panel.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.2)";
      panel.style.fontFamily = "system-ui, sans-serif";
      panel.style.fontSize = "12px";
      const title = document.createElement("div");
      title.textContent = "PII detected in paste. Select items to mask.";
      title.style.fontWeight = "600";
      title.style.marginBottom = "8px";
      title.style.color = "#111827";
      panel.appendChild(title);
      const form = document.createElement("div");
      detections.forEach((detection) => {
        const row = document.createElement("label");
        row.style.display = "block";
        row.style.padding = "6px 0";
        row.style.borderBottom = "1px solid #f3f4f6";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.detectionId = detection.id;
        checkbox.checked = shouldDefaultChecked(detection);
        checkbox.style.marginRight = "8px";
        checkbox.style.accentColor = "#2563eb";
        const label = document.createElement("span");
        label.textContent = `${detection.type}: ${detection.text.slice(0, 80)}`;
        label.title = detection.text;
        label.style.color = "#111827";
        row.appendChild(checkbox);
        row.appendChild(label);
        form.appendChild(row);
      });
      panel.appendChild(form);
      const actions = document.createElement("div");
      actions.style.marginTop = "12px";
      actions.style.display = "flex";
      actions.style.gap = "8px";
      const acceptBtn = document.createElement("button");
      acceptBtn.textContent = "Mask selected";
      acceptBtn.type = "button";
      acceptBtn.style.background = "#2563eb";
      acceptBtn.style.color = "#ffffff";
      acceptBtn.style.border = "1px solid #2563eb";
      acceptBtn.style.borderRadius = "8px";
      acceptBtn.style.padding = "8px 10px";
      acceptBtn.style.cursor = "pointer";
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.type = "button";
      cancelBtn.style.background = "#ffffff";
      cancelBtn.style.color = "#111827";
      cancelBtn.style.border = "1px solid #d1d5db";
      cancelBtn.style.borderRadius = "8px";
      cancelBtn.style.padding = "8px 10px";
      cancelBtn.style.cursor = "pointer";
      actions.appendChild(acceptBtn);
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      const cleanup = () => overlay.remove();
      acceptBtn.addEventListener("click", () => {
        const selected = /* @__PURE__ */ new Set();
        panel.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
          if (checkbox.checked && checkbox.dataset.detectionId) {
            selected.add(checkbox.dataset.detectionId);
          }
        });
        cleanup();
        resolve(selected);
      });
      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          cleanup();
          resolve(null);
        }
      });
    });
  }

  // src/content.ts
  var mapper = new TabMapper();
  var typingTimers = /* @__PURE__ */ new WeakMap();
  var internalMutationTargets = /* @__PURE__ */ new WeakSet();
  var savedHoverSelection = null;
  function mapNerEntityGroupToPiiType(group) {
    const g = String(group).toUpperCase();
    switch (g) {
      case "PER":
        return "PERSON_NAME";
      case "ORG":
        return "ORG";
      case "LOC":
        return "LOCATION";
      default:
        break;
    }
    if (g === "PERSON" || g === "PERS" || g === "I-PER" || g === "B-PER") return "PERSON_NAME";
    if (g === "I-ORG" || g === "B-ORG") return "ORG";
    if (g === "I-LOC" || g === "B-LOC") return "LOCATION";
    if (g === "ADDRESS" || g === "I-ADDRESS" || g === "B-ADDRESS") return "ADDRESS";
    return null;
  }
  function confidenceFromScore(score) {
    if (score >= 0.9) return "high";
    if (score >= 0.75) return "medium";
    return "low";
  }
  async function runNerLocal(text) {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "NER_REQUEST",
          payload: { text }
        },
        (response) => {
          if (!response || response.type !== "NER_RESPONSE") {
            resolve([]);
            return;
          }
          resolve(response.payload?.entities ?? []);
        }
      );
    });
  }
  async function detectPIIHybrid(text, settings) {
    const regexDetections = detectPII(text, settings);
    const entities = await runNerLocal(text);
    const nerDetections = [];
    let idx = 0;
    for (const e of entities) {
      if (typeof e.score !== "number" || e.score < settings.nerMinConfidence) continue;
      const mappedType = mapNerEntityGroupToPiiType(String(e.entity_group));
      if (!mappedType) continue;
      if (!settings.enabledTypes[mappedType]) continue;
      const start = Math.max(0, Number(e.start) || 0);
      const end = Math.max(start, Number(e.end) || start);
      if (end <= start || start >= text.length) continue;
      const clampedEnd = Math.min(text.length, end);
      const slice = text.slice(start, clampedEnd);
      if (!slice.trim()) continue;
      const trimmed = slice.trim();
      if (/^PII_[a-z_]+_\d+$/.test(trimmed) || /^\{\{PII_[A-Z_]+_\d+\}\}$/.test(trimmed)) {
        continue;
      }
      nerDetections.push({
        id: `NER_${idx++}`,
        type: mappedType,
        start,
        end: clampedEnd,
        text: slice,
        normalized: slice.trim().replace(/\s+/g, " "),
        confidence: confidenceFromScore(e.score)
      });
    }
    return resolveOverlaps([...regexDetections, ...nerDetections]);
  }
  function isEditableElement(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) {
      return target.type !== "password" && !target.readOnly && !target.disabled;
    }
    if (target instanceof HTMLTextAreaElement) {
      return !target.readOnly && !target.disabled;
    }
    return target.isContentEditable;
  }
  function resolveEditableHost(target) {
    if (!(target instanceof HTMLElement)) return null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return isEditableElement(target) ? target : null;
    }
    if (target.isContentEditable) return target;
    const parent = target.closest('[contenteditable="true"]');
    return parent && parent.isContentEditable ? parent : null;
  }
  function getEditableText(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value;
    }
    if (target.isContentEditable) {
      return target.innerText || "";
    }
    return "";
  }
  function getSelectionTextForEditable(target) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return target.value.slice(start, end);
  }
  function replaceSelectionInEditable(target, replacement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    target.setRangeText(replacement, start, end, "end");
    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: replacement
      })
    );
  }
  function captureInsertContext(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return {
        kind: "input",
        target,
        start: target.selectionStart ?? 0,
        end: target.selectionEnd ?? 0
      };
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    return {
      kind: "contenteditable",
      target,
      range: selection.getRangeAt(0).cloneRange()
    };
  }
  function applyInsertContext(context, text) {
    if (context.kind === "input") {
      context.target.focus();
      context.target.setSelectionRange(context.start, context.end);
      replaceSelectionInEditable(context.target, text);
      return;
    }
    context.target.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = context.range.cloneRange();
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    context.target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      })
    );
  }
  function saveSelectionForHover(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      savedHoverSelection = {
        kind: "input",
        target,
        start: target.selectionStart ?? 0,
        end: target.selectionEnd ?? 0
      };
      return;
    }
    const sel = window.getSelection();
    savedHoverSelection = { kind: "contenteditable", range: sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null };
  }
  function restoreSelectionAfterHover() {
    if (!savedHoverSelection) return;
    if (savedHoverSelection.kind === "input") {
      const { target, start, end } = savedHoverSelection;
      try {
        target.setSelectionRange(start, end);
      } catch {
      }
      savedHoverSelection = null;
      return;
    }
    const sel = window.getSelection();
    if (!sel) {
      savedHoverSelection = null;
      return;
    }
    sel.removeAllRanges();
    if (savedHoverSelection.range) sel.addRange(savedHoverSelection.range);
    savedHoverSelection = null;
  }
  function highlightRangeInTarget(target, start, end) {
    if (start < 0 || end <= start) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      saveSelectionForHover(target);
      target.focus();
      target.setSelectionRange(Math.min(start, target.value.length), Math.min(end, target.value.length));
      return;
    }
    if (!target.isContentEditable) return;
    saveSelectionForHover(target);
    target.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const node = target.childNodes[0] || target;
    const maxLen = node.textContent?.length ?? 0;
    range.setStart(node, Math.min(start, maxLen));
    range.setEnd(node, Math.min(end, maxLen));
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function applyMaskingWithSelection(text, detections, acceptedDetectionIds, selectionStart, selectionEnd) {
    let maskedCount = 0;
    let nextStart = selectionStart;
    let nextEnd = selectionEnd;
    let result = text;
    const sorted = [...detections].sort((a, b) => b.start - a.start);
    for (const detection of sorted) {
      if (!acceptedDetectionIds.has(detection.id)) continue;
      const token = mapper.getOrCreateToken(detection.type, detection.text, detection.normalized);
      result = `${result.slice(0, detection.start)}${token}${result.slice(detection.end)}`;
      const originalLength = detection.end - detection.start;
      const delta = token.length - originalLength;
      if (detection.end <= nextStart) nextStart += delta;
      else if (detection.start < nextStart) nextStart = detection.start + token.length;
      if (detection.end <= nextEnd) nextEnd += delta;
      else if (detection.start < nextEnd) nextEnd = detection.start + token.length;
      maskedCount += 1;
    }
    return {
      text: result,
      maskedCount,
      nextSelectionStart: Math.max(0, nextStart),
      nextSelectionEnd: Math.max(0, nextEnd)
    };
  }
  function shouldTriggerTypeMask(event) {
    if (event.isComposing) return false;
    if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
      return true;
    }
    if (event.inputType !== "insertText") return false;
    const ch = event.data ?? "";
    return /[\s,.;:!?)]/.test(ch);
  }
  function scheduleAutoMask(target) {
    const existing = typingTimers.get(target);
    if (typeof existing === "number") window.clearTimeout(existing);
    const timerId = window.setTimeout(async () => {
      const settings = await getSettings();
      if (!settings.maskOnType) return;
      const currentText = target.value;
      if (!currentText || currentText.length > settings.maxPasteSize) return;
      const detections = await detectPIIHybrid(currentText, settings);
      const accepted = /* @__PURE__ */ new Set();
      for (const detection of detections) {
        const isStructured = detection.type === "EMAIL" || detection.type === "PHONE" || detection.type === "SSN" || detection.type === "CREDIT_CARD";
        if (isStructured && detection.confidence === "high") accepted.add(detection.id);
      }
      if (accepted.size === 0) return;
      const selectionStart = target.selectionStart ?? currentText.length;
      const selectionEnd = target.selectionEnd ?? currentText.length;
      const result = applyMaskingWithSelection(currentText, detections, accepted, selectionStart, selectionEnd);
      if (result.maskedCount === 0 || result.text === currentText) return;
      internalMutationTargets.add(target);
      try {
        target.value = result.text;
        target.setSelectionRange(result.nextSelectionStart, result.nextSelectionEnd);
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "" }));
      } finally {
        internalMutationTargets.delete(target);
      }
      showToast(`Auto-masked ${result.maskedCount} item(s) while typing.`);
    }, 220);
    typingTimers.set(target, timerId);
  }
  async function handleSuggestions(target) {
    const settings = await getSettings();
    const text = getEditableText(target);
    if (!text) {
      hideSuggestion();
      return;
    }
    let cursor = text.length;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      cursor = target.selectionStart ?? text.length;
    }
    const nearDetections = analyzeNearCursor(text, cursor, settings);
    const windowDetections = await detectPIIHybrid(text, settings);
    const suggestionsAll = buildSuggestions(text, resolveOverlaps([...nearDetections, ...windowDetections]), mapper);
    const maskSuggestions = [];
    const unmaskSuggestions = [];
    for (const s of suggestionsAll) {
      if (s.type === "MASK") {
        if (maskSuggestions.length < 10) maskSuggestions.push(s);
      } else {
        if (unmaskSuggestions.length < 10) unmaskSuggestions.push(s);
      }
    }
    if (maskSuggestions.length === 0 && unmaskSuggestions.length === 0) {
      hideSuggestion();
      return;
    }
    const anchorRect = target.getBoundingClientRect();
    const stats = mapper.getStats();
    const actions = {
      onMaskAll: async () => {
        const detections = resolveOverlaps([...nearDetections, ...windowDetections]);
        const accepted = new Set(detections.map((d) => d.id));
        const result = applyMaskingWithSelection(text, detections, accepted, cursor, cursor);
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          target.value = result.text;
          const next = Math.min(result.nextSelectionStart, target.value.length);
          target.setSelectionRange(next, next);
          target.dispatchEvent(new InputEvent("input", { bubbles: true }));
        } else if (target.isContentEditable) {
          target.innerText = result.text;
          target.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }
        showToast(`Masked ${result.maskedCount} item(s).`);
      },
      onUnmaskAll: async () => {
        const result = mapper.unmaskText(text);
        if (result.restoredCount === 0) {
          showToast("No known tokens found.");
          return;
        }
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          target.value = result.text;
          const next = Math.min(cursor, target.value.length);
          target.setSelectionRange(next, next);
          target.dispatchEvent(new InputEvent("input", { bubbles: true }));
        } else if (target.isContentEditable) {
          target.innerText = result.text;
          target.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }
        showToast(`Restored ${result.restoredCount} token(s).`);
      },
      onCopyMasked: async () => {
        try {
          await navigator.clipboard.writeText(text);
          showToast("Copied current text to clipboard.");
        } catch {
          showToast("Unable to write to clipboard.");
        }
      },
      onClearSession: () => {
        mapper.clearSession();
        hideSuggestion();
        showToast("Session cleared.");
      }
    };
    showSuggestion(anchorRect, maskSuggestions, unmaskSuggestions, (suggestion) => {
      const before = text.slice(0, suggestion.start);
      const after = text.slice(suggestion.end);
      let replacement = suggestion.replacement;
      if (suggestion.type === "MASK" && suggestion.piiType && suggestion.normalized) {
        replacement = mapper.getOrCreateToken(suggestion.piiType, suggestion.original, suggestion.normalized);
      }
      const newText = before + replacement + after;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = newText;
        const newCursor = suggestion.start + replacement.length;
        target.setSelectionRange(newCursor, newCursor);
        target.dispatchEvent(new InputEvent("input", { bubbles: true }));
      } else if (target instanceof HTMLElement && target.isContentEditable) {
        target.innerText = newText;
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        const node = target.childNodes[0] || target;
        const nextCursor = suggestion.start + replacement.length;
        range.setStart(node, Math.min(nextCursor, node.textContent?.length || nextCursor));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        target.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    }, (hovered) => {
      if (!hovered) {
        restoreSelectionAfterHover();
        return;
      }
      highlightRangeInTarget(target, hovered.start, hovered.end);
    }, stats, actions);
  }
  async function maskAllInActiveEditable() {
    const active = resolveEditableHost(document.activeElement);
    if (!active) return;
    const settings = await getSettings();
    const text = getEditableText(active);
    if (!text) return;
    const cursor = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart ?? text.length : text.length;
    const nearDetections = analyzeNearCursor(text, cursor, settings);
    const windowDetections = await detectPIIHybrid(text, settings);
    const detections = resolveOverlaps([...nearDetections, ...windowDetections]);
    const accepted = new Set(detections.map((d) => d.id));
    const result = applyMaskingWithSelection(text, detections, accepted, cursor, cursor);
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.value = result.text;
      const next = Math.min(result.nextSelectionStart, active.value.length);
      active.setSelectionRange(next, next);
      active.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (active.isContentEditable) {
      active.innerText = result.text;
      active.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    showToast(`Masked ${result.maskedCount} item(s).`);
  }
  async function unmaskAllInActiveEditable() {
    const active = resolveEditableHost(document.activeElement);
    if (!active) return;
    const text = getEditableText(active);
    if (!text) return;
    const result = mapper.unmaskText(text);
    if (result.restoredCount === 0) {
      showToast("No known tokens found.");
      return;
    }
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const cursor = active.selectionStart ?? result.text.length;
      active.value = result.text;
      const next = Math.min(cursor, active.value.length);
      active.setSelectionRange(next, next);
      active.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (active.isContentEditable) {
      active.innerText = result.text;
      active.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    showToast(`Restored ${result.restoredCount} token(s).`);
  }
  async function onPaste(event) {
    const target = resolveEditableHost(event.target);
    if (!target) return;
    const insertContext = captureInsertContext(target);
    if (!insertContext) return;
    const clipboardText = event.clipboardData?.getData("text/plain");
    if (!clipboardText) return;
    event.preventDefault();
    event.stopPropagation();
    const settings = await getSettings();
    if (clipboardText.length > settings.maxPasteSize) {
      showToast(`Paste skipped: over max size (${settings.maxPasteSize} chars).`);
      applyInsertContext(insertContext, clipboardText);
      return;
    }
    const detections = await detectPIIHybrid(clipboardText, settings);
    if (detections.length === 0) {
      applyInsertContext(insertContext, clipboardText);
      return;
    }
    const acceptedIds = await showMaskConfirmation(detections);
    if (!acceptedIds) {
      applyInsertContext(insertContext, clipboardText);
      showToast("Paste kept unchanged.");
      return;
    }
    const masked = applyMaskingWithSelection(
      clipboardText,
      detections,
      acceptedIds,
      clipboardText.length,
      clipboardText.length
    );
    applyInsertContext(insertContext, masked.text);
    showToast(`Masked ${masked.maskedCount} item(s).`);
  }
  async function onInput(event) {
    const editable = resolveEditableHost(event.target);
    if (!editable) {
      hideSuggestion();
      return;
    }
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      if (internalMutationTargets.has(editable)) return;
    }
    await handleSuggestions(editable);
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      const settings = await getSettings();
      if (!settings.maskOnType) return;
      if (!shouldTriggerTypeMask(event)) return;
      scheduleAutoMask(editable);
    }
  }
  async function handleUnmaskRequest() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const selectedText2 = getSelectionTextForEditable(active);
      if (!selectedText2) {
        return { success: false, restoredCount: 0, message: "No selection to unmask." };
      }
      const result2 = mapper.unmaskText(selectedText2);
      if (result2.restoredCount > 0) {
        replaceSelectionInEditable(active, result2.text);
        try {
          await navigator.clipboard.writeText(result2.text);
          return {
            success: true,
            restoredCount: result2.restoredCount,
            message: `Restored ${result2.restoredCount} token(s) and copied to clipboard.`
          };
        } catch {
          return {
            success: true,
            restoredCount: result2.restoredCount,
            message: `Restored ${result2.restoredCount} token(s).`
          };
        }
      }
      return { success: false, restoredCount: 0, message: "No known tokens found in selection." };
    }
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";
    if (!selectedText) {
      return { success: false, restoredCount: 0, message: "No selection to unmask." };
    }
    const result = mapper.unmaskText(selectedText);
    if (result.restoredCount === 0) {
      return { success: false, restoredCount: 0, message: "No known tokens found in selection." };
    }
    try {
      await navigator.clipboard.writeText(result.text);
      return {
        success: true,
        restoredCount: result.restoredCount,
        message: `Restored ${result.restoredCount} token(s) and copied to clipboard.`
      };
    } catch {
      return {
        success: false,
        restoredCount: 0,
        message: "Unable to write restored text to clipboard."
      };
    }
  }
  document.addEventListener("paste", (event) => void onPaste(event), true);
  document.addEventListener("input", (event) => void onInput(event), true);
  document.addEventListener("keydown", (event) => {
    const e = event;
    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod || !e.shiftKey) return;
    if (e.key === "M" || e.key === "m") {
      e.preventDefault();
      void maskAllInActiveEditable();
      return;
    }
    if (e.key === "U" || e.key === "u") {
      e.preventDefault();
      void unmaskAllInActiveEditable();
      return;
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "UNMASK_SELECTION_REQUEST") return;
    void handleUnmaskRequest().then((result) => {
      showToast(result.message);
      sendResponse({
        type: "UNMASK_SELECTION_RESULT",
        payload: {
          success: result.success,
          restoredCount: result.restoredCount,
          message: result.message
        }
      });
    });
    return true;
  });
})();
