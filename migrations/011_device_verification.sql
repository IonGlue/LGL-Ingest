-- Device verification (RFC 8628-style physical presence check)
--
-- After enrollment, an enrolled device must be "verified" on each connection
-- by an admin who enters the short code shown on the device's screen.
-- This proves physical access to the device, not just knowledge of its ID.
--
-- verification_code  — short code the device generates and displays
-- verification_state — 'unverified' | 'verified'
-- verified_at        — when last verified in this session
-- verified_by        — which admin performed the verification

ALTER TABLE devices
    ADD COLUMN verification_code  CHAR(6),
    ADD COLUMN verification_state TEXT NOT NULL DEFAULT 'unverified',
    ADD COLUMN verified_at        TIMESTAMPTZ,
    ADD COLUMN verified_by        UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_devices_verification_state ON devices(verification_state);
