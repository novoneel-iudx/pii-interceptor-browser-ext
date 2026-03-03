# PII Interceptor Browser Extension (Chrome MV3)

Masks detected PII when text is pasted into supported LLM chatboxes and provides an explicit unmask action for selected masked tokens.

## Features

- Local-only PII detection (no network calls)
- Paste-time detection and user confirmation
- Optional auto-masking while typing (input/textarea, high-confidence structured PII only)
- Typed placeholders like `{{PII_EMAIL_1}}`
- Per-tab-session in-memory token mapping
- Explicit unmask via extension action or keyboard shortcut (`Ctrl+Shift+U` / `Cmd+Shift+U`)
- Options page for enabled PII types and max paste size

## Supported Sites

- `chat.openai.com`
- `chatgpt.com`
- `claude.ai`
- `gemini.google.com`
- `www.perplexity.ai`

## PII Types

- Email
- Phone
- SSN
- Credit card (Luhn-validated)
- Person name (heuristic, low confidence)

## Dev Setup

```bash
npm install
npm run test
npm run build
```

Load unpacked extension from `dist/` in Chrome (`chrome://extensions`).

## Notes

- Mapping is kept only in content-script memory and clears on tab reload/close.
- Unmasking on non-editable selections restores text and copies the result to clipboard.
- Auto-mask while typing can be enabled in Options (`maskOnType`). It does not auto-mask heuristic names.
