import type { Detection } from './types';

function shouldDefaultChecked(detection: Detection): boolean {
  return detection.type !== 'PERSON_NAME' && detection.confidence !== 'low';
}

export function showToast(message: string, timeoutMs = 1800): void {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '2147483647';
  toast.style.background = '#111827';
  toast.style.color = 'white';
  toast.style.padding = '8px 10px';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '12px';
  toast.style.fontFamily = 'system-ui, sans-serif';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, timeoutMs);
}

export function showMaskConfirmation(detections: Detection[]): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.22)';
    overlay.style.zIndex = '2147483646';

    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '20px';
    panel.style.right = '20px';
    panel.style.width = '420px';
    panel.style.maxHeight = '70vh';
    panel.style.overflow = 'auto';
    panel.style.background = '#ffffff';
    panel.style.border = '1px solid #d1d5db';
    panel.style.borderRadius = '10px';
    panel.style.padding = '12px';
    panel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.2)';
    panel.style.fontFamily = 'system-ui, sans-serif';

    const title = document.createElement('div');
    title.textContent = 'PII detected in paste. Select items to mask.';
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    panel.appendChild(title);

    const form = document.createElement('div');

    detections.forEach((detection) => {
      const row = document.createElement('label');
      row.style.display = 'block';
      row.style.padding = '6px 0';
      row.style.borderBottom = '1px solid #f3f4f6';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.detectionId = detection.id;
      checkbox.checked = shouldDefaultChecked(detection);
      checkbox.style.marginRight = '8px';

      const label = document.createElement('span');
      label.textContent = `${detection.type}: ${detection.text.slice(0, 80)}`;
      label.title = detection.text;

      row.appendChild(checkbox);
      row.appendChild(label);
      form.appendChild(row);
    });

    panel.appendChild(form);

    const actions = document.createElement('div');
    actions.style.marginTop = '12px';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Mask selected';
    acceptBtn.type = 'button';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';

    actions.appendChild(acceptBtn);
    actions.appendChild(cancelBtn);
    panel.appendChild(actions);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const cleanup = () => overlay.remove();

    acceptBtn.addEventListener('click', () => {
      const selected = new Set<string>();
      panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
        if (checkbox.checked && checkbox.dataset.detectionId) {
          selected.add(checkbox.dataset.detectionId);
        }
      });
      cleanup();
      resolve(selected);
    });

    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup();
        resolve(null);
      }
    });
  });
}
