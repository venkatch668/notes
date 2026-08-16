import { useEffect, useState } from 'react';
import type { Goal, WeeklyStats, WeekSummary } from '../types/models';
import { api } from '../api';
import { addDays, formatDuration, formatShort, startOfWeek, todayKey } from '../domain/dates';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** An empty row so there is always somewhere to type the next goal. */
const blankGoal = (): Goal => ({ text: '', tag: null, targetMin: 0 });

export function InsightsPanel() {
  const weekStart = startOfWeek(todayKey());

  const [stats, setStats] = useState<WeeklyStats | null>(null);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.weeklyStats(weekStart).then(setStats);
    api
      .getWeekSummary(weekStart)
      .then((s) => {
        setSummary(s);
        setGoals(s?.goals?.length ? s.goals : [blankGoal()]);
      })
      .catch(() => setGoals([blankGoal()]));
  }, [weekStart]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const next = await api.generateWeekSummary(weekStart);
      setSummary(next);
      // A regeneration must not discard goals already committed to.
      if (next.goals?.length) setGoals(next.goals);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const saveGoals = async () => {
    const cleaned = goals.filter((g) => g.text.trim());
    try {
      const next = await api.saveGoals(weekStart, cleaned);
      setSummary(next);
      setGoals(cleaned.length ? cleaned : [blankGoal()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setGoal = (index: number, patch: Partial<Goal>) => {
    setGoals((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  };

  if (!stats) {
    return (
      <aside className="aipanel">
        <div className="empty">Loading…</div>
      </aside>
    );
  }

  const pct = stats.tasksTotal ? Math.round((stats.tasksDone / stats.tasksTotal) * 100) : 0;
  const peak = Math.max(1, ...stats.perDay.map((d) => d.total));

  return (
    <aside className="aipanel" aria-label="Productivity insights">
      <div className="aipanel__head">
        <span>Week of {formatShort(stats.from)}</span>
        <button type="button" className="linkbtn" onClick={generate} disabled={generating}>
          {generating ? 'Writing…' : summary?.generatedAt ? 'Regenerate' : 'Write retro'}
        </button>
      </div>

      <div className="insights">
        {error && <div className="notice notice--error">{error}</div>}

        {/* The written retro leads: the numbers below are the evidence for it,
            not the point of the panel. */}
        {summary?.narrative && (
          <div className="retro">
            {summary.narrative.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            {summary.highlights.length > 0 && (
              <>
                <h4 className="retro__h4">Worth remembering</h4>
                <ul className="retro__list">
                  {summary.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </>
            )}
            {summary.dropped.length > 0 && (
              <>
                <h4 className="retro__h4">Quietly fell off</h4>
                <ul className="retro__list retro__list--muted">
                  {summary.dropped.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Goals set last week, scored against counted minutes. */}
        {summary && summary.goalScores.length > 0 && (
          <div className="goals">
            <h4 className="retro__h4">How last week&rsquo;s focus went</h4>
            {summary.goalScores.map((g, i) => {
              const target = g.targetMin || 0;
              const hit = target > 0 && g.actualMin >= target;
              const width = target > 0 ? Math.min(100, Math.round((g.actualMin / target) * 100)) : 0;
              return (
                <div className="goal" key={i}>
                  <div className="goal__row">
                    <span className="goal__text">{g.text}</span>
                    <span className={`goal__num ${hit ? 'is-hit' : ''}`}>
                      {target > 0
                        ? `${formatDuration(g.actualMin)} / ${formatDuration(target)}`
                        : 'not measurable'}
                    </span>
                  </div>
                  {target > 0 && (
                    <div className="goal__bar">
                      <div
                        className={`goal__fill ${hit ? 'is-hit' : ''}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
            <div className="stat__value">{Math.round(stats.actualMin / 60)}h</div>
            <div className="stat__label">
              Logged vs {Math.round(stats.estimateMin / 60)}h estimated
            </div>
          </div>
        </div>

        <div className="bars">
          {stats.perDay.map((d, i) => (
            <div className="bar" key={d.date} title={`${d.done} of ${d.total} on ${formatShort(d.date)}`}>
              <div className="bar__fill" style={{ height: `${Math.round((d.done / peak) * 100)}%` }} />
              <span className="bar__label">{DOW[i]}</span>
            </div>
          ))}
        </div>

        <div className="stat">
          <div className="stat__label" style={{ lineHeight: 1.6 }}>
            {stats.bestDay ? (
              <>
                Most productive day: <strong>{formatShort(stats.bestDay)}</strong>.<br />
              </>
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

        {/* Next week's commitment. A goal needs a tag to be measurable, which
            is stated plainly rather than silently scoring it zero. */}
        <div className="goals goals--edit">
          <h4 className="retro__h4">Focus for week of {formatShort(addDays(weekStart, 7))}</h4>
          {goals.map((g, i) => (
            <div className="goaledit" key={i}>
              <input
                className="form-control form-control-sm"
                placeholder="What matters next week?"
                value={g.text}
                onChange={(e) => setGoal(i, { text: e.target.value })}
              />
              <input
                className="form-control form-control-sm goaledit__tag"
                placeholder="#tag"
                value={g.tag ?? ''}
                onChange={(e) => setGoal(i, { tag: e.target.value.replace(/^#/, '') || null })}
              />
              <input
                className="form-control form-control-sm goaledit__target"
                type="number"
                min={0}
                step={30}
                placeholder="min"
                value={g.targetMin || ''}
                onChange={(e) => setGoal(i, { targetMin: Number(e.target.value) || 0 })}
              />
            </div>
          ))}
          <div className="goals__actions">
            {goals.length < 3 && (
              <button type="button" className="linkbtn" onClick={() => setGoals([...goals, blankGoal()])}>
                Add another
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={saveGoals}>
              Save focus
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
