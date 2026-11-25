import { useEffect, useState, type RefObject } from 'react';

function measure(track: HTMLDivElement): number {
  const first = track.children[0];
  if (!(first instanceof HTMLElement)) return 1;
  const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
  const stride = first.getBoundingClientRect().width + gap;
  return stride > 0 ? Math.max(1, Math.ceil(track.clientWidth / stride)) : 1;
}

/**
 * How many board columns are at least partly in view (QA F15), measured on the track itself:
 * about two on a phone (one and the next peeking in), several on a wide screen.
 */
export function useVisibleColumns(track: RefObject<HTMLDivElement | null>): number {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => setCount(measure(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [track]);
  return count;
}
