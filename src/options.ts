import { DEFAULT_SETTINGS, getSettings, saveSettings } from './settings';
import type { ExtensionSettings, PiiType } from './types';

const TYPE_KEYS: PiiType[] = ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD', 'PERSON_NAME'];

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
    enabledTypes[key] = checkbox?.checked ?? DEFAULT_SETTINGS.enabledTypes[key];
  }

  const maxPasteInput = document.getElementById('maxPasteSize') as HTMLInputElement | null;
  const maxPasteSizeRaw = Number(maxPasteInput?.value ?? DEFAULT_SETTINGS.maxPasteSize);

  return {
    enabledTypes,
    maxPasteSize: Number.isFinite(maxPasteSizeRaw) && maxPasteSizeRaw >= 256
      ? maxPasteSizeRaw
      : DEFAULT_SETTINGS.maxPasteSize,
    maskOnType: (document.getElementById('maskOnType') as HTMLInputElement | null)?.checked ?? DEFAULT_SETTINGS.maskOnType
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
