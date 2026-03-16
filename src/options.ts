import { DEFAULT_SETTINGS, getSettings, saveSettings } from './settings';
import type { ExtensionSettings, PiiType } from './types';

const TYPE_KEYS: PiiType[] = [
  'EMAIL',
  'PHONE',
  'SSN',
  'CREDIT_CARD',
  'PERSON_NAME',
  'ORG',
  'LOCATION',
  'ADDRESS'
];

function setStatus(message: string): void {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message;
  }
}

function readSettingsFromDom(): ExtensionSettings {
  const enabledTypes = { ...DEFAULT_SETTINGS.enabledTypes };
  for (const key of TYPE_KEYS) {
    const checkbox = document.getElementById(key) as HTMLInputElement | null;
    if (checkbox) {
      enabledTypes[key] = checkbox.checked;
    }
  }

  const maxPasteInput = document.getElementById('maxPasteSize') as HTMLInputElement | null;
  const maxPasteSizeRaw = Number(maxPasteInput?.value ?? DEFAULT_SETTINGS.maxPasteSize);

  const nerMinConfidenceInput = document.getElementById('nerMinConfidence') as HTMLInputElement | null;
  const nerMinConfidenceRaw = Number(
    nerMinConfidenceInput?.value ?? DEFAULT_SETTINGS.nerMinConfidence
  );

  return {
    enabledTypes,
    maxPasteSize: Number.isFinite(maxPasteSizeRaw) && maxPasteSizeRaw >= 256
      ? maxPasteSizeRaw
      : DEFAULT_SETTINGS.maxPasteSize,
    maskOnType:
      (document.getElementById('maskOnType') as HTMLInputElement | null)?.checked ??
      DEFAULT_SETTINGS.maskOnType,
    nerMinConfidence:
      Number.isFinite(nerMinConfidenceRaw) && nerMinConfidenceRaw >= 0 && nerMinConfidenceRaw <= 1
        ? nerMinConfidenceRaw
        : DEFAULT_SETTINGS.nerMinConfidence
  };
}

function writeSettingsToDom(settings: ExtensionSettings): void {
  for (const key of TYPE_KEYS) {
    const checkbox = document.getElementById(key) as HTMLInputElement | null;
    if (checkbox) {
      checkbox.checked = settings.enabledTypes[key];
    }
  }

  const maxPasteInput = document.getElementById('maxPasteSize') as HTMLInputElement | null;
  if (maxPasteInput) {
    maxPasteInput.value = String(settings.maxPasteSize);
  }

  const maskOnType = document.getElementById('maskOnType') as HTMLInputElement | null;
  if (maskOnType) {
    maskOnType.checked = settings.maskOnType;
  }

  const nerMinConfidence = document.getElementById('nerMinConfidence') as HTMLInputElement | null;
  if (nerMinConfidence) {
    nerMinConfidence.value = String(settings.nerMinConfidence);
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  writeSettingsToDom(settings);

  const saveButton = document.getElementById('saveBtn');
  saveButton?.addEventListener('click', async () => {
    const nextSettings = readSettingsFromDom();
    await saveSettings(nextSettings);
    setStatus('Saved');
    window.setTimeout(() => setStatus(''), 1200);
  });
}

void init();
