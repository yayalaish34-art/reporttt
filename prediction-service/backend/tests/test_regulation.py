"""Test 10 and the rules around it. Thresholds here are arbitrary fixtures, not criteria."""

from datetime import date

import pytest

from elf_regulation import FAIL, PASS, REVIEW_REQUIRED, RoomContext, Rule, applicable_rules, evaluate_room


def rule(**overrides):
    base = dict(
        id="r1",
        country="IL",
        document_name="DOC",
        document_version="1",
        effective_date=date(2020, 1, 1),
        frequency_hz=50.0,
        occupancy_type="CONTINUOUS_OCCUPANCY",
        building_types=("Office",),
        threshold=100.0,
        threshold_type="INSTANTANEOUS_MAX",
        averaging_hours=None,
        active=True,
        verified=True,
    )
    return Rule(**{**base, **overrides})


def context(**overrides):
    base = dict(
        country="IL",
        building_type="Office",
        occupancy_type="CONTINUOUS_OCCUPANCY",
        occupancy_confirmed=True,
        occupancy_hours=8.0,
        evaluation_date=date(2026, 1, 1),
    )
    return RoomContext(**{**base, **overrides})


# Test 10
def test_versioning_picks_the_version_in_force_on_the_date():
    old = rule(id="v1", document_version="1", effective_date=date(2020, 1, 1), threshold=100.0)
    new = rule(id="v2", document_version="2", effective_date=date(2025, 1, 1), threshold=50.0)
    assert [r.id for r in applicable_rules([old, new], context(evaluation_date=date(2026, 1, 1)))] == ["v2"]
    assert [r.id for r in applicable_rules([old, new], context(evaluation_date=date(2024, 1, 1)))] == ["v1"]
    assert evaluate_room(70.0, [old, new], context(evaluation_date=date(2024, 1, 1))).status == PASS
    assert evaluate_room(70.0, [old, new], context(evaluation_date=date(2026, 1, 1))).status == FAIL


def test_superseded_rule_stops_applying():
    retired = rule(superseded_at=date(2025, 6, 1))
    assert applicable_rules([retired], context(evaluation_date=date(2025, 1, 1)))
    assert not applicable_rules([retired], context(evaluation_date=date(2026, 1, 1)))


def test_no_rule_means_review_required_never_a_pass():
    assert evaluate_room(0.01, [], context()).status == REVIEW_REQUIRED


def test_inactive_or_unverified_rules_are_ignored():
    assert evaluate_room(1.0, [rule(active=False)], context()).status == REVIEW_REQUIRED
    assert evaluate_room(1.0, [rule(verified=False)], context()).status == REVIEW_REQUIRED


def test_unconfirmed_occupancy_is_review_required():
    assert evaluate_room(1.0, [rule()], context(occupancy_confirmed=False)).status == REVIEW_REQUIRED


def test_rule_for_other_building_type_does_not_apply():
    assert evaluate_room(1.0, [rule(building_types=("School",))], context()).status == REVIEW_REQUIRED


def test_time_averaged_rule_compares_the_normalized_value():
    averaged = rule(threshold_type="TIME_AVERAGED", averaging_hours=24.0, threshold=4.0)
    evaluation = evaluate_room(9.0, [averaged], context(occupancy_hours=8.0))
    assert evaluation.status == PASS
    assert evaluation.checks[0]["compared_mg"] == 3.0
    assert evaluation.checks[0]["normalization"]["normalization_method"] == "TIME_WEIGHTED_LINEAR"
    assert evaluate_room(15.0, [averaged], context(occupancy_hours=8.0)).status == FAIL


def test_time_averaged_rule_without_hours_is_review_required():
    averaged = rule(threshold_type="TIME_AVERAGED", averaging_hours=24.0, threshold=4.0)
    assert evaluate_room(1.0, [averaged], context(occupancy_hours=None)).status == REVIEW_REQUIRED


def test_missing_hours_do_not_hide_an_exceeded_instantaneous_limit():
    averaged = rule(id="a", document_name="A", threshold_type="TIME_AVERAGED", averaging_hours=24.0, threshold=4.0)
    instant = rule(id="b", document_name="B", threshold=10.0)
    assert evaluate_room(50.0, [averaged, instant], context(occupancy_hours=None)).status == FAIL


def test_all_applicable_documents_must_pass():
    lenient = rule(id="a", document_name="A", threshold=100.0)
    strict = rule(id="b", document_name="B", threshold=10.0)
    evaluation = evaluate_room(50.0, [lenient, strict], context())
    assert evaluation.status == FAIL
    assert {c["rule_id"]: c["status"] for c in evaluation.checks} == {"a": PASS, "b": FAIL}


def test_the_guideline_averages_with_a_1_mg_background():
    """(B·T + 1·(24−T)) / 24: the field allowed beside an installation is 72/T + 1."""
    from elf_engine.exposure import calculate_normalized_exposure

    for hours, allowed in [(1, 73), (4, 19), (8, 10), (24, 4)]:
        at_limit = calculate_normalized_exposure(allowed, hours, 24, background_mg=1.0)
        assert at_limit.normalized_field_mg == pytest.approx(4.0)
    nobody_there = calculate_normalized_exposure(500, 0, 24, background_mg=1.0)
    assert nobody_there.normalized_field_mg == pytest.approx(1.0)
