import { useEffect, useState } from 'react';

/** Column width plus gap on a wide screen; matches `.board-column` in styles.css. */
const WIDE_COLUMN = 312;
const WIDE = '(min-width: 900px)';

function visibleColumns(): number {
  if (typeof window === 'undefined' || !window.matchMedia(WIDE).matches) return 1;
  return Math.max(1, Math.ceil(Math.min(window.innerWidth, 1440) / WIDE_COLUMN));
}

/** How many board columns fit side by side (QA F15): one on a phone, several on a wide screen. */
export function useVisibleColumns(): number {
  const [count, setCount] = useState(visibleColumns);
  useEffect(() => {
    const update = () => setCount(visibleColumns());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return count;
}
