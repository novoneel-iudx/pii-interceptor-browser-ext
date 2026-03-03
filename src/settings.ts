import type { ExtensionSettings, PiiType } from './types';

const PII_TYPES: PiiType[] = ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD', 'PERSON_NAME'];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabledTypes: {
    EMAIL: true,
    PHONE: true,
    SSN: true,
    CREDIT_CARD: true,
    PERSON_NAME: true
  },
  maxPasteSize: 50000,
  maskOnType: false
};

export async function getSettings(): Promise<ExtensionSettings> {
  const data = await chrome.storage.sync.get(['settings']);
  const raw = data.settings as Partial<ExtensionSettings> | undefined;

  if (!raw) {
    return DEFAULT_SETTINGS;
  }

  const enabledTypes = { ...DEFAULT_SETTINGS.enabledTypes, ...(raw.enabledTypes ?? {}) };
  for (const type of PII_TYPES) {
    if (typeof enabledTypes[type] !== 'boolean') {
      enabledTypes[type] = DEFAULT_SETTINGS.enabledTypes[type];
    }
  }

  const maxPasteSize = Number(raw.maxPasteSize);
  return {
    enabledTypes,
    maxPasteSize: Number.isFinite(maxPasteSize) && maxPasteSize >= 256 ? maxPasteSize : DEFAULT_SETTINGS.maxPasteSize,
    maskOnType: typeof raw.maskOnType === 'boolean' ? raw.maskOnType : DEFAULT_SETTINGS.maskOnType
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}
