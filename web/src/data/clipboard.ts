/** A real user-initiated copy, including browsers without the asynchronous permission. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A denied/unavailable async clipboard can still allow a user-initiated copy.
    }
  }
  const field = document.createElement('textarea');
  const previous = document.activeElement;
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute('aria-label', 'Текст для копирования');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    if (!document.execCommand('copy')) throw new Error('Не удалось скопировать текст.');
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}
