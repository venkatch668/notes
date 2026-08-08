"""Query-parsing tests.

Parsing is pure, so it is tested directly without a database. These cases are
the query language's contract — the frontend types these strings, and a
regression here silently changes what search means.
"""

from __future__ import annotations

from datetime import date

from app.services.search import _extract_spans, parse_query
from app.repositories.search import START_SEL, STOP_SEL


def test_bare_terms():
    parsed = parse_query("kafka notification flow")
    assert parsed.terms == ["kafka", "notification", "flow"]
    assert parsed.tags == []
    assert parsed.is_task is None


def test_quoted_phrase_is_preserved():
    parsed = parse_query('"gem shop" release')
    assert '"gem shop"' in parsed.terms
    assert "release" in parsed.terms


def test_tag_filters():
    parsed = parse_query("tag:professional #meeting kafka")
    assert sorted(parsed.tags) == ["meeting", "professional"]
    assert parsed.terms == ["kafka"]


def test_is_pending_implies_task():
    parsed = parse_query("is:pending")
    assert parsed.is_task is True
    assert parsed.done is False


def test_is_done():
    parsed = parse_query("is:done")
    assert parsed.is_task is True
    assert parsed.done is True


def test_priority_and_dates():
    parsed = parse_query("priority:high after:2026-08-01 before:2026-08-31 architecture")
    assert parsed.priority == "high"
    assert parsed.date_from == date(2026, 8, 1)
    assert parsed.date_to == date(2026, 8, 31)
    assert parsed.terms == ["architecture"]


def test_invalid_priority_is_ignored_not_fatal():
    parsed = parse_query("priority:urgent")
    assert parsed.priority is None


def test_unknown_prefix_is_treated_as_text():
    """A colon in ordinary prose must not silently become a filter."""
    parsed = parse_query("note: remember the retry semantics")
    assert "note: remember" in " ".join(parsed.terms) or "note:" in parsed.terms[0]


def test_empty_query():
    parsed = parse_query("")
    assert parsed.terms == []
    assert parsed.text == ""


def test_extract_spans_converts_sentinels_to_offsets():
    marked = f"the {START_SEL}kafka{STOP_SEL} flow and {START_SEL}kafka{STOP_SEL} retries"
    snippet, spans = _extract_spans(marked)

    assert snippet == "the kafka flow and kafka retries"
    assert spans == [(4, 9), (19, 24)]
    for start, end in spans:
        assert snippet[start:end] == "kafka"


def test_extract_spans_without_matches():
    snippet, spans = _extract_spans("plain text")
    assert snippet == "plain text"
    assert spans == []
