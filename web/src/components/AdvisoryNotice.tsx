import { useState } from 'react';
import type { Advisory } from '../../../src/schema/advisories.js';
import { viewMinute } from '../data/view-format.js';
import { advisoryText } from './advisory-text.js';
import { Button } from './Button.js';

const VISIBLE = 2;

/**
 * Advisories for one item, or the list-wide ones when `subjectId` is left out (spec 010 R4).
 * A project advisory (spec 011) concerns the whole list, so it is list-wide.
 */
export function itemAdvisories(advisories: readonly Advisory[], subjectId?: string): Advisory[] {
  return advisories.filter((advisory) =>
    subjectId === undefined
      ? advisory.subject === undefined || advisory.subject.type === 'project'
      : advisory.subject?.id === subjectId,
  );
}

/** One item's own advisories plus the project-wide ones, for a screen that shows one item. */
export function pageAdvisories(advisories: readonly Advisory[], subjectId?: string): Advisory[] {
  return advisories.filter(
    (advisory) => advisory.subject?.type === 'project' || advisory.subject?.id === subjectId,
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
  statusLabels,
}: {
  advisories: readonly Advisory[];
  checkedAt?: string | undefined;
  timezone: string;
  /** Status ids to display names, so a remedy names «Активно» rather than `active`. */
  statusLabels?: Readonly<Record<string, string>>;
}) {
  const [open, setOpen] = useState(false);
  if (advisories.length === 0) return null;
  const shown = open ? advisories : advisories.slice(0, VISIBLE);
  const hidden = advisories.length - shown.length;
  return (
    <aside className="advisory-notice" aria-label="Обратите внимание">
      {shown.map((advisory) => {
        const text = advisoryText(advisory, statusLabels);
        return (
          <div key={`${advisory.code}:${advisory.subject?.id ?? 'all'}`} className="advisory-item">
            <p>
              {text.message}
              {advisory.count === undefined ? '' : ` (${String(advisory.count)})`}
            </p>
            {text.remedy && <p className="subtle">{text.remedy}</p>}
          </div>
        );
      })}
      {hidden > 0 && <Button onClick={() => setOpen(true)}>ещё {hidden}</Button>}
      {checkedAt && <p className="subtle">По данным на {viewMinute(checkedAt, timezone)}</p>}
    </aside>
  );
}
