import { useState } from 'react';
import type { Advisory } from '../../../src/schema/advisories.js';
import { viewTime } from '../data/view-format.js';
import { Button } from './Button.js';

const VISIBLE = 2;

/** Advisories for one item, or the list-wide ones when `subjectId` is left out (spec 010 R4). */
export function itemAdvisories(advisories: readonly Advisory[], subjectId?: string): Advisory[] {
  return advisories.filter((advisory) =>
    subjectId === undefined ? advisory.subject === undefined : advisory.subject?.id === subjectId,
  );
}

/**
 * A neutral note, never an error: explanation first, remedy second. At most two show; the rest
 * open behind «ещё N». The check time shows that a cached notice may no longer be current.
 */
export function AdvisoryNotice({
  advisories,
  checkedAt,
  timezone,
}: {
  advisories: readonly Advisory[];
  checkedAt?: string | undefined;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  if (advisories.length === 0) return null;
  const shown = open ? advisories : advisories.slice(0, VISIBLE);
  const hidden = advisories.length - shown.length;
  return (
    <aside className="advisory-notice" aria-label="Обратите внимание">
      {shown.map((advisory) => (
        <div key={`${advisory.code}:${advisory.subject?.id ?? 'all'}`} className="advisory-item">
          <p>
            {advisory.message}
            {advisory.count === undefined ? '' : ` (${String(advisory.count)})`}
          </p>
          <p className="subtle">{advisory.remedy.text}</p>
        </div>
      ))}
      {hidden > 0 && <Button onClick={() => setOpen(true)}>ещё {hidden}</Button>}
      {checkedAt && <p className="subtle">По данным на {viewTime(checkedAt, timezone)}</p>}
    </aside>
  );
}
