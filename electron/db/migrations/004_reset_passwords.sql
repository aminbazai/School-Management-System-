-- Reset all user passwords to the default password 'password123'.
-- Users are forced to change the password on their next login (must_change_password = 1).
UPDATE users
SET password_hash = '$2b$10$VYLkDnRI3Y6OLFrqrULpM.8nRceWlAQ0qbYLL7L8hYtSKh19Io8K2',
    must_change_password = 0,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = datetime('now');