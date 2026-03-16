"use strict";
(() => {
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
  async function saveSettings(settings) {
    await chrome.storage.sync.set({ settings });
  }

  // src/options.ts
  var TYPE_KEYS = [
    "EMAIL",
    "PHONE",
    "SSN",
    "CREDIT_CARD",
    "PERSON_NAME",
    "ORG",
    "LOCATION",
    "ADDRESS"
  ];
  function setStatus(message) {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = message;
    }
  }
  function readSettingsFromDom() {
    const enabledTypes = { ...DEFAULT_SETTINGS.enabledTypes };
    for (const key of TYPE_KEYS) {
      const checkbox = document.getElementById(key);
      if (checkbox) {
        enabledTypes[key] = checkbox.checked;
      }
    }
    const maxPasteInput = document.getElementById("maxPasteSize");
    const maxPasteSizeRaw = Number(maxPasteInput?.value ?? DEFAULT_SETTINGS.maxPasteSize);
    const nerMinConfidenceInput = document.getElementById("nerMinConfidence");
    const nerMinConfidenceRaw = Number(
      nerMinConfidenceInput?.value ?? DEFAULT_SETTINGS.nerMinConfidence
    );
    return {
      enabledTypes,
      maxPasteSize: Number.isFinite(maxPasteSizeRaw) && maxPasteSizeRaw >= 256 ? maxPasteSizeRaw : DEFAULT_SETTINGS.maxPasteSize,
      maskOnType: document.getElementById("maskOnType")?.checked ?? DEFAULT_SETTINGS.maskOnType,
      nerMinConfidence: Number.isFinite(nerMinConfidenceRaw) && nerMinConfidenceRaw >= 0 && nerMinConfidenceRaw <= 1 ? nerMinConfidenceRaw : DEFAULT_SETTINGS.nerMinConfidence
    };
  }
  function writeSettingsToDom(settings) {
    for (const key of TYPE_KEYS) {
      const checkbox = document.getElementById(key);
      if (checkbox) {
        checkbox.checked = settings.enabledTypes[key];
      }
    }
    const maxPasteInput = document.getElementById("maxPasteSize");
    if (maxPasteInput) {
      maxPasteInput.value = String(settings.maxPasteSize);
    }
    const maskOnType = document.getElementById("maskOnType");
    if (maskOnType) {
      maskOnType.checked = settings.maskOnType;
    }
    const nerMinConfidence = document.getElementById("nerMinConfidence");
    if (nerMinConfidence) {
      nerMinConfidence.value = String(settings.nerMinConfidence);
    }
  }
  async function init() {
    const settings = await getSettings();
    writeSettingsToDom(settings);
    const saveButton = document.getElementById("saveBtn");
    saveButton?.addEventListener("click", async () => {
      const nextSettings = readSettingsFromDom();
      await saveSettings(nextSettings);
      setStatus("Saved");
      window.setTimeout(() => setStatus(""), 1200);
    });
  }
  void init();
})();
