import { AppLink } from '../app/router.js';
import { Button } from '../components/Button.js';
import { boardReturnHref } from '../data/board-links.js';
import type { TaskFields, TaskPage } from './task-model.js';

export function TaskDetailHeader({
  page,
  kind,
  onActions,
}: {
  page: TaskPage;
  kind: TaskFields['kind'];
  onActions: () => void;
}) {
  return (
    <header className="task-detail-header">
      <AppLink
        href={boardReturnHref(page.project.slug, kind)}
        label="Назад на доску проекта"
        className="task-detail-back"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m14 6-6 6 6 6" />
        </svg>
      </AppLink>
      <span className="task-detail-project">{page.project.name}</span>
      <Button
        variant="ghost"
        className="task-detail-more"
        aria-label="Действия с задачей"
        disabled={!page.task}
        onClick={onActions}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </Button>
    </header>
  );
}
