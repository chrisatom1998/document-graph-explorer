"""Shipping bars for sound tags, copied from the app rather than restated from memory.

Full head (SOUND_TAG_BAR in src/audio/confidentSoundSummary.ts, FULL in
scripts/head-scorecard.py and scripts/add-maybe-heads.py, since 2026-10-10):
held-out precision AND recall >= 0.50. It was 0.60 from 2026-10-05 and 0.70 before that.

Maybe head (head-scorecard.py): the lower of precision and recall is >= 0.45.
scripts/dj-effects/ship.py uses the same 0.50 full bar, and drops a head when
precision < 0.45 or recall < 0.30.

Tagger `tested` flag (src/audio/tagger.ts, since 2026-10-11): precision >= 0.60
and recall >= 0.30 on each fresh set with 5+ positives, and at most 1% false
alarms on a set with fewer than 5 positives and 50+ negatives. That flag is what
shows a tagger tag as a normal tag. 60/60 and 70/70 are still reported
(scripts/audio-model/clean-heads/fair-judge.py) and are not the ship gate.

Character adjectives in STAY_MAYBE stay faded heads even when a score clears
0.50 (src/audio/soundTagBar.test.ts). The nine DSP words in RULE_WORDS are not
model tags at all (src/audio/timbreDescriptions.ts).
"""
from __future__ import annotations

FULL_PRECISION = 0.50
FULL_RECALL = 0.50
MAYBE_FLOOR = 0.45
# ship.py also refuses a head whose recall is under this, even when precision clears the maybe floor.
EFFECT_MIN_RECALL = 0.30
TAGGER_PRECISION = 0.60
TAGGER_RECALL = 0.30
# Reported by the clean-head judge. Not what the app uses to show a normal tag.
REPORT_60 = 0.60

# soundTagBar.test.ts STILL_MAYBE. glassy is also one of the nine DSP words.
STAY_MAYBE = frozenset({
    'bright', 'dark', 'glassy', 'percussive', 'pulsing', 'swelling', 'wobbling',
    'noise sweep', 'filter sweep',
})
# timbreDescriptions.ts RULE_DESCRIBED_LABELS.
RULE_WORDS = frozenset({
    'warm', 'airy', 'metallic', 'gritty', 'smooth', 'hollow', 'nasal', 'woody', 'glassy',
})


def lower(precision: float | None, recall: float | None) -> float | None:
    if precision is None or recall is None:
        return None
    return min(precision, recall)


def meets_full(precision: float | None, recall: float | None) -> bool:
    """Head full-tag bar: both numbers at or above 0.50."""
    return precision is not None and recall is not None and precision >= FULL_PRECISION and recall >= FULL_RECALL


def meets_maybe(precision: float | None, recall: float | None) -> bool:
    """Maybe floor from head-scorecard: the lower number is at least 0.45."""
    low = lower(precision, recall)
    return low is not None and low >= MAYBE_FLOOR


def meets_tagger_ship(precision: float | None, recall: float | None) -> bool:
    """One set's half of the tagger 60/30 line. The false-alarm cap is separate."""
    return precision is not None and recall is not None and precision >= TAGGER_PRECISION and recall >= TAGGER_RECALL


def meets_60(precision: float | None, recall: float | None) -> bool:
    return precision is not None and recall is not None and precision >= REPORT_60 and recall >= REPORT_60


def head_tier(precision: float | None, recall: float | None, label: str) -> str:
    """full, maybe, below-maybe, character-maybe, or unmeasured."""
    if label in STAY_MAYBE or label in RULE_WORDS:
        if precision is None or recall is None:
            return 'character-maybe' if label in STAY_MAYBE else 'dsp'
        return 'character-maybe'
    if precision is None or recall is None:
        return 'unmeasured'
    if meets_full(precision, recall):
        return 'full'
    if meets_maybe(precision, recall):
        return 'maybe'
    return 'below-maybe'


def binding(sets: list[dict]) -> dict | None:
    """Weakest set that can actually score precision and recall.

    A set needs both numbers. Fewer than 5 positives does not decide. A set with
    fewer than 5 negatives does not decide either: precision there is not a check
    (an untagged or positives-only slice). When every set lacks negatives, the
    weakest positives-only slice is returned so the miss is not dropped.
    """
    both = [s for s in sets if s.get('precision') is not None and s.get('recall') is not None]
    sized = [s for s in both if (s.get('positives') or 0) >= 5 and (s.get('negatives') or 0) >= 5]
    pool = sized or [s for s in both if (s.get('positives') or 0) >= 5] or both
    if not pool:
        return None
    return min(pool, key=lambda s: min(s['precision'], s['recall']))
