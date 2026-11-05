"""Closed vocabularies shared by the API and its services."""

BUILDING_TYPES = (
    "Residential",
    "Office",
    "Commercial",
    "Hospital",
    "School",
    "Kindergarten",
    "Industrial",
    "Hotel",
    "Mixed use",
    "Other",
)
DOCUMENT_TYPES = (
    "ARCHITECTURAL",
    "ELECTRICAL",
    "SINGLE_LINE",
    "TRANSFORMER_ROOM",
    "CABLE_LAYOUT",
    "SITE_PLAN",
    "OTHER",
)
# All are stored. Only these can be shown as a plan in MVP 1.
RASTER_TYPES = ("pdf", "png", "jpg", "jpeg")
FILE_TYPES = (*RASTER_TYPES, "dwg", "dxf", "ifc")
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "dwg": "image/vnd.dwg",
    "dxf": "image/vnd.dxf",
    "ifc": "application/x-step",
}

OCCUPANCY_TYPES = ("CONTINUOUS_OCCUPANCY", "NON_CONTINUOUS_OCCUPANCY", "UNKNOWN")
CURRENT_BASES = ("RATED", "DESIGN", "MEASURED", "ESTIMATED")
ARRANGEMENTS = ("FLAT_HORIZONTAL", "FLAT_VERTICAL", "TREFOIL")
CONFIDENCE_LEVELS = ("HIGH", "MEDIUM", "LOW")
SCENARIO_KINDS = ("NORMAL", "MAX_DESIGN", "WORST_CASE", "POST_MITIGATION")
INSTRUMENT_TYPES = ("LAW", "REGULATION", "PROCEDURE", "PERMIT", "RECOMMENDATION", "GUIDELINE")
THRESHOLD_TYPES = ("INSTANTANEOUS_MAX", "TIME_AVERAGED")
REPORT_STATUSES = ("DRAFT", "UNDER_REVIEW", "APPROVED", "ISSUED")

LINE_SOURCE_TYPES = (
    "THREE_PHASE_CABLE",
    "CABLE_BUNDLE",
    "CABLE_TRAY",
    "RISER",
    "ELECTRICAL_SHAFT",
)
BUSBAR_SOURCE_TYPE = "BUSBAR"
TRANSFORMER_SOURCE_TYPE = "TRANSFORMER"
# No dedicated model yet: each takes the empirical box model and its own reference data.
PANEL_SOURCE_TYPES = (
    "LV_BOARD",
    "MAIN_DISTRIBUTION_BOARD",
    "GENERATOR",
    "UPS",
    "INVERTER",
    "EV_CHARGING",
    "PV_INFRASTRUCTURE",
)
SOURCE_TYPES = (*LINE_SOURCE_TYPES, BUSBAR_SOURCE_TYPE, TRANSFORMER_SOURCE_TYPE, *PANEL_SOURCE_TYPES)

# TRANSFORMER_NUMERICAL is reserved by the spec but not implemented, and must be
# refused rather than silently computed some other way.
EMPIRICAL_MODEL_TYPES = (
    "TRANSFORMER_EMPIRICAL",
    "TRANSFORMER_MANUFACTURER_DATA",
    "TRANSFORMER_MEASURED_REFERENCE",
    "PANEL_EMPIRICAL",
    "PANEL_MANUFACTURER_DATA",
    "PANEL_MEASURED_REFERENCE",
    "PANEL_CONSERVATIVE_APPROXIMATION",
)

# A shaft's cables run inside an enclosure about a metre across: the field inside it is not
# where anyone stands, so points closer than this to a riser are left out of the results.
SHAFT_SOURCE_TYPES = ("RISER", "ELECTRICAL_SHAFT")
SHAFT_KEEP_OUT_M = 0.5
