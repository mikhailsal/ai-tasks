import { Button } from './Button.js';

export function CacheMiss({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const missing = error instanceof Error && 'code' in error && error.code === 'CACHE_MISS';
  if (!missing) return null;
  return (
    <section className="panel stack" aria-label="Нет сохранённых данных">
      <p role="alert">
        Эта страница не сохранена для работы без сети. Откройте её при подключении.
      </p>
      <p>
        Сохранённые черновики хранятся отдельно. Очистка хранилища браузера может удалить снимки.
      </p>
      {onRetry && <Button onClick={onRetry}>Повторить загрузку</Button>}
    </section>
  );
}
