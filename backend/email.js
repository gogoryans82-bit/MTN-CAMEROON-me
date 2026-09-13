'use strict';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'MTN MoMo Cameroon Loans';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

async function sendEmail({ to, toName, subject, htmlContent }) {
    if (!BREVO_API_KEY || !SENDER_EMAIL) {
        console.log(`[EMAIL SIMULATED] to=${to} subject="${subject}"`);
        return { ok: true, simulated: true };
    }
    try {
        const res = await fetch(BREVO_URL, {
            method: 'POST',
            headers: {
                'api-key': BREVO_API_KEY,
                'Content-Type': 'application/json',
                'accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { email: SENDER_EMAIL, name: SENDER_NAME },
                to: [{ email: to, name: toName || to }],
                subject,
                htmlContent
            })
        });
        const data = await res.json();
        if (res.ok) {
            console.log(`✅ Email sent to ${to} (${data.messageId || 'ok'})`);
            return { ok: true, messageId: data.messageId };
        }
        console.error('❌ Brevo error:', data);
        return { ok: false, error: data.message || 'Email send failed' };
    } catch (err) {
        console.error('❌ Email exception:', err.message);
        return { ok: false, error: err.message };
    }
}

function baseWrapper(bodyHtml) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Inter,Arial,sans-serif;background:#F4F5F7;margin:0;padding:0;color:#0F0F0F}
        .container{max-width:520px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08)}
        .header{background:#000;padding:28px;text-align:center}
        .header h1{color:#FFCC00;font-size:24px;margin:0;letter-spacing:-0.02em}
        .header p{color:rgba(255,255,255,0.65);margin:6px 0 0;font-size:13px;letter-spacing:0.03em}
        .body{padding:32px 28px}
        .body h2{font-size:19px;margin:0 0 12px}
        .body p{font-size:15px;color:#4A4A4A;line-height:1.6;margin:0 0 14px}
        .btn{display:block;background:#FFCC00;color:#000;text-decoration:none;text-align:center;padding:16px 24px;border-radius:12px;font-weight:800;margin:22px 0;letter-spacing:0.03em}
        .footer{background:#F5F5F5;padding:20px;text-align:center;font-size:12px;color:#888}
        .otp{display:inline-block;background:#FFF8D6;border:2px solid #FFCC00;border-radius:12px;padding:18px 32px;font-size:32px;font-weight:900;letter-spacing:8px;color:#000;margin:20px 0}
        .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #F0F0F0;font-size:14px}
        .row:last-child{border-bottom:none}
        .row span:first-child{color:#888}
        .row span:last-child{font-weight:700}
    </style></head><body>${bodyHtml}</body></html>`;
}

async function sendVerificationEmail({ to, name, token }) {
    const link = `${APP_BASE_URL}/api/verify-email?token=${token}`;
    const html = baseWrapper(`
        <div class="container">
            <div class="header"><h1>MTN MoMo</h1><p>Cameroon · Easy Quick Loans</p></div>
            <div class="body">
                <h2>Hello ${name},</h2>
                <p>Thanks for applying for a loan with MTN MoMo Cameroon. Please verify your email address to continue.</p>
                <a href="${link}" class="btn">Verify My Email →</a>
                <p style="font-size:13px;color:#888">Or copy this link into your browser:</p>
                <p style="font-size:12px;word-break:break-all;color:#FFCC00">${link}</p>
                <p style="font-size:13px;color:#888;margin-top:20px">This link expires in 24 hours. If you didn't request this, ignore this email.</p>
            </div>
            <div class="footer">© 2026 MTN MoMo Cameroon</div>
        </div>
    `);
    return sendEmail({ to, toName: name, subject: '✅ Verify your email — MTN MoMo Cameroon', htmlContent: html });
}

async function sendOtpEmail({ to, name, otp }) {
    const html = baseWrapper(`
        <div class="container">
            <div class="header"><h1>MTN MoMo</h1></div>
            <div class="body" style="text-align:center">
                <h2>Hello ${name},</h2>
                <p>Your one-time verification code to check your loan status:</p>
                <div class="otp">${otp}</div>
                <p style="font-size:13px;color:#888">This code expires in 10 minutes. Do not share it with anyone.</p>
            </div>
            <div class="footer">© 2026 MTN MoMo Cameroon</div>
        </div>
    `);
    return sendEmail({ to, toName: name, subject: `🔢 Your MTN MoMo verification code`, htmlContent: html });
}

async function sendApprovalEmail({ to, name, loanAmount, loanTerm, monthlyPayment, applicationId }) {
    const html = baseWrapper(`
        <div class="container">
            <div class="header"><h1>MTN MoMo</h1></div>
            <div style="background:#FFCC00;padding:30px;text-align:center">
                <h2 style="font-size:22px;color:#000;margin:0 0 6px">🎉 Loan Approved!</h2>
                <div style="font-size:32px;font-weight:900;color:#000">XAF ${(loanAmount || 0).toLocaleString()}</div>
            </div>
            <div class="body">
                <p>Hello ${name},</p>
                <p>Your loan application has been approved. The amount will be deposited to your MTN MoMo account within 5 minutes. You'll receive a confirmation SMS as soon as the deposit is complete.</p>
                <div class="row"><span>Reference</span><span>${applicationId}</span></div>
                <div class="row"><span>Amount</span><span>XAF ${(loanAmount || 0).toLocaleString()}</span></div>
                <div class="row"><span>Term</span><span>${loanTerm} months</span></div>
                <div class="row"><span>Monthly payment</span><span>XAF ${(monthlyPayment || 0).toLocaleString()}</span></div>
                <div class="row"><span>Interest rate</span><span>24% per year</span></div>
            </div>
            <div class="footer">© 2026 MTN MoMo Cameroon · support@mtn-momo-cm.com</div>
        </div>
    `);
    return sendEmail({ to, toName: name, subject: '🎉 Your MTN MoMo Loan Has Been Approved', htmlContent: html });
}

module.exports = { sendEmail, sendVerificationEmail, sendOtpEmail, sendApprovalEmail };
