const express = require('express');
const path = require('path');
const sgMail = require('@sendgrid/mail'); // Օգտագործում ենք SendGrid
const app = express();

app.use(express.json());

// --- ԿԱՐԵՎՈՐ: Տեղադրիր քո API Key-ը այստեղ կամ Render-ի Environment Variables-ում ---
sgMail.setApiKey(process.env.SENDGRID_API_KEY || 'SG.L8VV9GBSVEDZ3MBTW35KXNPB');

// Ժամանակավոր Բազաներ
const tempCodes = {}; 
const users = []; 
const posts = []; 

const allowedDomains = ['gmail.com', 'yahoo.com', 'mail.ru', 'yandex.ru', 'outlook.com', 'icloud.com'];

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ԱՎՏՈՐԻԶԱՑԻԱ ---
app.post('/register', async (req, res) => {
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

    // Նամակի ուղարկում SendGrid-ի միջոցով
    const msg = {
        to: email,
        from: 'yeghiazaryanaleq@gmail.com', // Պետք է լինի քո Verified Sender մեյլը SendGrid-ում
        subject: 'Հաստատեք ձեր գրանցումը',
        text: `Ձեր հաստատման կոդն է: ${code}`,
        html: `<div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
                <h2>Բարև Ձեզ:</h2>
                <p>Armenian Posts կայքում գրանցվելու համար օգտագործեք այս կոդը.</p>
                <h1 style="color: #007bff;">${code}</h1>
               </div>`,
    };

    try {
        await sgMail.send(msg);
        console.log("Email sent successfully via SendGrid");
        res.json({ message: "Կոդը ուղարկվեց մեյլին:", success: true });
    } catch (error) {
        console.error("SENDGRID ERROR:", error.response ? error.response.body : error);
        res.status(500).json({ message: "Չհաջողվեց ուղարկել նամակը: Ստուգեք API Key-ը:", success: false });
    }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Սերվերը միացված է ${PORT} պորտի վրա!`);
});
