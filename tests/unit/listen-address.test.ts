import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveListenAddress } from '../../src/runtime/listen-address.js';

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

const interfaces = {
  lo: [ipv4('127.0.0.1', true)],
  wlan0: [ipv4('192.168.1.203')],
};

function rejection(env: NodeJS.ProcessEnv) {
  try {
    resolveListenAddress(env, interfaces);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the listen address to be rejected');
}

describe('listen address configuration', () => {
  it('keeps the loopback default and its origin unchanged', () => {
    expect(resolveListenAddress({}, interfaces)).toEqual({
      host: '127.0.0.1',
      port: 3000,
      origin: 'http://127.0.0.1:3000',
      network: false,
    });
    expect(resolveListenAddress({ AI_TASKS_PORT: '4100' }, interfaces).origin).toBe(
      'http://127.0.0.1:4100',
    );
  });

  it('preserves an explicitly configured loopback origin as before', () => {
    expect(
      resolveListenAddress({ AI_TASKS_ORIGIN: 'http://192.168.1.203:3000' }, interfaces),
    ).toEqual({
      host: '127.0.0.1',
      port: 3000,
      origin: 'http://192.168.1.203:3000',
      network: false,
    });
  });

  it('enables local network mode for an address of this computer', () => {
    const expected = {
      host: '192.168.1.203',
      port: 3100,
      origin: 'http://192.168.1.203:3100',
      network: true,
    };
    const env = { AI_TASKS_HOST: '192.168.1.203', AI_TASKS_PORT: '3100' };
    expect(resolveListenAddress(env, interfaces)).toEqual(expected);
    expect(
      resolveListenAddress({ ...env, AI_TASKS_ORIGIN: 'http://192.168.1.203:3100' }, interfaces),
    ).toEqual(expected);
  });

  it.each([
    ['localhost', 'AI_TASKS_HOST must be an IPv4 address'],
    ['::', 'AI_TASKS_HOST must be an IPv4 address'],
    ['::1', 'AI_TASKS_HOST must be an IPv4 address'],
    ['192.168.1.256', 'AI_TASKS_HOST must be an IPv4 address'],
    ['192.168.01.203', 'AI_TASKS_HOST must be an IPv4 address'],
    [' 192.168.1.203', 'AI_TASKS_HOST must be an IPv4 address'],
    ['0.0.0.0', 'AI_TASKS_HOST must be one specific address, not all networks'],
    ['10.20.30.40', 'AI_TASKS_HOST is not an address of this computer'],
  ])('rejects host %j', (host, message) => {
    expect(rejection({ AI_TASKS_HOST: host })).toMatchObject({
      code: 'VALIDATION_ERROR',
      message,
    });
  });

  it.each([
    'http://127.0.0.1:3000',
    'http://192.168.1.203:3001',
    'https://192.168.1.203:3000',
    'http://192.168.1.203:3000/',
    'http://example.test:3000',
  ])('rejects a mismatched network origin %j', (origin) => {
    expect(rejection({ AI_TASKS_HOST: '192.168.1.203', AI_TASKS_ORIGIN: origin })).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'AI_TASKS_ORIGIN must equal http://HOST:PORT in local network mode',
    });
  });

  it.each(['0', '65536', '3000.5', 'port'])('rejects port %j', (port) => {
    expect(rejection({ AI_TASKS_PORT: port })).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid local API port',
    });
  });
});
