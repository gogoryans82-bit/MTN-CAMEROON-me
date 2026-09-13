'use strict';

const BREVO = 'https://api.brevo.com/v3/smtp/email';
const KEY = process.env.BREVO_API_KEY;
const SENDER = process.env.BREVO_SENDER_EMAIL;
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'MTN MoMo Cameroon Loans';

async function sendEmail({ to, toName, subject, htmlContent }) {
    if (!KEY || !SENDER) {
        console.log(`[EMAIL SIMULATED] to=${to} subject="${subject}"`);
        return { ok: true, simulated: true };
    }
    try {
        const r = await fetch(BREVO, {
            method: 'POST',
            headers: { 'api-key': KEY, 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
                sender: { email: SENDER, name: SENDER_NAME },
                to: [{ email: to, name: toName || to }],
                subject,
                htmlContent
            })
        });
        const data = await r.json();
        if (r.ok) { console.log(`✅ Email → ${to}`); return { ok: true }; }
        console.error('❌ Brevo:', data);
        return { ok: false, error: data.message };
    } catch (e) {
        console.error('❌ Email:', e.message);
        return { ok: false, error: e.message };
    }
}

function wrap(body) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:Inter,Arial,sans-serif;background:#F4F5F7;margin:0;padding:0;color:#0F0F0F}
.c{max-width:520px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08)}
.h{background:#000;padding:26px;text-align:center}
.h h1{color:#FFCC00;font-size:22px;margin:0;letter-spacing:-0.02em}
.b{padding:30px 26px}
.b h2{font-size:18px;margin:0 0 12px}
.b p{font-size:14px;color:#4A4A4A;line-height:1.6;margin:0 0 14px}
.btn{display:block;background:#FFCC00;color:#000;text-decoration:none;text-align:center;padding:15px 22px;border-radius:12px;font-weight:800;margin:22px 0}
.otp{display:inline-block;background:#FFF8D6;border:2px solid #FFCC00;border-radius:12px;padding:16px 30px;font-size:30px;font-weight:900;letter-spacing:8px;color:#000;margin:20px 0}
.f{background:#F5F5F5;padding:18px;text-align:center;font-size:12px;color:#888}
.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #F0F0F0;font-size:14px}
.row:last-child{border-bottom:none}
.row span:first-child{color:#888}
.row span:last-child{font-weight:700}
</style></head><body>${body}</body></html>`;
}

async function sendOtpEmail({ to, name, otp, purpose }) {
    const purposeText = purpose === 'check-status'
        ? 'to check your loan status'
        : 'to verify your identity';
    const html = wrap(`
        <div class="c">
            <div class="h"><h1>MTN MoMo</h1></div>
            <div class="b" style="text-align:center">
                <h2>Hello ${name},</h2>
                <p>Your verification code ${purposeText}:</p>
                <div class="otp">${otp}</div>
                <p style="font-size:13px;color:#888">Expires in 10 minutes. Never share this code.</p>
            </div>
            <div class="f">© 2026 MTN MoMo Cameroon</div>
        </div>
    `);
    return sendEmail({ to, toName: name, subject: `🔢 Your MTN MoMo code: ${otp}`, htmlContent: html });
}

async function sendApprovalEmail({ to, name, loanAmount, loanTerm, monthly, applicationId }) {
    const html = wrap(`
        <div class="c">
            <div class="h"><h1>MTN MoMo</h1></div>
            <div style="background:#FFCC00;padding:28px;text-align:center">
                <h2 style="font-size:22px;color:#000;margin:0 0 6px">🎉 Loan Approved!</h2>
                <div style="font-size:30px;font-weight:900;color:#000">XAF ${Number(loanAmount).toLocaleString()}</div>
            </div>
            <div class="b">
                <p>Dear ${name},</p>
                <p>Your loan has been approved. Funds will be deposited to your MTN MoMo wallet within 5 minutes. You'll receive an SMS confirmation once the deposit completes.</p>
                <div class="row"><span>Reference</span><span>${applicationId}</span></div>
                <div class="row"><span>Amount</span><span>XAF ${Number(loanAmount).toLocaleString()}</span></div>
                <div class="row"><span>Term</span><span>${loanTerm} months</span></div>
                <div class="row"><span>Monthly payment</span><span>XAF ${Number(monthly).toLocaleString()}</span></div>
            </div>
            <div class="f">© 2026 MTN MoMo Cameroon · support@mtn-momo-cm.com</div>
        </div>
    `);
    return sendEmail({ to, toName: name, subject: '🎉 Your MTN MoMo Loan Has Been Approved', htmlContent: html });
}

module.exports = { sendEmail, sendOtpEmail, sendApprovalEmail };
