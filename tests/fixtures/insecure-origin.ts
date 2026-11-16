import type { BrowserContext } from '@playwright/test';

/** A documentation-range LAN address: a plain HTTP origin that is not a secure context. */
export const insecureOrigin = 'http://192.0.2.2';

/**
 * Preserve the real app/assets/API and mutation bytes behind a plain HTTP browser origin.
 * Routed requests are fetched by the test runner, so browser offline emulation does not
 * reach them; `setOffline` makes the proxy fail exactly like a lost network instead.
 */
export async function proxyApplication(context: BrowserContext, upstreamOrigin: string) {
  let offline = false;
  await context.route(`${insecureOrigin}/**`, async (route) => {
    if (offline) return route.abort('internetdisconnected');
    const request = route.request();
    const url = new URL(request.url());
    const headers: Record<string, string> = { ...request.headers(), origin: upstreamOrigin };
    // Host is routing metadata and must be derived from the real upstream URL.
    delete headers.host;
    const upstream = await route.fetch({
      url: `${upstreamOrigin}${url.pathname}${url.search}`,
      headers,
    });
    await route.fulfill({ response: upstream });
  });
  return {
    async setOffline(value: boolean) {
      offline = value;
      await context.setOffline(value);
    },
  };
}
