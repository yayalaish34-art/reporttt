"""Regression over validation_cases/. A new case is a new folder, with no code change."""

import json
from pathlib import Path

import pytest

from elf_engine import Combination, compute_field, sources_from_dicts

CASES_DIR = Path(__file__).resolve().parents[2] / "validation_cases"
CASES = sorted(path for path in CASES_DIR.iterdir() if path.is_dir())


def _load(case: Path, name: str) -> dict:
    return json.loads((case / name).read_text(encoding="utf-8"))


def test_there_are_cases_to_run():
    assert CASES


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_golden_case(case):
    inputs = _load(case, "inputs.json")
    expected = _load(case, "expected_results.json")
    sources = sources_from_dicts(_load(case, "geometry.json")["sources"])
    result = compute_field(inputs["points"], sources, Combination(inputs["combination"]))
    assert result.total_mg.tolist() == pytest.approx(expected["predicted_mg"], rel=expected["relative_tolerance"])
    assert expected["provenance"] in ("ANALYTIC", "EXTERNAL_SOFTWARE", "FIELD_MEASUREMENT")
