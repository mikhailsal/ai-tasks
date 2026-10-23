import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';

function queryScreenRoute(url: URL) {
  const pathname = url.pathname;
  if (pathname === '/audit') return { kind: 'audit', search: url.search } as const;
  if (pathname === '/agenda') return { kind: 'agenda', search: url.search } as const;
  if (pathname === '/priorities') return { kind: 'priorities', search: url.search } as const;
  if (pathname === '/workload') return { kind: 'workload', search: url.search } as const;
  if (pathname === '/settings') return { kind: 'settings', search: url.search } as const;
  if (pathname === '/backups') return { kind: 'backups', search: url.search } as const;
  return undefined;
}

function entryRoute(url: URL) {
  const pathname = url.pathname;
  if (
    pathname === '/' &&
    !url.searchParams.has('all_projects') &&
    !url.searchParams.has('project_slug')
  )
    return { kind: 'projects' } as const;
  if (pathname === '/' || pathname === '/tasks') return { kind: 'tasks' } as const;
  if (pathname === '/projects') return { kind: 'projects' } as const;
  return undefined;
}

export function routeForPath(path: string) {
  const url = new URL(path, 'http://local.invalid');
  const pathname = url.pathname;
  const entry = entryRoute(url);
  if (entry) return entry;
  const queryScreen = queryScreenRoute(url);
  if (queryScreen) return queryScreen;
  const task = /^\/projects\/([^/]+)\/tasks\/([^/]+)$/u.exec(pathname);
  const board = /^\/projects\/([^/]+)\/board$/u.exec(pathname);
  const project = /^\/projects\/([^/]+)$/u.exec(pathname);
  const configuration = /^\/projects\/([^/]+)\/configuration$/u.exec(pathname);
  try {
    if (board?.[1])
      return {
        kind: 'project-board',
        projectSlug: decodeURIComponent(board[1]),
        search: url.search,
      } as const;
    if (configuration?.[1])
      return {
        kind: 'project-configuration',
        projectSlug: decodeURIComponent(configuration[1]),
      } as const;
    if (task?.[1] && task[2]) {
      const projectSlug = decodeURIComponent(task[1]);
      return task[2] === 'new'
        ? ({ kind: 'task-new', projectSlug } as const)
        : ({ kind: 'task', projectSlug, taskId: decodeURIComponent(task[2]) } as const);
    }
    if (project?.[1])
      return { kind: 'project', projectSlug: decodeURIComponent(project[1]) } as const;
  } catch {
    return { kind: 'not-found' } as const;
  }
  return { kind: 'not-found' } as const;
}

function subscribeToNavigation(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

export function useRoute() {
  const path = useSyncExternalStore(
    subscribeToNavigation,
    () => window.location.pathname + window.location.search,
  );
  return routeForPath(path);
}

export function navigate(href: string): void {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error('Навигация доступна внутри приложения.');
  window.history.pushState(
    { previous: window.location.pathname + window.location.search },
    '',
    url.pathname + url.search,
  );
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateBack(fallback = '/'): void {
  const state: unknown = window.history.state;
  if (
    state &&
    typeof state === 'object' &&
    'previous' in state &&
    typeof state.previous === 'string'
  ) {
    const previous = new URL(state.previous, window.location.origin);
    if (previous.origin === window.location.origin && previous.href !== window.location.href) {
      window.history.back();
      return;
    }
  }
  navigate(fallback);
}

export function AppLink({
  href,
  children,
  className,
  label,
  active,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  label?: string;
  active?: boolean;
}) {
  useRoute();
  const target = new URL(href, window.location.origin);
  const current =
    target.pathname === window.location.pathname && target.search === window.location.search;
  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(href);
  }
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      onClick={follow}
      aria-current={(active ?? current) ? 'page' : undefined}
    >
      {children}
    </a>
  );
}
