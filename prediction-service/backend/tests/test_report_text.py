"""Hebrew text in the PDF: what the bidi library leaves for us to get right."""

from bidi import get_display

from app.services.report_pdf import _wrap, mirror_inverted_brackets


def test_brackets_around_latin_in_hebrew_face_inward():
    assert mirror_inverted_brackets(get_display("לפני (mG)")) == "(mG) ינפל"


def test_brackets_around_hebrew_face_inward():
    visual = mirror_inverted_brackets(get_display("משרד (1 מ׳)"))
    assert visual.index("(") < visual.index(")")


def test_brackets_in_a_left_to_right_run_are_untouched():
    assert mirror_inverted_brackets("f(x)") == "f(x)"
    assert mirror_inverted_brackets("Cable-01 [A]") == "Cable-01 [A]"


def test_unbalanced_brackets_do_not_crash_or_change():
    assert mirror_inverted_brackets("a)") == "a)"
    assert mirror_inverted_brackets("(a") == "(a"


def test_long_identifier_breaks_at_underscores():
    lines = _wrap("REGULATION_REVIEW_REQUIRED", "Arimo", 8.5, 90)
    assert len(lines) > 1
    assert "".join(lines) == "REGULATION_REVIEW_REQUIRED"
