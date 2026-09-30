(function () {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') return;

  // Public-IP HTTP is not a secure context, so the modern Clipboard API is absent.
  // Run the legacy copy synchronously inside the originating click gesture.
  function writeText(text) {
    return new Promise(function (resolve, reject) {
      var field = document.createElement('textarea');
      field.value = String(text);
      field.readOnly = true;
      field.setAttribute('aria-hidden', 'true');
      field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:.01;pointer-events:none;font-size:16px;z-index:-1';
      var previous = document.activeElement;
      document.body.appendChild(field);
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, field.value.length);
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (_) { /* manual dialog remains available */ }
      field.remove();
      if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      if (copied) resolve();
      else reject(new Error('Browser copy unavailable'));
    });
  }

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeText }
  });
})();
