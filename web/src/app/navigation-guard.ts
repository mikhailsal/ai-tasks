const guards = new Set<() => boolean>();
const listeners = new Set<() => void>();
const message = 'Есть несохранённые изменения. Уйти со страницы?';
let permitted = false;
let initialized = false;
let restoring = false;
let approvedBack = false;
let current = { href: '', index: 0, state: {} };

function path() {
  return window.location.pathname + window.location.search;
}

function stateIndex(state: unknown): number | undefined {
  if (state && typeof state === 'object' && 'aiTasksIndex' in state) {
    const index = state.aiTasksIndex;
    if (typeof index === 'number' && Number.isSafeInteger(index)) return index;
  }
  return undefined;
}

function markedState(state: unknown, index: number) {
  return { ...(state && typeof state === 'object' ? state : {}), aiTasksIndex: index };
}

export function hasUnsavedChanges() {
  return [...guards].some((guard) => guard());
}

export function registerUnsavedChanges(guard: () => boolean) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function requestNavigation(action: () => void) {
  if (!permitted && hasUnsavedChanges() && !window.confirm(message)) return;
  const previous = permitted;
  permitted = true;
  try {
    action();
  } finally {
    permitted = previous;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function onPopState() {
  const href = path();
  const state: unknown = window.history.state;
  const index = stateIndex(state);
  if (restoring) {
    restoring = false;
    return;
  }
  const approved = approvedBack;
  approvedBack = false;
  if (href !== current.href && !approved && hasUnsavedChanges() && !window.confirm(message)) {
    if (index !== undefined && index !== current.index) {
      restoring = true;
      window.history.go(current.index - index);
    } else {
      window.history.pushState(current.state, '', current.href);
    }
    return;
  }
  const nextIndex = index ?? current.index + 1;
  const nextState = markedState(state, nextIndex);
  window.history.replaceState(nextState, '', href);
  current = { href, index: nextIndex, state: nextState };
  emit();
}

function initialize() {
  if (initialized) return;
  initialized = true;
  const state: unknown = window.history.state;
  const index = stateIndex(state) ?? 0;
  const marked = markedState(state, index);
  current = { href: path(), index, state: marked };
  window.history.replaceState(marked, '', current.href);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedChanges()) event.preventDefault();
  });
}

export function subscribeToNavigation(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function changeRoute(href: string, replace = false) {
  initialize();
  requestNavigation(() => {
    const index = current.index + (replace ? 0 : 1);
    const state = replace
      ? markedState(current.state, index)
      : { previous: current.href, aiTasksIndex: index };
    if (replace) window.history.replaceState(state, '', href);
    else window.history.pushState(state, '', href);
    current = { href, index, state };
    emit();
  });
}

export function goBack() {
  requestNavigation(() => {
    approvedBack = true;
    window.history.back();
  });
}
