import { AppLink } from '../app/router.js';
import { Button } from '../components/Button.js';

/** A task that could not be loaded still offers a way on (QA F13), like the 404 page. */
export function TaskLoadFailure({
  message,
  projectSlug,
  onRetry,
}: {
  message: string;
  projectSlug: string;
  onRetry(): void;
}) {
  return (
    <section className="stack">
      <p role="alert">{message}</p>
      <nav aria-label="Куда перейти" className="stack">
        <AppLink href={`/projects/${encodeURIComponent(projectSlug)}`}>К проекту</AppLink>
        <AppLink href="/tasks?all_projects=true">К задачам</AppLink>
        <Button onClick={onRetry}>Повторить загрузку</Button>
      </nav>
    </section>
  );
}
