/** getRandomValues remains available on plain HTTP; randomUUID requires a secure origin. */
export function browserUuid(): string {
  const provider = globalThis.crypto;
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues !== 'function')
    throw new Error('Браузер не поддерживает безопасное создание идентификатора операции.');
  const hex = Array.from(provider.getRandomValues(new Uint8Array(16)), (byte, index) => {
    if (index === 6) return ((byte & 0x0f) | 0x40).toString(16).padStart(2, '0');
    if (index === 8) return ((byte & 0x3f) | 0x80).toString(16).padStart(2, '0');
    return byte.toString(16).padStart(2, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
