"""automatic plan reading

Revision ID: 0003
Revises: 0002
"""

from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'page_analyses',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.Column('page', sa.Integer(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('model', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('document_id', 'page'),
    )
    with op.batch_alter_table('page_analyses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_page_analyses_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_page_analyses_document_id'), ['document_id'], unique=False)
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('auto_settings', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_column('auto_settings')
    with op.batch_alter_table('page_analyses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_page_analyses_document_id'))
        batch_op.drop_index(batch_op.f('ix_page_analyses_project_id'))
    op.drop_table('page_analyses')
