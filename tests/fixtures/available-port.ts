import { createServer as createProbe } from 'node:net';

export async function availablePort(excluded?: number) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const probe = createProbe();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    if (address && typeof address !== 'string' && address.port !== excluded) return address.port;
  }
  throw new Error('No distinct loopback port for delivery fixture');
}
