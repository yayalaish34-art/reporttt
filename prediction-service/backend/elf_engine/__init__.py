"""Deterministic ELF magnetic-field engine.

Pure on purpose: nothing in this package may touch a database, the network or an
LLM. `tests/test_boundaries.py` fails the build if an import says otherwise.
"""

from .constants import ENGINE_VERSION
from .exposure import NormalizedExposure, calculate_normalized_exposure
from .field import Combination, FieldResult, compute_field
from .grid import room_grid
from .serialization import source_from_dict, sources_from_dicts
from .sources import (
    Arrangement,
    BusbarSource,
    ConductorSource,
    EmpiricalSource,
    ThreePhaseCircuit,
)
from .units import Converted, mg_to_ut, to_mg, ut_to_mg

__all__ = [
    "ENGINE_VERSION",
    "Arrangement",
    "BusbarSource",
    "Combination",
    "ConductorSource",
    "Converted",
    "EmpiricalSource",
    "FieldResult",
    "NormalizedExposure",
    "ThreePhaseCircuit",
    "calculate_normalized_exposure",
    "compute_field",
    "mg_to_ut",
    "room_grid",
    "source_from_dict",
    "sources_from_dicts",
    "to_mg",
    "ut_to_mg",
]
