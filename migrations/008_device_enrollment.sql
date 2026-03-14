-- Device enrollment workflow
-- New devices start in 'pending' state and must be approved by an admin
-- who verifies the 5-digit code shown on the device's HDMI output / terminal.

ALTER TABLE devices
    ADD COLUMN enrollment_state TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN enrollment_code  CHAR(5),
    ADD COLUMN enrolled_at      TIMESTAMPTZ,
    ADD COLUMN enrolled_by      UUID REFERENCES users(id) ON DELETE SET NULL;

-- Retroactively enroll any devices that were registered before this migration
UPDATE devices SET enrollment_state = 'enrolled' WHERE enrollment_state = 'pending';

CREATE INDEX idx_devices_enrollment_state ON devices(enrollment_state);
