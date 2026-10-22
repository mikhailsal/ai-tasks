import { expect, it } from 'vitest';
import { domainError } from '../../src/core/errors.js';
import { restoreAcceptanceEnvelopeSchema } from '../../src/api/helper-protocol.js';
import {
  requestRestoreAcceptance,
  settleRejectedAcceptance,
} from '../../src/runtime/restore-acceptance.js';

function lifecycle(definite: boolean, pending = true) {
  const events: string[] = [];
  return {
    events,
    options: {
      definite,
      isClosing: () => false,
      resume: async () => {
        events.push('resume');
      },
      stop: async () => {
        events.push('stop');
      },
      needsRecovery: async () => {
        events.push('inspect');
        return pending;
      },
      recover: async () => {
        events.push('recover');
      },
      open: async () => {
        events.push('open');
      },
    },
  };
}

it.each([
  'CONFIRMATION_REQUIRED',
  'REVISION_CONFLICT',
  'CONFIG_CONFLICT',
  'DATABASE_EPOCH_CONFLICT',
  'PROJECT_NOT_FOUND',
  'PROJECT_MISMATCH',
  'EMOJI_CONFLICT',
] as const)(
  '%s from the exact acceptance call resumes the same generation and preserves the original error',
  async (code) => {
    const error = domainError(code, 'Authored', { source: '  Сохранить 🧪\n' });
    const response = await requestRestoreAcceptance(async () => {
      throw error;
    });
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('Expected rejection');
    expect(response.error).toBe(error);
    expect(response.definite).toBe(true);
    const { events, options } = lifecycle(response.definite);
    await settleRejectedAcceptance(options);
    expect(events).toEqual(['resume']);
  },
);

it.each([
  'VALIDATION_ERROR',
  'IDEMPOTENCY_CONFLICT',
  'DB_CONFLICT',
  'MAINTENANCE',
  'INTERNAL_ERROR',
] as const)(
  '%s retains stop, exclusive recovery, and reopen even when represented by a DomainError',
  async (code) => {
    const response = await requestRestoreAcceptance(async () => {
      throw domainError(code, 'Uncertain');
    });
    if (response.ok) throw new Error('Expected rejection');
    expect(response.definite).toBe(false);
    const { events, options } = lifecycle(response.definite);
    await settleRejectedAcceptance(options);
    expect(events).toEqual(['stop', 'inspect', 'recover', 'open']);
  },
);

it('a plain Error carrying a known code remains uncertain', async () => {
  const error = Object.assign(new Error('runtime failure'), { code: 'CONFIRMATION_REQUIRED' });
  const response = await requestRestoreAcceptance(async () => {
    throw error;
  });
  expect(response).toEqual({ ok: false, error, definite: false });
});

it('local response parsing lies outside the proven-rejection classification', async () => {
  const response = await requestRestoreAcceptance(async () => ({ invalid: true }));
  expect(response).toEqual({ ok: true, value: { invalid: true } });
  if (!response.ok) throw new Error('Expected response');
  expect(() => restoreAcceptanceEnvelopeSchema.parse(response.value)).toThrow();
  const { events, options } = lifecycle(false, false);
  await settleRejectedAcceptance(options);
  expect(events).toEqual(['stop', 'inspect', 'open']);
});

it('failed same-generation resume falls back to the complete recovery barrier', async () => {
  const { events, options } = lifecycle(true);
  options.resume = async () => {
    events.push('resume');
    throw domainError('MAINTENANCE', 'Worker failed');
  };
  await settleRejectedAcceptance(options);
  expect(events).toEqual(['resume', 'stop', 'inspect', 'recover', 'open']);
});

it('closing after a known rejection never restarts helpers or workers', async () => {
  const { events, options } = lifecycle(true);
  options.isClosing = () => true;
  await settleRejectedAcceptance(options);
  expect(events).toEqual([]);
});

it('an uncertain rejection still drains and recovers when closing, without reopening', async () => {
  const { events, options } = lifecycle(false);
  options.isClosing = () => true;
  await settleRejectedAcceptance(options);
  expect(events).toEqual(['stop', 'inspect', 'recover']);
});

it('closing during recovery suppresses the final reopen', async () => {
  const { events, options } = lifecycle(false);
  let closing = false;
  options.isClosing = () => closing;
  options.recover = async () => {
    events.push('recover');
    closing = true;
  };
  await settleRejectedAcceptance(options);
  expect(events).toEqual(['stop', 'inspect', 'recover']);
});
