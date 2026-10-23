import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { TaskResource } from '../../../src/schema/tasks.js';
import type { MoveRequest } from './use-board-move.js';
import { advanceDrag, updateDrag, type Drag } from './board-drag.js';
export function useBoardDrag(options: {
  track: RefObject<HTMLDivElement | null>;
  statuses: { id: string }[];
  go(index: number): void;
  propose(move: MoveRequest): void;
  allowed(): boolean;
}) {
  const drag = useRef<Drag | null>(null);
  const suppressUntil = useRef(0);
  const [active, setActive] = useState(false);
  function cleanup() {
    const current = drag.current;
    if (!current) return null;
    if (current.active) suppressUntil.current = Date.now() + 500;
    clearDragVisual(current);
    drag.current = null;
    setActive(false);
    return current;
  }
  function update() {
    const current = drag.current;
    const track = options.track.current;
    if (current?.active && track) updateDrag(current, track);
  }
  function tick() {
    const current = drag.current;
    const track = options.track.current;
    if (current?.active && track) advanceDrag(current, track, options);
  }
  function activate() {
    const current = drag.current;
    if (!current || !options.allowed()) return;
    current.active = true;
    const ghost = document.createElement('div');
    ghost.className = 'board-drag-ghost';
    ghost.textContent = `${current.task.emoji} ${current.task.title}`;
    ghost.setAttribute('aria-hidden', 'true');
    document.body.append(ghost);
    current.ghost = ghost;
    current.handle.closest('[data-task-id]')?.classList.add('board-drag-source');
    current.tick = setInterval(tick, 50);
    setActive(true);
    update();
  }
  function move(event: globalThis.PointerEvent) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) > 8) {
      cleanup();
      return;
    }
    if (current.active) {
      event.preventDefault();
      update();
    }
  }
  function end(event: globalThis.PointerEvent) {
    if (event.pointerId !== drag.current?.pointer) return;
    const current = cleanup();
    if (!current?.active || !options.allowed()) return;
    suppressUntil.current = Date.now() + 500;
    const target = options.statuses[current.to];
    if (target && current.valid)
      options.propose({ task: current.task, to: target.id, before: current.before });
  }
  useDragListeners(move, end, cleanup);

  useEffect(
    () => () => {
      const current = drag.current;
      if (current) {
        clearTimeout(current.timer);
        clearInterval(current.tick);
        current.ghost?.remove();
      }
    },
    [],
  );
  function start(event: PointerEvent<HTMLButtonElement>, task: TaskResource) {
    if (event.button !== 0 || drag.current || !options.allowed()) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      task,
      pointer: event.pointerId,
      handle: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      to: options.statuses.findIndex((status) => status.id === task.status_id),
      active: false,
      valid: false,
      before: null,
      lastEdge: Date.now(),
      timer: setTimeout(activate, 350),
    };
  }
  return { active, start, clickAllowed: () => Date.now() >= suppressUntil.current };
}

function clearDragVisual(current: Drag) {
  clearTimeout(current.timer);
  clearInterval(current.tick);
  current.ghost?.remove();
  if (current.handle.hasPointerCapture(current.pointer))
    current.handle.releasePointerCapture(current.pointer);
  document
    .querySelectorAll('.board-drop-target,.board-drop-before,.board-drag-source')
    .forEach((element) =>
      element.classList.remove('board-drop-target', 'board-drop-before', 'board-drag-source'),
    );
}

function useDragListeners(
  move: (event: globalThis.PointerEvent) => void,
  end: (event: globalThis.PointerEvent) => void,
  cleanup: () => Drag | null,
) {
  useEffect(() => {
    const cancel = () => cleanup();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cleanup();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape);
    };
  });
}
