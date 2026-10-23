import { useEffect, useRef } from 'react';
import { registerUnsavedChanges } from './navigation-guard.js';

export function useUnsavedChanges(isDirty: () => boolean) {
  const latest = useRef(isDirty);
  latest.current = isDirty;
  useEffect(() => registerUnsavedChanges(() => latest.current()), []);
}
