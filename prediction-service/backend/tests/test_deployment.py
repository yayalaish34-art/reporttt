"""The guards that keep a deployment from running on local defaults."""

import pytest

from app.config import INSECURE_LOCAL_SECRET, Settings


def deployed(**overrides) -> Settings:
    values = {
        "vercel_env": "production",
        "elf_jwt_secret": "a-real-secret",
        "database_url": "postgresql://user:pass@host/db",
        "blob_store_id": "store_abc",
    }
    return Settings(_env_file=None, **{**values, **overrides})


def test_complete_deployment_starts():
    deployed().assert_safe_for_deployment()


@pytest.mark.parametrize(
    "overrides",
    [
        {"elf_jwt_secret": INSECURE_LOCAL_SECRET},
        {"database_url": "sqlite:///./local.db"},
        {"blob_store_id": None, "blob_read_write_token": None},
    ],
)
def test_deployment_refuses_local_defaults(overrides, monkeypatch):
    monkeypatch.delenv("BLOB_STORE_ID", raising=False)
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        deployed(**overrides).assert_safe_for_deployment()


def test_local_development_is_not_held_to_it():
    Settings(_env_file=None, vercel_env=None).assert_safe_for_deployment()


def test_migrations_use_the_direct_connection_when_there_is_one():
    pooled = "postgres://u:p@pooler/db"
    direct = "postgresql://u:p@direct/db"
    both = Settings(_env_file=None, database_url=pooled, database_url_unpooled=direct)
    assert both.sqlalchemy_url == "postgresql+psycopg://u:p@pooler/db"
    assert both.migration_url == "postgresql+psycopg://u:p@direct/db"
    only_pooled = Settings(_env_file=None, database_url=pooled, database_url_unpooled=None)
    assert only_pooled.migration_url == only_pooled.sqlalchemy_url


def test_blob_storage_stays_private(monkeypatch):
    """Client plans must never land in a public store, whatever the SDK's defaults become."""
    from vercel.blob import sync as blob

    from app import storage

    calls = {}

    def record(name):
        def recorder(*args, **kwargs):
            calls[name] = kwargs
            return None

        return recorder

    monkeypatch.setattr(blob, "put_blob", record("put"))
    backend = storage._BlobStorage()
    backend.put("files/x.pdf", b"data")
    assert calls["put"]["access"] == "private"
