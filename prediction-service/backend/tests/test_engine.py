"""The ten required tests, plus checks that protect the model's own assumptions.

Reference values are hand-derived from the closed forms, not read back from the
engine, so a change to the engine cannot quietly move what it is compared to.
"""

import math

import numpy as np
import pytest

from elf_engine import (
    Arrangement,
    BusbarSource,
    Combination,
    ConductorSource,
    EmpiricalSource,
    ThreePhaseCircuit,
    calculate_normalized_exposure,
    compute_field,
    mg_to_ut,
    room_grid,
    to_mg,
    ut_to_mg,
)
from elf_engine.biot_savart import segment_field
from elf_engine.constants import MU0, TESLA_TO_MG

LONG = 100000.0


def infinite_wire_mg(current_a: float, distance_m: float) -> float:
    return MU0 * current_a / (2 * math.pi * distance_m) * TESLA_TO_MG


def long_wire(current=100.0, phase=0.0, y=0.0, z=0.0, id="w", group=None):
    return ConductorSource(
        id,
        path=[[-LONG, y, z], [LONG, y, z]],
        current_a=current,
        phase_deg=phase,
        coherence_group=group,
    )


def long_circuit(arrangement, spacing=0.1, current=400.0, phases=(0.0, -120.0, 120.0)):
    return ThreePhaseCircuit(
        "c",
        centerline=[[-LONG, 0, 0], [LONG, 0, 0]],
        arrangement=arrangement,
        spacing_m=spacing,
        currents_a=(current, current, current),
        phase_angles_deg=phases,
    )


# Test 1
@pytest.mark.parametrize("distance", [0.1, 0.5, 1.0, 3.0, 10.0])
def test_single_infinite_conductor_matches_analytic(distance):
    result = compute_field([[0, distance, 0]], [long_wire(100.0)])
    assert result.total_mg[0] == pytest.approx(infinite_wire_mg(100.0, distance), rel=1e-6)


def test_known_value_100a_at_1m_is_200mg():
    # 2e-7 * 100 / 1 m = 20 uT = 200 mG, the textbook figure.
    assert compute_field([[0, 1, 0]], [long_wire(100.0)]).total_mg[0] == pytest.approx(200.0, rel=1e-6)


def test_field_direction_follows_right_hand_rule():
    # Current along +x, point at +y: field along +z.
    field = segment_field(np.array([[0.0, 1.0, 0.0]]), np.array([-5.0, 0, 0]), np.array([5.0, 0, 0]), 1.0)
    assert field[0, 2].real > 0
    assert abs(field[0, 0]) < 1e-20 and abs(field[0, 1]) < 1e-20


def test_finite_segment_matches_closed_form():
    # At the midpoint of length L: B = mu0 I L / (4 pi d sqrt(d^2 + L^2/4)).
    length, distance, current = 2.0, 1.0, 50.0
    expected = MU0 * current * length / (4 * math.pi * distance * math.hypot(distance, length / 2))
    wire = ConductorSource("w", path=[[-1, 0, 0], [1, 0, 0]], current_a=current)
    assert compute_field([[0, distance, 0]], [wire]).total_mg[0] == pytest.approx(expected * TESLA_TO_MG, rel=1e-12)


# Test 2
def test_balanced_three_phase_flat_matches_independent_two_wire_sum():
    current, spacing, y, z = 400.0, 0.1, 0.7, 1.3
    computed = compute_field([[0, y, z]], [long_circuit(Arrangement.FLAT_HORIZONTAL, spacing, current)]).total_mg[0]

    # Independent 2D calculation in the plane across the conductors.
    # Centreline along +x: lateral = x cross z = -y.
    positions = [(spacing, 0.0), (0.0, 0.0), (-spacing, 0.0)]
    angles = [0.0, -120.0, 120.0]
    b_y, b_z = 0j, 0j
    for (py, pz), angle in zip(positions, angles):
        dy, dz = y - py, z - pz
        r2 = dy * dy + dz * dz
        phasor = current * np.exp(1j * math.radians(angle))
        # Infinite wire along +x: B = mu0 I / 2pi r2 * (-dz, dy) in (y, z).
        b_y += MU0 * phasor / (2 * math.pi * r2) * (-dz)
        b_z += MU0 * phasor / (2 * math.pi * r2) * dy
    expected = math.sqrt(abs(b_y) ** 2 + abs(b_z) ** 2) * TESLA_TO_MG
    assert computed == pytest.approx(expected, rel=1e-6)


def test_balanced_three_phase_far_field_formula():
    # B ~ (mu0 / 2 pi) * sqrt(3) * I * s / r^2 for r >> s.
    current, spacing, r = 400.0, 0.05, 20.0
    computed = compute_field([[0, r, 0]], [long_circuit(Arrangement.FLAT_HORIZONTAL, spacing, current)]).total_mg[0]
    expected = MU0 / (2 * math.pi) * math.sqrt(3) * current * spacing / r**2 * TESLA_TO_MG
    assert computed == pytest.approx(expected, rel=1e-3)


def test_phasor_rms_matches_time_domain_sampling():
    circuit = long_circuit(Arrangement.FLAT_HORIZONTAL, 0.1, 400.0)
    point = np.array([[0.0, 0.6, 0.8]])
    computed = compute_field(point, [circuit]).total_mg[0]

    samples = 720
    squared = 0.0
    for k in range(samples):
        omega_t = 2 * math.pi * k / samples
        vector = np.zeros(3)
        for start, end, phasor in circuit.filaments():
            # Peak = sqrt(2) * RMS; the instantaneous current is the real part.
            instantaneous = math.sqrt(2) * (phasor * np.exp(1j * omega_t)).real
            vector += segment_field(point, start, end, instantaneous)[0].real
        squared += float(np.dot(vector, vector))
    time_domain = math.sqrt(squared / samples) * TESLA_TO_MG
    assert computed == pytest.approx(time_domain, rel=1e-9)


# Test 3
def test_distance_doubling_halves_single_conductor():
    near, far = compute_field([[0, 1, 0], [0, 2, 0]], [long_wire()]).total_mg
    assert far == pytest.approx(near / 2, rel=1e-6)


def test_distance_doubling_quarters_three_phase_in_far_field():
    circuit = long_circuit(Arrangement.FLAT_HORIZONTAL, 0.02)
    near, far = compute_field([[0, 10, 0], [0, 20, 0]], [circuit]).total_mg
    assert far == pytest.approx(near / 4, rel=1e-3)


# Test 4
def test_current_doubling_doubles_field():
    point = [[0, 0.8, 0.3]]
    single = compute_field(point, [long_circuit(Arrangement.TREFOIL, 0.05, 200.0)]).total_mg[0]
    double = compute_field(point, [long_circuit(Arrangement.TREFOIL, 0.05, 400.0)]).total_mg[0]
    assert double == pytest.approx(2 * single, rel=1e-12)
    scaled = compute_field(point, [long_circuit(Arrangement.TREFOIL, 0.05, 200.0)], current_factor=2.0).total_mg[0]
    assert scaled == pytest.approx(double, rel=1e-12)


# Test 5
def test_phase_cancellation_coincident_balanced_conductors():
    # Three balanced conductors at one position sum to zero current, so zero field.
    wires = [long_wire(100.0, angle, id=f"L{i}", group="g") for i, angle in enumerate((0.0, -120.0, 120.0))]
    assert compute_field([[0, 1, 0]], wires).total_mg[0] == pytest.approx(0.0, abs=1e-6)


def test_three_phase_is_far_below_one_uncancelled_conductor():
    point = [[0, 2, 0]]
    circuit = compute_field(point, [long_circuit(Arrangement.FLAT_HORIZONTAL, 0.05, 400.0)]).total_mg[0]
    assert circuit < 0.1 * infinite_wire_mg(400.0, 2.0)


def test_trefoil_field_is_below_flat_at_same_spacing():
    point = [[0, 3, 0]]
    flat = compute_field(point, [long_circuit(Arrangement.FLAT_HORIZONTAL, 0.05)]).total_mg[0]
    trefoil = compute_field(point, [long_circuit(Arrangement.TREFOIL, 0.05)]).total_mg[0]
    assert trefoil < flat


# Test 6
def test_multiple_sources_coherent_group_sums_phasors():
    # Same current, same place, same group: the phasors simply add.
    one = long_wire(100.0, id="a", group="g")
    two = long_wire(100.0, id="b", group="g")
    assert compute_field([[0, 1, 0]], [one, two]).total_mg[0] == pytest.approx(400.0, rel=1e-6)


def test_multiple_sources_without_phase_relation_use_rss():
    a = long_wire(100.0, id="a", y=0.0)
    b = long_wire(100.0, id="b", y=4.0)
    result = compute_field([[0, 2, 0]], [a, b])
    expected = math.sqrt(2) * infinite_wire_mg(100.0, 2.0)
    assert result.total_mg[0] == pytest.approx(expected, rel=1e-6)


def test_arithmetic_is_an_upper_bound_on_rss():
    a, b = long_wire(100.0, id="a", y=0.0), long_wire(50.0, id="b", y=4.0)
    rss = compute_field([[0, 2, 0]], [a, b]).total_mg[0]
    arithmetic = compute_field([[0, 2, 0]], [a, b], combination=Combination.ARITHMETIC).total_mg[0]
    assert arithmetic == pytest.approx(infinite_wire_mg(150.0, 2.0), rel=1e-6)
    assert arithmetic > rss


def test_empirical_source_never_cohers_with_a_circuit():
    wire = long_wire(100.0, id="w", y=-1.0)
    box = EmpiricalSource(
        "tr", "TRANSFORMER_MEASURED_REFERENCE", (0, 1.5, 0), (1, 1, 1), [(1.0, 200.0)], 100.0, 100.0, 1.0
    )
    result = compute_field([[0, 0, 0]], [wire, box])
    assert result.total_mg[0] == pytest.approx(math.hypot(200.0, 200.0), rel=1e-6)


def test_dominant_source_is_the_largest_contribution():
    near = long_wire(100.0, id="near", y=0.0)
    far = long_wire(100.0, id="far", y=10.0)
    result = compute_field([[0, 1, 0]], [far, near])
    assert result.source_ids[result.dominant_source_index()[0]] == "near"


# Test 7
def test_source_above_room_uses_3d_distance():
    # Cable 3 m above the point and 4 m across: 5 m away.
    wire = long_wire(100.0, y=4.0, z=6.0)
    assert compute_field([[0, 0, 3]], [wire]).total_mg[0] == pytest.approx(infinite_wire_mg(100.0, 5.0), rel=1e-6)


# Test 8
def test_source_below_room_uses_3d_distance_and_is_symmetric():
    below = long_wire(100.0, y=4.0, z=0.0)
    above = long_wire(100.0, y=4.0, z=6.0)
    from_below = compute_field([[0, 0, 3]], [below]).total_mg[0]
    assert from_below == pytest.approx(infinite_wire_mg(100.0, 5.0), rel=1e-6)
    assert from_below == pytest.approx(compute_field([[0, 0, 3]], [above]).total_mg[0], rel=1e-9)


def test_transformer_in_parking_below_office_uses_box_face_distance():
    # Box top at z=2.5; a point directly above at z=4.5 is 2 m from the face, not 3 from the centre.
    box = EmpiricalSource(
        "tr", "TRANSFORMER_MANUFACTURER_DATA", (0, 0, 1.5), (2, 2, 2), [(1.0, 80.0), (2.0, 20.0), (4.0, 5.0)], 500.0, 500.0
    )
    assert compute_field([[0, 0, 4.5]], [box]).total_mg[0] == pytest.approx(20.0, rel=1e-9)


# Test 9
def test_ut_to_mg_conversion():
    assert ut_to_mg(1.0) == 10.0
    assert mg_to_ut(10.0) == 1.0
    converted = to_mg(0.4, "µT")
    assert converted.value_mg == pytest.approx(4.0)
    assert (converted.original_value, converted.original_unit) == (0.4, "µT")
    with pytest.raises(ValueError):
        to_mg(1.0, "dB")


# Empirical model
def test_empirical_scales_linearly_with_current():
    def box(current):
        return EmpiricalSource("p", "PANEL_MEASURED_REFERENCE", (0, 0, 0), (1, 1, 1), [(1.0, 10.0)], 100.0, current, 2.0)

    assert compute_field([[0, 2.5, 0]], [box(200.0)]).total_mg[0] == pytest.approx(
        2 * compute_field([[0, 2.5, 0]], [box(100.0)]).total_mg[0]
    )


def test_empirical_single_point_decay_and_log_log_interpolation():
    single = EmpiricalSource("p", "PANEL_EMPIRICAL", (0, 0, 0), (0, 0, 0), [(1.0, 16.0)], 10.0, 10.0, 2.0)
    assert compute_field([[2, 0, 0]], [single]).total_mg[0] == pytest.approx(4.0)
    curve = EmpiricalSource("p", "PANEL_EMPIRICAL", (0, 0, 0), (0, 0, 0), [(1.0, 16.0), (4.0, 1.0)], 10.0, 10.0)
    assert compute_field([[2, 0, 0]], [curve]).total_mg[0] == pytest.approx(4.0)


def test_empirical_outside_curve_is_flagged_as_extrapolated():
    curve = EmpiricalSource("p", "PANEL_EMPIRICAL", (0, 0, 0), (0, 0, 0), [(1.0, 16.0), (4.0, 1.0)], 10.0, 10.0)
    result = compute_field([[2, 0, 0], [8, 0, 0], [0.5, 0, 0]], [curve])
    assert result.extrapolated.tolist() == [False, True, True]
    assert result.total_mg[1] == pytest.approx(0.25)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"reference_curve": []},
        {"reference_curve": [(1.0, 10.0)], "decay_exponent": None},
        {"reference_curve": [(1.0, 10.0)], "decay_exponent": 2.0, "reference_current_a": 0.0},
    ],
)
def test_empirical_refuses_to_invent_missing_reference_data(kwargs):
    base = dict(id="p", model_type="PANEL_EMPIRICAL", center=(0, 0, 0), size=(1, 1, 1), reference_current_a=10.0, current_a=10.0)
    with pytest.raises(ValueError):
        EmpiricalSource(**{**base, **kwargs})


# Geometry and guards
def test_points_on_a_conductor_or_inside_a_box_report_no_value():
    wire = long_wire(100.0)
    box = EmpiricalSource("tr", "TRANSFORMER_EMPIRICAL", (0, 5, 0), (2, 2, 2), [(1.0, 10.0)], 10.0, 10.0, 2.0)
    result = compute_field([[0, 0, 0.001], [0, 5, 0], [0, 1, 0]], [wire, box])
    assert result.too_close.tolist() == [True, True, False]
    assert math.isnan(result.total_mg[0]) and math.isnan(result.total_mg[1])
    assert not math.isnan(result.total_mg[2])


def test_bent_circuit_conductors_stay_joined_at_the_corner():
    circuit = ThreePhaseCircuit(
        "c",
        centerline=[[0, 0, 3], [5, 0, 3], [5, 5, 3]],
        arrangement=Arrangement.FLAT_HORIZONTAL,
        spacing_m=0.1,
        currents_a=(100, 100, 100),
    )
    filaments = circuit.filaments()
    assert len(filaments) == 6
    for i in (0, 2, 4):
        assert np.allclose(filaments[i][1], filaments[i + 1][0])
    # Outer and inner phases keep the stated spacing from the centreline on each leg.
    assert abs(filaments[0][0][1]) == pytest.approx(0.1)
    assert abs(filaments[1][1][0] - 5.0) == pytest.approx(0.1)


def test_riser_is_supported():
    riser = ThreePhaseCircuit(
        "r",
        centerline=[[0, 0, 0], [0, 0, 20]],
        arrangement=Arrangement.TREFOIL,
        spacing_m=0.05,
        currents_a=(200, 200, 200),
    )
    assert compute_field([[1, 0, 10]], [riser]).total_mg[0] > 0


def test_busbar_converges_to_thin_conductors_when_far():
    point = [[0, 6, 0]]
    thin = compute_field(point, [long_circuit(Arrangement.FLAT_HORIZONTAL, 0.1, 800.0)]).total_mg[0]
    bar = BusbarSource(
        "b",
        centerline=[[-LONG, 0, 0], [LONG, 0, 0]],
        arrangement=Arrangement.FLAT_HORIZONTAL,
        spacing_m=0.1,
        width_m=0.05,
        currents_a=(800, 800, 800),
    )
    assert compute_field(point, [bar]).total_mg[0] == pytest.approx(thin, rel=1e-3)


def test_attenuation_scales_contribution():
    plain = long_wire(100.0)
    shielded = long_wire(100.0)
    shielded.attenuation_factor = 0.25
    assert compute_field([[0, 1, 0]], [shielded]).total_mg[0] == pytest.approx(
        0.25 * compute_field([[0, 1, 0]], [plain]).total_mg[0]
    )


def test_grid_stays_inside_polygon_at_every_height():
    square = [[0, 0], [4, 0], [4, 2], [0, 2]]
    points = room_grid(square, 0.5, [1.0, 2.0])
    assert len(points) == 2 * 8 * 4
    assert points[:, 0].min() == 0.25 and points[:, 0].max() == 3.75
    assert sorted(set(points[:, 2])) == [1.0, 2.0]


def test_room_smaller_than_grid_step_still_gets_a_point():
    closet = [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]]
    assert len(room_grid(closet, 0.5, [1.0])) == 1


def test_grid_requires_an_explicit_height():
    with pytest.raises(ValueError):
        room_grid([[0, 0], [1, 0], [1, 1]], 0.5, [])


def test_engine_is_deterministic():
    circuit = long_circuit(Arrangement.TREFOIL)
    points = room_grid([[1, 1], [5, 1], [5, 4], [1, 4]], 0.25, [1.0])
    assert np.array_equal(compute_field(points, [circuit]).total_mg, compute_field(points, [circuit]).total_mg)


def test_normalized_exposure_keeps_its_method_and_inputs():
    result = calculate_normalized_exposure(12.0, 8.0, 24.0)
    assert result.normalized_field_mg == pytest.approx(4.0)
    assert result.raw_field_mg == 12.0 and result.occupancy_hours == 8.0
    assert result.normalization_method == "TIME_WEIGHTED_LINEAR"
    with pytest.raises(ValueError):
        calculate_normalized_exposure(1.0, 25.0, 24.0)


def test_points_inside_a_sources_enclosure_are_not_reported():
    from elf_engine import compute_field, sources_from_dicts

    riser = {
        "id": "R1",
        "kind": "THREE_PHASE",
        "centerline": [[0, 0, 0], [0, 0, 3]],
        "arrangement": "TREFOIL",
        "spacing_m": 0.05,
        "currents_a": [600, 600, 600],
        "keep_out_m": 0.5,
    }
    points = np.array([[0.3, 0, 1], [0.6, 0, 1]])
    shielded = compute_field(points, sources_from_dicts([riser]))
    assert np.isnan(shielded.total_mg[0]) and np.isfinite(shielded.total_mg[1])
    plain = compute_field(points, sources_from_dicts([{**riser, "keep_out_m": 0.0}]))
    assert np.isfinite(plain.total_mg[0])
