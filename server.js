const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();

app.use(express.json());

// Ժամանակավոր Բազաներ
const tempCodes = {}; 
const users = []; 
const posts = []; 

// 1. Ստեղծում ենք transporter-ը Render-ի համար (Port 587)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // 465-ի համար պարտադիր true
    auth: {
        user: 'yeghiazaryanaleq@gmail.com',
        pass: 'rwqeijgsgsygivhk'
    },
    tls: {
        rejectUnauthorized: false
    }
});

const allowedDomains = ['gmail.com', 'yahoo.com', 'mail.ru', 'yandex.ru', 'outlook.com', 'icloud.com'];

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ԱՎՏՈՐԻԶԱՑԻԱ ---
app.post('/register', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) return res.status(400).json({ message: "Լրացրեք բոլոր դաշտերը", success: false });

    const domain = email.split('@')[1]?.toLowerCase();
    if (!allowedDomains.includes(domain)) {
        return res.status(400).json({ 
            message: "Մենք ընդունում ենք միայն հայտնի էլ. փոստեր (Gmail, Mail.ru և այլն):", 
            success: false 
        });
    }

    if (users.find(u => u.email === email)) return res.status(400).json({ message: "Այս մեյլով արդեն կա գրանցված մարդ:", success: false });

    const code = Math.floor(100000 + Math.random() * 900000);
    tempCodes[email] = { password, code };

    // Նամակի ուղարկում
    const mailOptions = {
        from: `"Armenian Posts" <${process.env.GMAIL_USER || 'yeghiazaryanaleq@gmail.com'}>`,
        to: email,
        subject: 'Հաստատեք ձեր գրանցումը',
        text: `Ձեր հաստատման կոդն է: ${code}`,
        html: `<b>Ձեր հաստատման կոդն է: ${code}</b>`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log("GMAIL ERROR:", error);
            return res.status(500).json({ message: "Սխալ մեյլի հետ: " + error.message, success: false });
        }
        console.log("Email sent: " + info.response);
        res.json({ message: "Կոդը ուղարկվեց մեյլին:", success: true });
    });
});

app.post('/verify', (req, res) => {
    const { email, code } = req.body;
    if (tempCodes[email] && tempCodes[email].code == code) {
        users.push({ email, password: tempCodes[email].password });
        delete tempCodes[email];
        res.json({ message: "Հաջողությամբ գրանցվեցիք:", success: true });
    } else {
        res.json({ message: "Սխալ կոդ:", success: false });
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const foundUser = users.find(u => u.email === email && u.password === password);
    if (foundUser) res.json({ message: "Բարի գալուստ:", success: true, email: foundUser.email });
    else res.json({ message: "Սխալ մուտքանուն կամ գաղտնաբառ:", success: false });
});

// --- ՀՐԱՊԱՐԱԿՈՒՄՆԵՐ ---
app.get('/posts', (req, res) => {
    res.json(posts);
});

app.post('/posts', (req, res) => {
    const { email, content } = req.body;
    const newPost = {
        id: Date.now().toString(),
        author: email,
        content: content,
        date: new Date().toLocaleString('hy-AM'),
        comments: []
    };
    posts.unshift(newPost);
    res.json({ success: true, post: newPost });
});

app.delete('/posts/:id', (req, res) => {
    const { id } = req.params;
    const { email } = req.body;
    const postIndex = posts.findIndex(p => p.id === id);
    if (postIndex === -1) return res.json({ success: false, message: "Պոստը չի գտնվել" });
    if (posts[postIndex].author !== email) return res.json({ success: false, message: "Իրավունք չունեք ջնջել այլոց պոստը:" });
    posts.splice(postIndex, 1);
    res.json({ success: true });
});

app.put('/posts/:id', (req, res) => {
    const { id } = req.params;
    const { email, newContent } = req.body;
    const post = posts.find(p => p.id === id);
    if (!post) return res.json({ success: false, message: "Պոստը չի գտնվել" });
    if (post.author !== email) return res.json({ success: false, message: "Իրավունք չունեք փոխել սա:" });
    post.content = newContent;
    res.json({ success: true });
});

app.post('/posts/:id/comments', (req, res) => {
    const { id } = req.params;
    const { email, text } = req.body;
    const post = posts.find(p => p.id === id);
    if (!post) return res.json({ success: false, message: "Պոստը չի գտնվել" });
    post.comments.push({
        author: email,
        text: text,
        date: new Date().toLocaleString('hy-AM')
    });
    res.json({ success: true });
});

// Render-ի համար պետք է օգտագործել process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Սերվերը միացված է ${PORT} պորտի վրա!`);
});
