import type { RuntimeMessage } from './types';

async function sendUnmaskRequestToActiveTab(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab?.id) {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'UNMASK_SELECTION_REQUEST'
    } satisfies RuntimeMessage);

    if (!response?.payload?.success) {
      console.debug('[PII Interceptor] Unmask result:', response?.payload?.message ?? 'No response');
    }
  } catch {
    console.debug('[PII Interceptor] Content script unavailable on this page.');
  }
}

chrome.action.onClicked.addListener(() => {
  void sendUnmaskRequestToActiveTab();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'unmask-selection') {
    void sendUnmaskRequestToActiveTab();
  }
});
