-- Hardware nodes assigned to this tenant for the Node Controller product.
-- Managed by superadmins; tenant users access them read-only via the portal API.
CREATE TABLE node_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT '',
  -- Internal URL used server-side to proxy commands. Never exposed to the browser.
  management_url TEXT NOT NULL,
  -- { "allowed_sections": ["status","config","display","scope","decimator"] }
  config         JSONB NOT NULL DEFAULT '{"allowed_sections":["status"]}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_node_assignments_name ON node_assignments(name);
