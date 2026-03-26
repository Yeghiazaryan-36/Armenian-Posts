const crypto = require('crypto');
const express = require('express');
const https = require('https');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;

const allowedDomains = ['gmail.com', 'yahoo.com', 'mail.ru', 'yandex.ru', 'outlook.com', 'icloud.com'];

const tempCodes = new Map();
const users = [];
const posts = [];

const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM = String(process.env.RESEND_FROM || '').trim();
const GMAIL_USER = String(process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || '').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const SMTP_SECURE = isTruthy(process.env.SMTP_SECURE) || SMTP_PORT === 465;
const MAIL_FROM = String(
    process.env.MAIL_FROM || RESEND_FROM || SMTP_USER || GMAIL_USER || ''
).trim();

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getDomainFromEmail(email) {
    return email.split('@')[1] || '';
}

function createVerificationCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

function cleanupExpiredCodes() {
    const now = Date.now();

    for (const [email, data] of tempCodes.entries()) {
        if (data.expiresAt <= now) {
            tempCodes.delete(email);
        }
    }
}

function resolveEmailProvider() {
    if (EMAIL_PROVIDER === 'resend') return 'resend';
    if (EMAIL_PROVIDER === 'smtp') return 'smtp';
    if (EMAIL_PROVIDER === 'gmail') return 'gmail';
    if (RESEND_API_KEY) return 'resend';
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) return 'smtp';
    if (GMAIL_USER && GMAIL_APP_PASSWORD) return 'gmail';
    return 'disabled';
}

function createSmtpTransporter(provider) {
    if (provider === 'gmail') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: GMAIL_USER,
                pass: GMAIL_APP_PASSWORD
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000
        });
    }

    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
}

function postJson(urlString, payload, headers = {}) {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                method: 'POST',
                hostname: url.hostname,
                path: `${url.pathname}${url.search}`,
                port: url.port || 443,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...headers
                }
            },
            (res) => {
                let responseBody = '';

                res.on('data', (chunk) => {
                    responseBody += chunk;
                });

                res.on('end', () => {
                    let parsedBody = responseBody;

                    try {
                        parsedBody = responseBody ? JSON.parse(responseBody) : null;
                    } catch {
                        parsedBody = responseBody;
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedBody);
                        return;
                    }

                    const details =
                        typeof parsedBody === 'string' && parsedBody
                            ? parsedBody
                            : JSON.stringify(parsedBody);

                    reject(new Error(`Email API request failed with status ${res.statusCode}: ${details}`));
                });
            }
        );

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy(new Error('Email API request timed out'));
        });

        req.write(body);
        req.end();
    });
}

const emailProvider = resolveEmailProvider();
const smtpTransporter =
    emailProvider === 'smtp' || emailProvider === 'gmail'
        ? createSmtpTransporter(emailProvider)
        : null;

async function sendMail({ to, subject, text, html }) {
    if (emailProvider === 'disabled') {
        throw new Error(
            'Email provider is not configured. Set RESEND_API_KEY or SMTP/Gmail environment variables.'
        );
    }

    if (emailProvider === 'resend' && !RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY is missing.');
    }

    if (emailProvider === 'gmail' && (!GMAIL_USER || !GMAIL_APP_PASSWORD)) {
        throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD is missing.');
    }

    if (emailProvider === 'smtp' && (!SMTP_HOST || !SMTP_USER || !SMTP_PASS)) {
        throw new Error('SMTP_HOST, SMTP_USER or SMTP_PASS is missing.');
    }

    if (!MAIL_FROM) {
        throw new Error('MAIL_FROM is missing.');
    }

    if (emailProvider === 'resend') {
        await postJson(
            'https://api.resend.com/emails',
            {
                from: MAIL_FROM,
                to: [to],
                subject,
                text,
                html
            },
            {
                Authorization: `Bearer ${RESEND_API_KEY}`
            }
        );

        return;
    }

    if (!smtpTransporter) {
        throw new Error('SMTP transporter could not be created.');
    }

    await smtpTransporter.sendMail({
        from: MAIL_FROM,
        to,
        subject,
        text,
        html
    });
}

async function sendVerificationEmail(email, code) {
    const subject = 'Հաստատման կոդ';
    const text = `Ձեր հաստատման կոդն է: ${code}. Կոդը գործում է 10 րոպե։`;
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2 style="margin-bottom: 12px;">Հաստատման կոդ</h2>
            <p>Ձեր հաստատման կոդն է.</p>
            <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 16px 0;">
                ${code}
            </div>
            <p>Կոդը գործում է 10 րոպե։</p>
        </div>
    `;

    await sendMail({ to: email, subject, text, html });
}

function findUserByEmail(email) {
    return users.find((user) => user.email === email);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({
        success: true,
        emailProvider,
        codesPending: tempCodes.size
    });
});

app.post('/register', async (req, res) => {
    cleanupExpiredCodes();

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '').trim();

    if (!email || !password) {
        return res.status(400).json({
            message: 'Լրացրեք email-ը և գաղտնաբառը։',
            success: false
        });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({
            message: 'Մուտքագրեք ճիշտ email հասցե։',
            success: false
        });
    }

    const domain = getDomainFromEmail(email);

    if (!allowedDomains.includes(domain)) {
        return res.status(400).json({
            message: 'Մենք ընդունում ենք միայն հայտնի email հասցեներ (Gmail, Yahoo, Mail.ru և այլն)։',
            success: false
        });
    }

    if (findUserByEmail(email)) {
        return res.status(400).json({
            message: 'Այս email-ով արդեն գրանցված օգտատեր կա։',
            success: false
        });
    }

    const code = createVerificationCode();

    tempCodes.set(email, {
        password,
        code,
        expiresAt: Date.now() + VERIFICATION_CODE_TTL_MS
    });

    try {
        await sendVerificationEmail(email, code);

        return res.json({
            message: 'Հաստատման կոդը ուղարկվեց email-ին։',
            success: true
        });
    } catch (error) {
        tempCodes.delete(email);
        console.error(`[mail] Failed to send verification code to ${email}:`, error.message);

        return res.status(500).json({
            message: 'Չհաջողվեց ուղարկել հաստատման կոդը։ Ստուգիր email provider-ի env-երը։',
            success: false
        });
    }
});

app.post('/verify', (req, res) => {
    cleanupExpiredCodes();

    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();

    if (!email || !code) {
        return res.status(400).json({
            message: 'Պետք է ուղարկել email և կոդ։',
            success: false
        });
    }

    const pendingUser = tempCodes.get(email);

    if (!pendingUser) {
        return res.status(400).json({
            message: 'Կոդը բացակայում է կամ ժամկետանց է։',
            success: false
        });
    }

    if (pendingUser.code !== code) {
        return res.status(400).json({
            message: 'Սխալ կոդ։',
            success: false
        });
    }

    if (!findUserByEmail(email)) {
        users.push({
            email,
            password: pendingUser.password
        });
    }

    tempCodes.delete(email);

    return res.json({
        message: 'Գրանցումը հաստատվեց։',
        success: true
    });
});

app.post('/login', (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '').trim();

    if (!email || !password) {
        return res.status(400).json({
            message: 'Լրացրեք email-ը և գաղտնաբառը։',
            success: false
        });
    }

    const foundUser = users.find((user) => user.email === email && user.password === password);

    if (foundUser) {
        return res.json({
            message: 'Բարի գալուստ։',
            success: true,
            email: foundUser.email
        });
    }

    return res.status(400).json({
        message: 'Սխալ email կամ գաղտնաբառ։',
        success: false
    });
});

app.get('/posts', (req, res) => {
    res.json(posts);
});

app.post('/posts', (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const content = String(req.body?.content || '').trim();

    if (!email || !content) {
        return res.status(400).json({
            success: false,
            message: 'Պետք է ուղարկել email և post-ի տեքստ։'
        });
    }

    const newPost = {
        id: Date.now().toString(),
        author: email,
        content,
        date: new Date().toLocaleString('hy-AM'),
        comments: []
    };

    posts.unshift(newPost);

    res.json({
        success: true,
        post: newPost
    });
});

app.delete('/posts/:id', (req, res) => {
    const { id } = req.params;
    const email = normalizeEmail(req.body?.email);
    const postIndex = posts.findIndex((post) => post.id === id);

    if (postIndex === -1) {
        return res.status(404).json({
            success: false,
            message: 'Պոստը չի գտնվել։'
        });
    }

    if (posts[postIndex].author !== email) {
        return res.status(403).json({
            success: false,
            message: 'Դուք չեք կարող ջնջել ուրիշի պոստը։'
        });
    }

    posts.splice(postIndex, 1);

    return res.json({ success: true });
});

app.put('/posts/:id', (req, res) => {
    const { id } = req.params;
    const email = normalizeEmail(req.body?.email);
    const newContent = String(req.body?.newContent || '').trim();
    const post = posts.find((item) => item.id === id);

    if (!post) {
        return res.status(404).json({
            success: false,
            message: 'Պոստը չի գտնվել։'
        });
    }

    if (post.author !== email) {
        return res.status(403).json({
            success: false,
            message: 'Իրավունք չունեք փոխելու սա։'
        });
    }

    if (!newContent) {
        return res.status(400).json({
            success: false,
            message: 'Նոր տեքստը դատարկ է։'
        });
    }

    post.content = newContent;

    return res.json({ success: true });
});

app.post('/posts/:id/comments', (req, res) => {
    const { id } = req.params;
    const email = normalizeEmail(req.body?.email);
    const text = String(req.body?.text || '').trim();
    const post = posts.find((item) => item.id === id);

    if (!post) {
        return res.status(404).json({
            success: false,
            message: 'Պոստը չի գտնվել։'
        });
    }

    if (!email || !text) {
        return res.status(400).json({
            success: false,
            message: 'Պետք է ուղարկել email և comment-ի տեքստ։'
        });
    }

    post.comments.push({
        author: email,
        text,
        date: new Date().toLocaleString('hy-AM')
    });

    return res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    console.log(`[mail] Provider: ${emailProvider}`);

    if (process.env.RENDER && (emailProvider === 'smtp' || emailProvider === 'gmail')) {
        console.warn(
            '[mail] Render free plan blocks SMTP ports 25/465/587. Use RESEND_API_KEY (HTTP API) or upgrade the service.'
        );
    }

    if (emailProvider === 'disabled') {
        console.warn(
            '[mail] No email provider configured. Set RESEND_API_KEY or SMTP/Gmail environment variables before using /register.'
        );
    }
});
