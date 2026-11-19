/** The path part of a request URL, percent-decoded with repeated slashes folded; null if malformed. */
export function requestPath(url: string): string | null {
  try {
    return decodeURIComponent(url.split('?')[0] ?? '').replace(/\/{2,}/gu, '/');
  } catch {
    return null;
  }
}

/** The API namespace, as both the router fallback and the browser guard see it. */
export function apiPath(path: string): boolean {
  return path.toLowerCase().startsWith('/api');
}

/** A path the router answers with the page shell: not the API and not a file. */
export function shellPath(url: string): boolean {
  const path = requestPath(url);
  return path !== null && !apiPath(path) && !path.includes('.');
}
