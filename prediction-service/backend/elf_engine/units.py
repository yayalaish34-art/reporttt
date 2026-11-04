"""Unit conversion. A converted value keeps what it was converted from."""

from dataclasses import dataclass

from .constants import UT_TO_MG

_TO_MG = {"mG": 1.0, "uT": UT_TO_MG, "µT": UT_TO_MG, "μT": UT_TO_MG}


@dataclass(frozen=True)
class Converted:
    original_value: float
    original_unit: str
    value_mg: float


def ut_to_mg(value_ut: float) -> float:
    return value_ut * UT_TO_MG


def mg_to_ut(value_mg: float) -> float:
    return value_mg / UT_TO_MG


def to_mg(value: float, unit: str) -> Converted:
    if unit not in _TO_MG:
        raise ValueError(f"Unsupported magnetic-field unit: {unit!r}")
    return Converted(original_value=value, original_unit=unit, value_mg=value * _TO_MG[unit])
