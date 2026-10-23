import { navigateBack } from '../app/router.js';
import { Button } from './Button.js';

export function BackButton({ fallback = '/' }: { fallback?: string }) {
  return (
    <Button
      variant="ghost"
      className="screen-back"
      aria-label="Назад"
      onClick={() => navigateBack(fallback)}
    >
      <span aria-hidden="true">‹</span> Назад
    </Button>
  );
}
