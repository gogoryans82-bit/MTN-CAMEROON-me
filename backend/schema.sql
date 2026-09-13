CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
    CREATE TYPE application_status AS ENUM (
        'pending_approval',
        'approved',
        'failed_approval'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS applications (
    id                          TEXT PRIMARY KEY,
    email                       TEXT UNIQUE NOT NULL,
    phone                       TEXT UNIQUE NOT NULL,
    full_name                   TEXT NOT NULL,
    momo_pin_hash               TEXT NOT NULL,
    loan_type                   TEXT NOT NULL,
    loan_amount                 BIGINT NOT NULL,
    loan_term                   INTEGER NOT NULL,
    loan_purpose                TEXT NOT NULL,
    employment                  TEXT NOT NULL,
    annual_income               BIGINT NOT NULL,
    kin_name                    TEXT NOT NULL,
    kin_phone                   TEXT NOT NULL,
    has_20_percent              BOOLEAN NOT NULL DEFAULT FALSE,
    tnc_accepted_at             TIMESTAMPTZ NOT NULL,
    email_verified              BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified_at           TIMESTAMPTZ,
    email_verification_token    TEXT,
    email_verification_expires  TIMESTAMPTZ,
    status                      application_status NOT NULL DEFAULT 'pending_approval',
    admin_decision_at           TIMESTAMPTZ,
    admin_decision_by           TEXT,
    approved_at                 TIMESTAMPTZ,
    rejection_reason            TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
CREATE INDEX IF NOT EXISTS idx_applications_phone ON applications(phone);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

CREATE TABLE IF NOT EXISTS user_sessions (
    token           TEXT PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    device_info     TEXT,
    ip_address      TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_app ON user_sessions(application_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS otp_sessions (
    token               TEXT PRIMARY KEY,
    application_id      TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    otp_hash            TEXT NOT NULL,
    otp_expires_at      TIMESTAMPTZ NOT NULL,
    otp_attempts        INTEGER NOT NULL DEFAULT 0,
    otp_verified        BOOLEAN NOT NULL DEFAULT FALSE,
    pin_verified        BOOLEAN NOT NULL DEFAULT FALSE,
    last_otp_sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_app ON otp_sessions(application_id);

CREATE TABLE IF NOT EXISTS transactions (
    id              SERIAL PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    amount          BIGINT NOT NULL,
    description     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_app ON transactions(application_id);
