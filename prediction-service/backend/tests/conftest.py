import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Set before anything imports app.config, so the tests can never reach a real database.
_root = Path(tempfile.mkdtemp(prefix="elf-tests-"))
# ELF_TEST_DATABASE_URL runs the suite on Postgres; its database must be named elf_test.
os.environ["DATABASE_URL"] = os.environ.get("ELF_TEST_DATABASE_URL") or f"sqlite:///{(_root / 'elf_test.db').as_posix()}"
os.environ["ELF_STORAGE_DIR"] = str(_root / "files")
os.environ["ELF_JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
# A pulled production .env must not point the suite at the real Blob store.
for name in ("BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "VERCEL_ENV"):
    os.environ.pop(name, None)
