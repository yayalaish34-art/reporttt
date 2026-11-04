"""Runs in the production build, so a failed migration fails the deployment.

The database changes before the new code serves traffic, and a build that stops here
leaves the previous deployment running. Migrations must therefore stay compatible with
the code already live. Preview builds never touch the database.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

from .bootstrap import bootstrap
from .config import settings

BACKEND = Path(__file__).resolve().parents[1]


def main() -> None:
    if settings.vercel_env and settings.vercel_env != "production":
        print(f"Skipping database setup in {settings.vercel_env}")
        return
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(config, "head")
    bootstrap()
    print("Database setup complete")


if __name__ == "__main__":
    main()
