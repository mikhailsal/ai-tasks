import { AppLink } from '../app/router.js';
import { Button } from './Button.js';

export function AddTaskButton({
  projectSlug,
  disabled,
}: {
  projectSlug?: string;
  disabled: boolean;
}) {
  if (disabled)
    return (
      <Button variant="primary" disabled>
        Добавить задачу
      </Button>
    );
  return (
    <AppLink
      className="button button-primary"
      href={
        projectSlug
          ? `/projects/${encodeURIComponent(projectSlug)}/tasks/new`
          : '/projects?new_task=true'
      }
    >
      Добавить задачу
    </AppLink>
  );
}
