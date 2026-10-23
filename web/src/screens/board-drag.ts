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
  const bounds = track.getBoundingClientRect();
  const direction = current.x < bounds.left + 44 ? -1 : current.x > bounds.right - 44 ? 1 : 0;
  const next = current.to + direction;
  if (
    insideTrack(current, bounds) &&
    direction &&
    next >= 0 &&
    next < options.statuses.length &&
    Date.now() - current.lastEdge > 700
  ) {
    current.to = next;
    current.lastEdge = Date.now();
    options.go(next);
  }
  const list = track.children[current.to]?.querySelector('.board-cards');
  if (list instanceof HTMLElement) {
    const rect = list.getBoundingClientRect();
    if (current.y < rect.top + 44) list.scrollTop -= 9;
    else if (current.y > rect.bottom - 44) list.scrollTop += 9;
  }
  updateDrag(current, track);
}

function insideTrack(current: Drag, bounds: DOMRect) {
  return current.y >= bounds.top && current.y <= bounds.bottom;
}
