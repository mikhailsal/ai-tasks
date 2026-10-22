import { createContext, useContext, type ReactNode } from 'react';
import { canMutate, useConnectivity } from '../data/connectivity.js';

const MutationEpoch = createContext<string | undefined>(undefined);

/** Supplies scope identity without disabling navigation, cached reads, or job-status controls. */
export function MutationBoundary({ epoch, children }: { epoch?: string; children: ReactNode }) {
  return <MutationEpoch.Provider value={epoch}>{children}</MutationEpoch.Provider>;
}
export function useMutationAvailability(epoch?: string, projectSlug?: string): boolean {
  const state = useConnectivity();
  const boundaryEpoch = useContext(MutationEpoch);
  return canMutate(epoch ?? boundaryEpoch ?? state.epoch ?? '', projectSlug);
}
