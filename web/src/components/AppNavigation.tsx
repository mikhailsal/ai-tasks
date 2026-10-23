import { useEffect, useState } from 'react';
import { AppLink } from '../app/router.js';
import { Button } from './Button.js';
import { Modal } from './Modal.js';

const destinations = [
  ['/agenda?all_projects=true', 'План', 'Сроки и ближайшие дела'],
  ['/priorities?all_projects=true', 'Приоритеты', 'Что важнее в каждом проекте'],
  ['/workload?all_projects=true', 'Нагрузка', 'Задачи и повторения в цифрах'],
  ['/audit?all_projects=true', 'История', 'Изменения и решения'],
  ['/settings', 'Настройки приложения', 'Часовой пояс'],
  ['/backups', 'Резервные копии', 'Сохранение и восстановление'],
] as const;

export function AppNavigation({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [path]);
  function showMore() {
    setOpen(true);
  }
  const pathname = path.split('?')[0] ?? '';
  const tasks = pathname === '/tasks' || (pathname === '/' && path.includes('?'));
  const projects = pathname === '/' || pathname.startsWith('/projects');
  const secondary = !tasks && !projects;
  return (
    <>
      <nav className="bottom-nav" aria-label="Основная навигация">
        <AppLink href="/" active={projects}>
          <span aria-hidden="true" className="nav-symbol">
            ☷
          </span>
          <span data-nav-label>Проекты</span>
        </AppLink>
        <AppLink href="/tasks?all_projects=true" active={tasks}>
          <span aria-hidden="true" className="nav-symbol">
            ▦
          </span>
          <span data-nav-label>Обзор</span>
        </AppLink>
        <button
          type="button"
          onClick={showMore}
          aria-expanded={open}
          className={secondary ? 'nav-current' : undefined}
        >
          <span aria-hidden="true" className="nav-symbol">
            ···
          </span>
          <span data-nav-label>Ещё</span>
        </button>
      </nav>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        className="nav-menu"
        label="Другие разделы"
      >
        <div className="page-heading">
          <h2>Ещё</h2>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Закрыть
          </Button>
        </div>
        <div className="menu-links">
          {destinations.map(([href, label, hint]) => (
            <AppLink key={href} href={href} label={label}>
              <span>
                {label}
                <small>{hint}</small>
              </span>
              <span aria-hidden="true">↗</span>
            </AppLink>
          ))}
        </div>
      </Modal>
    </>
  );
}
