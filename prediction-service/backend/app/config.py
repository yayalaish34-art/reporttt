from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_LOCAL_SECRET = "local-development-only-secret-change-me"


def _with_driver(url: str) -> str:
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./local.db"
    # Neon's direct connection. Migrations must not go through the transaction pooler.
    database_url_unpooled: str | None = None
    elf_jwt_secret: str = INSECURE_LOCAL_SECRET
    elf_storage_dir: str = "./storage"
    elf_admin_email: str | None = None
    elf_admin_password: str | None = None
    elf_cookie_secure: bool = False
    elf_max_upload_mb: int = 100
    elf_token_hours: int = 12
    # Vercel sets this on every build and function: production, preview or development.
    vercel_env: str | None = None
    # A connected Blob store sets these. Either one selects Blob storage.
    blob_store_id: str | None = None
    blob_read_write_token: str | None = None
    # Automatic reading of plan pages.
    openai_api_key: str | None = None
    openai_model: str = "gpt-5"
    # Railway sets this on every deployment.
    railway_environment: str | None = None
    # The built screens, served from this same address. Absent in development and in tests.
    web_dist: str | None = None
    # The CRM's database, read for the customer search on the project form.
    crm_database_url: str | None = None
    # The company-wide Job Number register lives in the reports system.
    reports_url: str | None = None
    job_numbers_token: str | None = None
    # This system's own address, for the link the Job Number register shows.
    public_url: str | None = None

    @property
    def sqlalchemy_url(self) -> str:
        return _with_driver(self.database_url)

    @property
    def migration_url(self) -> str:
        return _with_driver(self.database_url_unpooled or self.database_url)

    @property
    def uses_blob_storage(self) -> bool:
        return bool(self.blob_store_id or self.blob_read_write_token)

    @property
    def max_upload_bytes(self) -> int:
        return self.elf_max_upload_mb * 1024 * 1024

    def assert_safe_for_deployment(self) -> None:
        """Defaults are public and a container's disk is temporary, so refuse to start on them."""
        if not (self.vercel_env or self.railway_environment):
            return
        if self.elf_jwt_secret == INSECURE_LOCAL_SECRET:
            raise RuntimeError("ELF_JWT_SECRET must be set in a deployed environment")
        if self.sqlalchemy_url.startswith("sqlite"):
            raise RuntimeError("DATABASE_URL must point to PostgreSQL in a deployed environment")
        if self.vercel_env and not self.uses_blob_storage:
            raise RuntimeError("A Blob store must be connected in a deployed environment")
        if self.railway_environment and not self.uses_blob_storage and not self.elf_storage_dir.startswith("/data"):
            raise RuntimeError("ELF_STORAGE_DIR must be on the /data volume in a deployed environment")


settings = Settings()
