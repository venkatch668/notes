"""The weekly retro.

The division of labour here is the whole design:

  * **Postgres owns the numbers.** Tasks done, minutes logged, goals hit — all
    counted, never estimated. A retrospection tool whose figures drift is worse
    than none, because you would act on it.
  * **Gemini owns the prose.** It reads the counted facts plus the user's own
    daily reflections and writes what they mean. It is not asked to compute,
    and it never sees a tool that could write.

Goal scoring is deliberately not a model call at all: `actual_min` comes
straight from the focus-timer totals for that tag.
"""

from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import analytics as analytics_repo
from app.repositories import retro as repo
from app.services import ai
from app.services.workspace import utcnow


def week_end_of(week_start: Date) -> Date:
    return week_start + timedelta(days=6)


def score_goals(goals: list[dict], focus: dict[str, int]) -> list[dict]:
    """Actual-vs-target for each goal, from counted minutes only.

    A goal with no tag cannot be measured automatically, so it is scored zero
    and shown as unmeasured rather than quietly dropped — the user still wrote
    it down, and it still belongs in the review.
    """
    return [
        {
            "text": goal.get("text", ""),
            "tag": goal.get("tag"),
            "targetMin": int(goal.get("targetMin") or 0),
            "actualMin": int(focus.get(goal.get("tag") or "", 0)),
        }
        for goal in goals
    ]


def _bullets(rows: list[dict], limit: int) -> list[str]:
    out = []
    for row in rows[:limit]:
        when = row.get("date")
        text = (row.get("text") or "").strip()
        if text:
            out.append(f"{when}: {text}")
    return out


def build_prompt(
    week_start: Date,
    stats: dict,
    material: dict,
    focus: dict[str, int],
    reflections: list,
    previous_goals: list[dict],
) -> str:
    """Assemble every fact the model is allowed to use, and nothing else."""
    lines: list[str] = [
        f"Write a weekly retrospective for the week starting {week_start}.",
        "",
        "COUNTED FACTS (use these exactly; do not recompute):",
        f"- Tasks completed: {stats['tasks_done']} of {stats['tasks_total']}",
        f"- High-priority completed: {stats['high_priority_done']}",
        f"- Carried forward: {stats['carried_forward']}",
        f"- Focus logged: {stats['actual_min']} min against {stats['estimate_min']} min estimated",
    ]

    if focus:
        split = ", ".join(f"#{tag} {mins}min" for tag, mins in list(focus.items())[:8])
        lines.append(f"- Focus minutes by tag: {split}")

    if previous_goals:
        lines.append("")
        lines.append("GOALS THEY SET FOR THIS WEEK, with what actually happened:")
        for scored in score_goals(previous_goals, focus):
            tag = f"#{scored['tag']}" if scored["tag"] else "untagged"
            lines.append(
                f"- {scored['text']} ({tag}): {scored['actualMin']} min "
                f"of {scored['targetMin']} min targeted"
            )

    if material["done"]:
        lines += ["", "COMPLETED WORK:"] + [f"- {b}" for b in _bullets(material["done"], 25)]
    if material["stuck"]:
        lines += ["", "REPEATEDLY CARRIED (not finished):"] + [
            f"- {b} (carried {row.get('hops')}×)"
            for b, row in zip(_bullets(material["stuck"], 10), material["stuck"])
        ]
    if material["dropped"]:
        lines += ["", "ABANDONED:"] + [f"- {b}" for b in _bullets(material["dropped"], 10)]

    if reflections:
        lines += ["", "THEIR OWN WORDS, DAY BY DAY:"]
        for r in reflections:
            parts = [p for p in (r.intent, r.went_well, r.blockers) if p]
            if parts:
                lines.append(f"- {r.date}: " + " | ".join(parts))

    lines += [
        "",
        "narrative: 3-5 short paragraphs, second person, direct. Say where the",
        "  week actually went, whether it matched what they said they wanted, and",
        "  name the one thing most worth changing. No praise padding.",
        "highlights: up to 5 items, the work genuinely worth remembering.",
        "dropped: up to 5 items, what quietly fell off and appears to have been",
        "  abandoned rather than finished.",
        "",
        "If the data is thin, say the week is thinly recorded rather than",
        "inventing detail.",
    ]
    return "\n".join(lines)


# Enforced by the API rather than requested in the prompt, so the reply cannot
# come back fenced, prefixed with prose, or missing a key.
RETRO_SCHEMA = {
    "type": "object",
    "properties": {
        "narrative": {"type": "string"},
        "highlights": {"type": "array", "items": {"type": "string"}},
        "dropped": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["narrative", "highlights", "dropped"],
}


async def generate_weekly(
    session: AsyncSession, user_id: uuid.UUID, week_start: Date
) -> dict:
    """Build the retro for a week and persist it.

    Idempotent per (user, week): regenerating overwrites the narrative and
    keeps the goals, because goals are a commitment the user made and not
    something a regeneration is entitled to discard.
    """
    week_end = week_end_of(week_start)

    stats = await analytics_repo.weekly_stats(session, user_id, week_start, week_end)
    material = await analytics_repo.week_material(session, user_id, week_start, week_end)
    focus = await analytics_repo.focus_by_tag(session, user_id, week_start, week_end)
    reflections = await repo.list_reflections(session, user_id, week_start, week_end)

    # Goals for this week were set at the close of the previous one.
    previous = await repo.get_week_summary(session, user_id, week_start - timedelta(days=7))
    previous_goals = list(previous.goals) if previous else []

    prompt = build_prompt(week_start, stats, material, focus, reflections, previous_goals)
    parsed = await ai.generate_json(prompt, RETRO_SCHEMA)

    if isinstance(parsed, dict):
        narrative = str(parsed.get("narrative") or "").strip()
        highlights = [str(h) for h in (parsed.get("highlights") or [])][:5]
        dropped = [str(d) for d in (parsed.get("dropped") or [])][:5]
    else:
        # Should not happen now the schema is enforced, but a retro that says
        # so is better than one that stores a JSON blob as its narrative and
        # renders it to the user verbatim.
        narrative = ""
        highlights = []
        dropped = []

    values = {
        "narrative": narrative,
        "highlights": highlights,
        "dropped": dropped,
        "focus_by_tag": focus,
        "goal_scores": score_goals(previous_goals, focus),
        "generated_at": utcnow(),
    }
    summary = await repo.save_week_summary(session, user_id, week_start, values)
    return summary
