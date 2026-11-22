import type { TaskResource } from '../../../src/schema/tasks.js';
export type Drag = {
  task: TaskResource;
  pointer: number;
  handle: HTMLButtonElement;
  x: number;
  y: number;
  startX: number;
  startY: number;
  to: number;
  active: boolean;
  valid: boolean;
  before: string | null;
  lastEdge: number;
  timer: ReturnType<typeof setTimeout>;
  tick?: ReturnType<typeof setInterval>;
  ghost?: HTMLDivElement;
};
export function updateDrag(current: Drag, track: HTMLDivElement) {
  const bounds = track.getBoundingClientRect();
  current.valid =
    current.x >= bounds.left &&
    current.x <= bounds.right &&
    current.y >= bounds.top &&
    current.y <= bounds.bottom;
  current.to = columnUnderPointer(current, track, bounds) ?? current.to;
  const column = track.children[current.to];
  if (!(column instanceof HTMLElement)) return;
  document
    .querySelectorAll('.board-drop-target,.board-drop-before')
    .forEach((element) => element.classList.remove('board-drop-target', 'board-drop-before'));
  column.classList.add('board-drop-target');
  const cards = [...column.querySelectorAll<HTMLElement>('[data-task-id]')].filter(
    (element) => element.dataset.taskId !== current.task.id,
  );
  const before = cards.find(
    (element) =>
      current.y < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
  );
  current.before = before?.dataset.taskId ?? null;
  before?.classList.add('board-drop-before');
  if (current.ghost) {
    current.ghost.style.left = `${Math.min(bounds.right - 230, Math.max(bounds.left + 5, current.x - 180))}px`;
    current.ghost.style.top = `${current.y - 28}px`;
  }
}
export function advanceDrag(
  current: Drag,
  track: HTMLDivElement,
  options: { statuses: { id: string }[]; go(index: number): void },
) {
  edgeStep(current, track, options);
  const list = track.children[current.to]?.querySelector('.board-cards');
  if (list instanceof HTMLElement) {
    const rect = list.getBoundingClientRect();
    if (current.y < rect.top + 44) list.scrollTop -= 9;
    else if (current.y > rect.bottom - 44) list.scrollTop += 9;
  }
  updateDrag(current, track);
}

/** A pointer held at the track edge moves on: by one column when wide, by one stage on a phone. */
function edgeStep(
  current: Drag,
  track: HTMLDivElement,
  options: { statuses: { id: string }[]; go(index: number): void },
) {
  const bounds = track.getBoundingClientRect();
  const direction = current.x < bounds.left + 44 ? -1 : current.x > bounds.right - 44 ? 1 : 0;
  if (!direction || !insideTrack(current, bounds) || Date.now() - current.lastEdge <= 700) return;
  if (wideTrack(track, bounds)) {
    // Several stages in view: scroll by one column; the pointer picks the stage.
    current.lastEdge = Date.now();
    track.scrollBy({ left: direction * columnStride(track), behavior: 'instant' });
    return;
  }
  const next = current.to + direction;
  if (next < 0 || next >= options.statuses.length) return;
  current.to = next;
  current.lastEdge = Date.now();
  options.go(next);
}

/** A column wholly inside the track, allowing for sub-pixel layout. */
export function fullyInside(element: Element, bounds: DOMRect) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
}

/** A wide screen shows several whole stages at once (QA F15); a phone shows one. */
function wideTrack(track: HTMLDivElement, bounds: DOMRect) {
  return [...track.children].filter((element) => fullyInside(element, bounds)).length > 1;
}

function columnStride(track: HTMLDivElement) {
  const first = track.children[0];
  const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
  return first instanceof HTMLElement ? first.getBoundingClientRect().width + gap : 0;
}

/**
 * On a wide screen the pointer picks the whole stage nearest to it, so a pointer in the gap
 * between two columns picks one of them. A phone keeps the stage the swipe or edge chose.
 */
function columnUnderPointer(current: Drag, track: HTMLDivElement, bounds: DOMRect) {
  if (!wideTrack(track, bounds)) return undefined;
  const partial = partialColumnUnderPointer(current, track, bounds);
  if (partial !== undefined) return partial;
  let best: { index: number; distance: number } | undefined;
  [...track.children].forEach((element, index) => {
    if (!fullyInside(element, bounds)) return;
    const rect = element.getBoundingClientRect();
    const distance = Math.max(rect.left - current.x, 0, current.x - rect.right);
    if (!best || distance < best.distance) best = { index, distance };
  });
  return best?.index;
}

/**
 * A column cut by the track edge is not loaded yet. A pointer over its visible part means that
 * stage, so it scrolls fully into view (and loads) instead of the drop going to its neighbour.
 */
function partialColumnUnderPointer(current: Drag, track: HTMLDivElement, bounds: DOMRect) {
  if (!insideTrack(current, bounds)) return undefined;
  const index = [...track.children].findIndex((element) => {
    const rect = element.getBoundingClientRect();
    return (
      !fullyInside(element, bounds) &&
      current.x >= Math.max(rect.left, bounds.left) &&
      current.x <= Math.min(rect.right, bounds.right)
    );
  });
  const column = track.children[index];
  if (!(column instanceof HTMLElement)) return undefined;
  column.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  return index;
}

function insideTrack(current: Drag, bounds: DOMRect) {
  return current.y >= bounds.top && current.y <= bounds.bottom;
}
