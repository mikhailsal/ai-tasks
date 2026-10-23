import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaEnvelopeSchema, type MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { AppNavigation } from '../components/AppNavigation.js';
import { CacheMiss } from '../components/CacheMiss.js';
import { OfflineBanner } from '../components/OfflineBanner.js';
import { BackButton } from '../components/BackButton.js';
import { getApi } from '../data/api.js';
import { ProjectBoard } from '../screens/ProjectBoard.js';
import { Projects } from '../screens/Projects.js';
import { TaskDetail } from '../screens/TaskDetail.js';
import { Tasks } from '../screens/Tasks.js';
import { ProjectConfiguration } from '../screens/ProjectConfiguration.js';
import { Audit } from '../screens/Audit.js';
import { Settings } from '../screens/Settings.js';
import { Agenda } from '../screens/Agenda.js';
import { Priorities } from '../screens/Priorities.js';
import { Workload } from '../screens/Workload.js';
import { Backups } from '../screens/Backups.js';
import { MutationBoundary } from './MutationBoundary.js';
import { AppLink, useRoute } from './router.js';

type Route = ReturnType<typeof useRoute>;
function routeTitle(route: Route): string {
  switch (route.kind) {
    case 'projects':
      return 'Проекты';
    case 'project':
      return 'Проект';
    case 'project-board':
      return 'Доска проекта';
    case 'project-configuration':
      return 'Настройки проекта';
    case 'task-new':
      return 'Новая задача';
    case 'task':
      return 'Задача';
    case 'tasks':
      return 'Задачи';
    case 'audit':
      return 'История изменений';
    case 'agenda':
      return 'План';
    case 'priorities':
      return 'Приоритеты';
    case 'workload':
      return 'Нагрузка';
    case 'settings':
      return 'Настройки приложения';
    case 'backups':
      return 'Резервные копии';
    case 'not-found':
      return 'Страница не найдена';
  }
}

function Screen({
  route,
  metadata,
}: {
  route: Exclude<Route, { kind: 'backups' }>;
  metadata: MetaData;
}) {
  switch (route.kind) {
    case 'projects':
      return <Projects metadata={metadata} />;
    case 'project-board':
      return (
        <ProjectBoard
          key={route.projectSlug}
          slug={route.projectSlug}
          search={route.search}
          metadata={metadata}
        />
      );
    case 'project':
      return <Projects key={route.projectSlug} slug={route.projectSlug} metadata={metadata} />;
    case 'project-configuration':
      return (
        <ProjectConfiguration
          key={route.projectSlug}
          projectSlug={route.projectSlug}
          metadata={metadata}
        />
      );
    case 'task-new':
      return (
        <TaskDetail
          key={`${route.projectSlug}:new`}
          projectSlug={route.projectSlug}
          metadata={metadata}
        />
      );
    case 'task':
      return (
        <TaskDetail
          key={route.taskId}
          projectSlug={route.projectSlug}
          taskId={route.taskId}
          metadata={metadata}
        />
      );
    case 'tasks':
      return <Tasks metadata={metadata} />;
    case 'audit':
      return <Audit key={route.search} search={route.search} timezone={metadata.timezone} />;
    case 'agenda':
      return <Agenda key={route.search} search={route.search} />;
    case 'priorities':
      return <Priorities key={route.search} search={route.search} />;
    case 'workload':
      return <Workload key={route.search} search={route.search} />;
    case 'settings': {
      const projectSlug = new URLSearchParams(route.search).get('project_slug');
      return (
        <Settings
          key={route.search}
          metadata={metadata}
          {...(projectSlug === null ? {} : { projectSlug })}
        />
      );
    }
    case 'not-found':
      return (
        <section>
          <h1>Страница не найдена</h1>
          <p>Такой страницы нет. Вернитесь к своим задачам.</p>
          <AppLink href="/">К задачам</AppLink>
        </section>
      );
  }
}

function shellPresentation(route: Route) {
  const board = route.kind === 'project-board';
  const detail = route.kind === 'task' || route.kind === 'task-new';
  return {
    header: `app-header${board ? ' board-app-header' : ''}${detail ? ' detail-app-header' : ''}`,
    main: board ? 'board-main' : detail ? 'task-main' : undefined,
    footer: !board && !detail,
  };
}

export function App() {
  const route = useRoute();
  const metadata = useQuery({
    queryKey: ['application-meta'],
    queryFn: ({ signal }) => getApi('/meta?all_projects=true', metaEnvelopeSchema, signal),
    retry: false,
  });
  const title = routeTitle(route);
  const shell = shellPresentation(route);
  useEffect(() => {
    document.title = `${title} · Мои задачи`;
  }, [title]);
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className={shell.header}>
        {route.kind !== 'projects' &&
          route.kind !== 'project-board' &&
          route.kind !== 'task' &&
          route.kind !== 'task-new' && (
            <BackButton
              fallback={
                'projectSlug' in route
                  ? `/projects/${encodeURIComponent(route.projectSlug)}/board`
                  : '/'
              }
            />
          )}
        <AppLink className="app-brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            ✓
          </span>
          Мои задачи
        </AppLink>
        <AppNavigation path={window.location.pathname + window.location.search} />
      </header>
      <main id="main" tabIndex={-1} className={shell.main}>
        {route.kind !== 'project-board' && (
          <OfflineBanner quiet={route.kind === 'task' || route.kind === 'task-new'} />
        )}
        <MutationBoundary {...(metadata.data ? { epoch: metadata.data.data.database_epoch } : {})}>
          {route.kind === 'backups' ? (
            <Backups {...(metadata.data ? { metadata: metadata.data.data } : {})} />
          ) : metadata.data ? (
            <Screen route={route} metadata={metadata.data.data} />
          ) : (
            <>
              <h1>{title}</h1>
              {metadata.isError || metadata.fetchStatus === 'paused' ? (
                <section className="panel connection-error" aria-labelledby="connection-title">
                  <h2 id="connection-title">Нет соединения</h2>
                  <CacheMiss error={metadata.error} />
                  <p role="alert">
                    Не удалось загрузить данные. Проверьте подключение и попробуйте ещё раз.
                  </p>
                  <Button disabled={metadata.isFetching} onClick={() => void metadata.refetch()}>
                    Попробовать снова
                  </Button>
                </section>
              ) : (
                <p role="status">Подключаемся…</p>
              )}
            </>
          )}
        </MutationBoundary>
      </main>
    </>
  );
}
