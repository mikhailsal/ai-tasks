import { startDataHelper, type DataHelper } from '../../src/api/helper-client.js';
import { domainError } from '../../src/core/errors.js';

/** Defer the real child process until a fixture actually exercises HTTP data access. */
export function createLazyDataHelper(options: Parameters<typeof startDataHelper>[0]): DataHelper {
  let starting: Promise<DataHelper> | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;

  async function getHelper(): Promise<DataHelper> {
    if (closed) throw domainError('MAINTENANCE', 'API data helper is unavailable');
    starting ??= startDataHelper(options);
    const helper = await starting;
    // close() owns draining this same startup promise and releasing its real child.
    if (closed) throw domainError('MAINTENANCE', 'API data helper is unavailable');
    return helper;
  }

  return {
    async request(command) {
      return (await getHelper()).request(command);
    },
    async activeProjectScopes() {
      return (await getHelper()).activeProjectScopes();
    },
    close() {
      closed = true;
      closing ??= (async () => {
        // A rejected production startup has already stopped its child internally.
        const helper = await starting?.catch(() => undefined);
        await helper?.close();
      })();
      return closing;
    },
  };
}
