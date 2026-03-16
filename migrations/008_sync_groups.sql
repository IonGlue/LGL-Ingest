-- Sync groups: multi-camera feed alignment
--
-- A sync group collects N encoder sources and aligns them to a common
-- timeline so that downstream receivers (OBS, MediaMTX, …) see all
-- cameras in frame-accurate sync.
--
-- target_delay_ms  — configurable minimum buffer added to every stream.
--                    200 ms for local networks; 1000–1500 ms worldwide.
-- max_offset_ms    — if a stream falls this far behind the reference,
--                    its buffer is reset and it re-synchronises.

CREATE TABLE sync_groups (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    target_delay_ms INTEGER     NOT NULL DEFAULT 500,
    max_offset_ms   INTEGER     NOT NULL DEFAULT 2000,
    status          TEXT        NOT NULL DEFAULT 'idle',  -- idle | active | error
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Members of a sync group (each member is a source slot).
CREATE TABLE sync_group_members (
    sync_group_id   UUID    NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
    source_id       UUID    NOT NULL REFERENCES sources(id)     ON DELETE CASCADE,
    PRIMARY KEY (sync_group_id, source_id)
);

-- Runtime per-member state: the aligned output port assigned by the supervisor.
-- Populated when the sync group is started; cleared on stop.
CREATE TABLE sync_group_ports (
    sync_group_id   UUID    NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
    source_id       UUID    NOT NULL,
    aligned_port    INTEGER NOT NULL,
    PRIMARY KEY (sync_group_id, source_id)
);

-- Keep updated_at current automatically.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER sync_groups_updated_at
    BEFORE UPDATE ON sync_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
