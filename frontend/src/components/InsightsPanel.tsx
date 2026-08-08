import { useEffect, useState } from 'react';
import type { WeeklyStats } from '../types/models';
import { api } from '../api/localApi';
import { formatShort, startOfWeek, todayKey } from '../domain/dates';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function InsightsPanel() {
  const [stats, setStats] = useState<WeeklyStats | null>(null);

  useEffect(() => {
    api.weeklyStats(startOfWeek(todayKey())).then(setStats);
  }, []);

  if (!stats) return <aside className="aipanel"><div className="empty">Loading…</div></aside>;

  const pct = stats.tasksTotal ? Math.round((stats.tasksDone / stats.tasksTotal) * 100) : 0;
  const peak = Math.max(1, ...stats.perDay.map((d) => d.total));

  return (
    <aside className="aipanel" aria-label="Productivity insights">
      <div className="aipanel__head">
        <span>Week of {formatShort(stats.from)}</span>
      </div>

      <div className="insights">
        <div className="statgrid">
          <div className="stat">
            <div className="stat__value">
              {stats.tasksDone}/{stats.tasksTotal}
            </div>
            <div className="stat__label">Tasks completed ({pct}%)</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.highPriorityDone}</div>
            <div className="stat__label">High priority done</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.carriedForward}</div>
            <div className="stat__label">Carried forward</div>
          </div>
          <div className="stat">
            <div className="stat__value">
              {Math.round(stats.actualMin / 60)}h
            </div>
            <div className="stat__label">
              Logged vs {Math.round(stats.estimateMin / 60)}h estimated
            </div>
          </div>
        </div>

        <div className="bars">
          {stats.perDay.map((d, i) => (
            <div className="bar" key={d.date} title={`${d.done} of ${d.total} on ${formatShort(d.date)}`}>
              <div
                className="bar__fill"
                style={{ height: `${Math.round((d.done / peak) * 100)}%` }}
              />
              <span className="bar__label">{DOW[i]}</span>
            </div>
          ))}
        </div>

        <div className="stat">
          <div className="stat__label" style={{ lineHeight: 1.6 }}>
            {stats.bestDay ? (
              <>Most productive day: <strong>{formatShort(stats.bestDay)}</strong>.<br /></>
            ) : null}
            Professional vs personal entries: <strong>{stats.professional}</strong> /{' '}
            <strong>{stats.personal}</strong>.
            {stats.topTags.length > 0 && (
              <>
                <br />
                Main topics: {stats.topTags.map((t) => `#${t.tag}`).join(', ')}.
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
