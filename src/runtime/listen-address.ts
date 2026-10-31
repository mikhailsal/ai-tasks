import type { NetworkInterfaceInfo } from 'node:os';
import { domainError } from '../core/errors.js';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;
export type ListenAddress = { host: string; port: number; origin: string; network: boolean };

const octet = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const ipv4Pattern = new RegExp(String.raw`^${octet}(?:\.${octet}){3}$`, 'u');

function listenPort(value: string | undefined): number {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw domainError('VALIDATION_ERROR', 'Invalid local API port');
  return port;
}

function ownsAddress(interfaces: Interfaces, host: string): boolean {
  return Object.values(interfaces).some((entries) =>
    entries?.some((entry) => entry.family === 'IPv4' && entry.address === host),
  );
}

/**
 * Loopback is the default. Any other bind is an explicit local network choice: one specific
 * address of this computer whose exact origin the browser protections can verify.
 */
export function resolveListenAddress(
  env: NodeJS.ProcessEnv,
  interfaces: Interfaces,
): ListenAddress {
  const port = listenPort(env.AI_TASKS_PORT);
  const host = env.AI_TASKS_HOST ?? '127.0.0.1';
  if (!ipv4Pattern.test(host))
    throw domainError('VALIDATION_ERROR', 'AI_TASKS_HOST must be an IPv4 address');
  const ownOrigin = `http://${host}:${port}`;
  if (host.startsWith('127.'))
    return { host, port, origin: env.AI_TASKS_ORIGIN ?? ownOrigin, network: false };
  if (host === '0.0.0.0')
    throw domainError(
      'VALIDATION_ERROR',
      'AI_TASKS_HOST must be one specific address, not all networks',
    );
  if (!ownsAddress(interfaces, host))
    throw domainError('VALIDATION_ERROR', 'AI_TASKS_HOST is not an address of this computer');
  if (env.AI_TASKS_ORIGIN !== undefined && env.AI_TASKS_ORIGIN !== ownOrigin)
    throw domainError(
      'VALIDATION_ERROR',
      'AI_TASKS_ORIGIN must equal http://HOST:PORT in local network mode',
    );
  return { host, port, origin: ownOrigin, network: true };
}
