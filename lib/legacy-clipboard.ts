type ClipboardHost = { clipboard?: { writeText?: (text: string) => Promise<void> } };

// Public-IP HTTP is not a secure context, so navigator.clipboard.writeText is absent.
// Install the legacy copy path once; the manual-copy dialog remains the fallback.
export function installLegacyClipboard(target: ClipboardHost = navigator): void {
  if (target.clipboard && typeof target.clipboard.writeText === 'function') return;
  const writeText = (text: string) => new Promise<void>((resolve, reject) => {
    const field = document.createElement('textarea');
    field.value = String(text);
    field.readOnly = true;
    field.setAttribute('aria-hidden', 'true');
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:.01;pointer-events:none;font-size:16px;z-index:-1';
    const previous = document.activeElement;
    document.body.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    let copied = false;
    try {
      // Plain HTTP has no async Clipboard API. This is the same click-time fallback the Nginx hotfix used.
      // oxlint-disable-next-line typescript/no-deprecated
      copied = document.execCommand('copy');
    } catch { /* manual dialog remains available */ }
    field.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    if (copied) resolve();
    else reject(new Error('Browser copy unavailable'));
  });
  Object.defineProperty(target, 'clipboard', { configurable: true, value: { writeText } });
}
