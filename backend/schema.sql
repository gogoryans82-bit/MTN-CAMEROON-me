CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    tnc_accepted_at       TIMESTAMPTZ NOT NULL,

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

CREATE INDEX IF NOT EXISTS idx_apps_email ON applications(email);
CREATE INDEX IF NOT EXISTS idx_apps_phone ON applications(phone);
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
