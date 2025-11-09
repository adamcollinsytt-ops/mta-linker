// web.js
const express = require('express');
const mysql = require('mysql2/promise');
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

// رابط Authorize
app.get('/discord/authorize', (req, res) => {
  const { account_id } = req.query;
  if (!account_id) return res.status(400).send('Missing account_id');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state: account_id
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  const account_id = state;
  if (!code) return res.status(400).send('No code');

  try {
    const data = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      scope: 'identify'
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenJson = await tokenRes.json();
    const access_token = tokenJson.access_token;

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const discordUser = await userRes.json();

    await db.execute(
      'INSERT INTO discord_authorized (account_id, token, linked_at) VALUES (?, ?, NOW())',
      [account_id, discordUser.id]
    );

    res.send('✅ تم ربط الحساب بنجاح! يمكنك العودة إلى Discord.');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ حدث خطأ أثناء الربط');
  }
});

app.listen(process.env.PORT || 3000, () => console.log('🌐 Web server running'));

