"""The architecture's hard lines, enforced so they cannot erode by accident."""

import ast
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ENGINE_ALLOWED = {"numpy", "shapely", "elf_engine"}
REGULATION_ALLOWED = {"elf_engine", "elf_regulation"}
STDLIB_OK = {"cmath", "dataclasses", "datetime", "enum", "math"}


def top_level_imports(path: Path) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


def test_engine_imports_only_numerics():
    for path in (BACKEND / "elf_engine").glob("*.py"):
        assert top_level_imports(path) <= ENGINE_ALLOWED | STDLIB_OK, path.name


def test_regulation_imports_no_outside_world():
    for path in (BACKEND / "elf_regulation").glob("*.py"):
        assert top_level_imports(path) <= REGULATION_ALLOWED | STDLIB_OK, path.name


def test_regulation_holds_no_numeric_threshold():
    """No numeric literal may sit beside a field unit or threshold name."""
    pattern = re.compile(r"(threshold\w*\s*=\s*\d)|(\d\s*(mG|µT|uT)\b)")
    for path in (BACKEND / "elf_regulation").glob("*.py"):
        assert not pattern.search(path.read_text(encoding="utf-8")), path.name
