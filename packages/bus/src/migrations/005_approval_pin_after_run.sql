-- An approval requested during a run is pinned to the branch head when that run has pushed.
ALTER TABLE approvals ALTER COLUMN head_sha DROP NOT NULL;
