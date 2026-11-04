"""Suggests an occupancy class from a room's name. A suggestion, never a decision.

Ordered: the first match wins, so "חדר חשמל" must sit before any looser word.
"""

CONTINUOUS = "CONTINUOUS_OCCUPANCY"
NON_CONTINUOUS = "NON_CONTINUOUS_OCCUPANCY"
UNKNOWN = "UNKNOWN"

_RULES = (
    (("חדר חשמל", "חדר שנאים", "חדר מכונות", "חדר אשפה", "חדר שירות", "חדר מדרגות"), NON_CONTINUOUS),
    (("מסדרון", "לובי", "חניון", "מחסן", "פיר", "שירותים", "מבואה"), NON_CONTINUOUS),
    (("חדר שינה", "סלון", "משרד", "עמדת עבודה", "כיתה", "גן ילדים", "חדר טיפול", "ממ\"ד"), CONTINUOUS),
    (("bedroom", "living", "office", "workstation", "classroom", "kindergarten", "treatment"), CONTINUOUS),
    (("corridor", "lobby", "parking", "storage", "garbage", "electrical", "stair", "mechanical"), NON_CONTINUOUS),
)


def suggest_occupancy(room_name: str) -> str:
    name = room_name.strip().lower()
    for words, classification in _RULES:
        if any(word in name for word in words):
            return classification
    return UNKNOWN
