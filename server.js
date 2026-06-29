'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN;
const HMAC_SECRET = process.env.HMAC_SECRET || 'default_hmac_secret';
const AES_KEY = process.env.AES_KEY;
const WS_PORT = process.env.APPLET_ID ? 3000 : (process.env.PORT || 3000);
const HTTP_PORT = process.env.APPLET_ID ? 3000 : (process.env.PORT || 3000);
const CHANNEL_ID = process.env.CHANNEL_ID ? parseInt(process.env.CHANNEL_ID) : undefined;
const CHANNEL_INV = process.env.CHANNEL_INV;
const GPLINKS_API = process.env.GPLINKS_API;
const SHRINKME_API = process.env.SHRINKME_API;
const MAX_FREE_DAYS = process.env.MAX_FREE_DAYS ? parseInt(process.env.MAX_FREE_DAYS) : 3;
const SUPER_ADMINS = new Set(
  (process.env.SUPER_ADMIN || '')
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n))
);

const { buildOwnerHTML } = require('./owner-panel.js');

const PROXY_SECRET = process.env.PROXY_SECRET;
const ALLOW_DIRECT_ACCESS = process.env.ALLOW_DIRECT_ACCESS !== 'false';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const DB_PATH = process.env.DB_PATH || './pkmod.db';

const CURRENT_VERSION = '1.0.0';
const MIN_VERSION = '1.0.0';

const MIN_SHRINKME_SECS = 55;
const MIN_GPLINKS_SECS = 115;
const MAX_STEP_SECS = 880;

const { Telegraf, Markup }  = require('telegraf');
const Database = require('libsql');
const { WebSocketServer, WebSocket } = require('ws');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const hpp = require('hpp');
const cors = require('cors');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

let db;

function q(sql, params = []) {
  const s = sql.trim().toUpperCase();
  if (s.startsWith('SELECT') || s.startsWith('PRAGMA')) {
    return db.prepare(sql).all(...params);
  }
  db.prepare(sql).run(...params);
  return [];
}

function q1(sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

const bot = new Telegraf(BOT_TOKEN);

const tgRateMap = new Map();
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!uid) return next();
  
  if (bannedTgIds.has(uid) && !isSA(uid)) {
    const lang = gl(ctx);
    if (ctx.callbackQuery) { try { await ctx.answerCbQuery(t(lang, 'banned_msg').replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').slice(0, 190), { show_alert: true }); } catch {} }
    else { try { await ctx.reply(t(lang, 'banned_msg'), { parse_mode: 'HTML' }); } catch {} }
    return;
  }

  // Anti-DDoS Rate Limit for Telegram (max 30 msgs / min)
  const now = Date.now();
  const windowStart = now - (now % 60000);
  let record = tgRateMap.get(uid);
  if (!record || record.window !== windowStart) record = { window: windowStart, count: 0 };
  record.count++;
  tgRateMap.set(uid, record);
  
  if (record.count > 30 && !isSA(uid)) {
    // Ignore updates from spamming user
    return;
  }

  return next();
});

// Periodic cleanup of TG rate map
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of upgradeAttemptsByIp) {
    if (now - rec.window > 60000) upgradeAttemptsByIp.delete(ip);
  }
}, 120_000);

setInterval(() => {
  const now = Date.now();
  for (const [uid, record] of tgRateMap) {
    if (now - record.window > 60000) tgRateMap.delete(uid);
  }
}, 120000);

const AES_KEY_VAL = AES_KEY || '00000000000000000000000000000000';
const AES_BYTES = Buffer.from(AES_KEY_VAL, 'hex');

function encrypt(obj) {
  const iv   = crypto.randomBytes(16);
  const text = JSON.stringify(obj);
  const c    = crypto.createCipheriv('aes-128-cbc', AES_BYTES, iv);
  const enc  = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(str) {
  try {
    const [ivHex, encHex] = str.split(':');
    const iv  = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const d   = crypto.createDecipheriv('aes-128-cbc', AES_BYTES, iv);
    const dec = Buffer.concat([d.update(enc), d.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch { return null; }
}

function verCmp(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i]||0) > (pb[i]||0)) return 1;
    if ((pa[i]||0) < (pb[i]||0)) return -1;
  }
  return 0;
}

const clients = new Map();

const bannedLibIds = new Set();
const bannedIps = new Set();
const bannedSerials = new Set();
const bannedTgIds = new Set();

let MAINTENANCE_MODE = false;

const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX_KEY = 3;
const AUTH_RATE_MAX_IP = 5;
const authAttemptsByKey = new Map();
const authAttemptsByIp = new Map();

const tempBannedIps = new Map();
const TEMP_BAN_MS = 30 * 60_000;
const TEMP_BAN_THRESHOLD_IP = 10;

function isTempBanned(ip) {
  const until = tempBannedIps.get(ip);
  if (!until) return false;
  if (Date.now() > until) { tempBannedIps.delete(ip); return false; }
  return true;
}

function checkRateLimit(map, id, max) {
  const now = Date.now();
  const windowStart = now - (now % AUTH_RATE_WINDOW_MS);
  
  let record = map.get(id);
  if (!record || record.window !== windowStart) {
    record = { window: windowStart, count: 0 };
  }
  
  record.count++;
  map.set(id, record);

  if (map === authAttemptsByIp && record.count >= TEMP_BAN_THRESHOLD_IP) {
    tempBannedIps.set(id, Date.now() + TEMP_BAN_MS);
    
  }
  return record.count > max;
}

const wsConnPerIp = new Map();
const WS_MAX_CONN_PER_IP = 20;
const WS_MAX_TOTAL_CONN = 500;

function wsSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encrypt(obj));
  }
}

function wsClose(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encrypt(obj), () => {
      setTimeout(() => ws.terminate(), 300);
    });
  } else {
    ws.terminate();
  }
}

function broadcastToLibId(lib_id, obj) {
  let count = 0;
  for (const [ws, meta] of clients) {
    if (meta.lib_id === lib_id) { wsSend(ws, obj); count++; }
  }
  return count;
}

function broadcastToKey(key, obj) {
  let count = 0;
  for (const [ws, meta] of clients) {
    if (meta.key === key) { wsSend(ws, obj); count++; }
  }
  return count;
}

function broadcastAll(obj) {
  for (const [ws] of clients) wsSend(ws, obj);
  return clients.size;
}


const upgradeAttemptsByIp = new Map();
function startWS(server) {
  const wss = new WebSocketServer({ 
    server, 
    verifyClient: (info, cb) => {
      const ip = getClientIp(info.req);
      
      const now = Date.now();
      const win = now - (now % 10000); // 10 seconds window
      let rec = upgradeAttemptsByIp.get(ip);
      if (!rec || rec.window !== win) rec = { window: win, count: 0 };
      rec.count++;
      upgradeAttemptsByIp.set(ip, rec);
      
      if (rec.count > 50) { // Max 50 connects per 10 seconds (~5/sec)
        tempBannedIps.set(ip, now + TEMP_BAN_MS);
      }

      if (isTempBanned(ip)) { info.req.socket.destroy(); return cb(false); }
      const token = info.req.headers['x-p2077kng-auth-token'];

      if (token === 'f7c6e831a49db2c0d835e412f8a3b5c61d7e8293a4b5c6d7e8f9a0b1c2d3e4f5') {
        cb(true);
      } else {
        info.req.socket.destroy(); return cb(false);
      }
    }
  });

  wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);

    if (clients.size >= WS_MAX_TOTAL_CONN) {
      ws.terminate(); return;
    }

    if (isTempBanned(ip)) { ws.terminate(); return; }
    const curConn = (wsConnPerIp.get(ip) || 0) + 1;
    if (curConn > WS_MAX_CONN_PER_IP) {
      
      ws.terminate(); return;
    }
    wsConnPerIp.set(ip, curConn);
    ws.on('close', () => {
      const c = (wsConnPerIp.get(ip) || 1) - 1;
      if (c <= 0) wsConnPerIp.delete(ip); else wsConnPerIp.set(ip, c);
    });

    const authTimer = setTimeout(() => {
      if (!clients.has(ws)) ws.terminate();
    }, 8000);

    ws.on('message', async (raw) => {
      let msg;
      try {
        const str = raw.toString();
        if (str.includes(':')) {
          msg = decrypt(str);
        } else {
          msg = JSON.parse(str);
        }
      } catch {
        ws.terminate(); return;
      }
      if (!msg || !msg.action) { ws.terminate(); return; }

      if (msg.action === 'auth') {
        clearTimeout(authTimer);
        const { key, serial, lib_id, version } = msg;
        if (!key || !serial || !lib_id) {
          wsClose(ws, { ok: false, reason: 'INVALID_PARAM' }); return;
        }

        if (bannedIps.has(ip)) {
          wsClose(ws, { ok: false, reason: 'IP_BANNED' }); return;
        }

        if (isTempBanned(ip)) {
          wsClose(ws, { ok: false, reason: 'RATE_LIMITED', message: 'Too many attempts. Please wait 10 minutes.' }); return;
        }

        if (bannedSerials.has(serial)) {
          wsClose(ws, { ok: false, reason: 'DEVICE_BANNED' }); return;
        }

        const ipLimited  = checkRateLimit(authAttemptsByIp, ip, AUTH_RATE_MAX_IP);
        const keyLimited = checkRateLimit(authAttemptsByKey, key, AUTH_RATE_MAX_KEY);
        if (ipLimited || keyLimited) {
          
          wsClose(ws, { ok: false, reason: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' }); return;
        }

        if (MAINTENANCE_MODE) {
          wsClose(ws, { ok: false, reason: 'SERVER_DISABLED', message: 'Server under maintenance. Please try again later.' }); return;
        }

        if (bannedLibIds.has(lib_id)) {
          wsClose(ws, { ok: false, reason: 'LIB_DISABLED' }); return;
        }

        const libRow = q1('SELECT * FROM pk_lib_ids WHERE lib_id=? LIMIT 1', [lib_id]);
        if (libRow && libRow.blocked) {
          wsClose(ws, { ok: false, reason: 'LIB_DISABLED' }); return;
        }

        const latestVerRow = q1('SELECT version, download_url FROM pk_versions ORDER BY id DESC LIMIT 1');
        const effectiveMin = latestVerRow?.version || MIN_VERSION;
        const effectiveCurrent = latestVerRow?.version || CURRENT_VERSION;
        if (verCmp(version || '0', effectiveMin) < 0) {
          wsClose(ws, {
            ok: false,
            reason: 'UPDATE_REQUIRED',
            current_version: effectiveCurrent,
            download_url: latestVerRow?.download_url || ''
          });
          return;
        }

        const row = q1(
          'SELECT * FROM keys_code WHERE user_key=? AND status=1 LIMIT 1', [key]
        );
        if (!row) {
          wsClose(ws, { ok: false, reason: 'KEY_NOT_FOUND' }); return;
        }
        if (row.blocked) {
          wsClose(ws, { ok: false, reason: 'USER_BLOCKED' }); return;
        }
        if (row.telegram_user_id && bannedTgIds.has(Number(row.telegram_user_id))) {
          wsClose(ws, { ok: false, reason: 'USER_BLOCKED' }); return;
        }

        const devices = (row.devices || '').split(',').filter(Boolean);
        const isFirstUse = devices.length === 0;
        if (!devices.includes(serial)) {
          if (row.max_devices > 0 && devices.length >= row.max_devices) {
            wsClose(ws, { ok: false, reason: 'MAX_DEVICE_REACHED' }); return;
          }
          devices.push(serial);
          q('UPDATE keys_code SET devices=? WHERE id=?', [devices.join(','), row.id]);
        }

        let expiredDate = row.expired_date;
        if (!expiredDate && isFirstUse) {
          const dur = row.duration;
          expiredDate = new Date(Date.now() + dur * 3600000).toISOString();
          q('UPDATE keys_code SET expired_date=? WHERE id=?', [expiredDate, row.id]);
        }

        if (expiredDate && new Date() > new Date(expiredDate)) {
          wsClose(ws, { ok: false, reason: 'EXPIRED_KEY' }); return;
        }

        const isAdmin = row.key_type === 'ADMIN' || row.key_type === 'OWNER' ? 1 : 0;
        clients.set(ws, {
          uid_key: row.id,
          key,
          lib_id,
          serial,
          telegram_id: row.telegram_user_id,
          lastPing: Date.now(),
          connectedAt: Date.now(),
          ip,
        });

        try {
          q(`INSERT INTO pk_key_devices(user_key,serial,lib_id,ip,version,first_seen,last_seen)
             VALUES(?,?,?,?,?,datetime('now'),datetime('now'))
             ON CONFLICT(user_key,serial) DO UPDATE SET
               lib_id=excluded.lib_id, ip=excluded.ip, version=excluded.version, last_seen=datetime('now')`,
            [key, serial, lib_id, ip, version || '']);
        } catch (e) { console.error('[pk_key_devices upsert]', e.message); }

        const verRow = q1('SELECT version, download_url FROM pk_versions ORDER BY id DESC LIMIT 1');
        const liveVersion = verRow?.version || CURRENT_VERSION;
        const liveDownloadUrl = verRow?.download_url || '';

        wsSend(ws, {
          ok : true,
          token : crypto.createHmac('sha256', HMAC_SECRET)
          .update(`${key}-${serial}-${lib_id}`).digest('hex').slice(0, 32),
          expiry : expiredDate,
          is_admin : isAdmin,
          version : liveVersion,
          download_url : liveDownloadUrl,
        });
        return;
      }

      if (!clients.has(ws)) {
        ws.terminate(); return;
      }

      if (msg.action === 'ping') {
        const meta = clients.get(ws);
        if (meta) meta.lastPing = Date.now();
        wsSend(ws, { action: 'pong' }); return;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
      ws.terminate();
    });
  });

  return wss;
}

setInterval(async () => {
  const now = new Date();
  const nowMs = Date.now();
  for (const [ws, clientData] of clients.entries()) {
    if (ws.readyState !== 1) { clients.delete(ws); continue; }
    if (clientData.lastPing && nowMs - clientData.lastPing > 90000) {
      
      ws.terminate(); clients.delete(ws); continue;
    }
    if (clientData && clientData.uid_key) {
      try {
        const row = q1('SELECT expired_date, blocked FROM keys_code WHERE id=? LIMIT 1', [clientData.uid_key]);
        if (row) {
          const expiredDate = new Date(row.expired_date);
          if (now > expiredDate || row.blocked === 1) {
            
            wsSend(ws, { action: "shutdown" });
            setTimeout(() => { ws.terminate(); }, 1000);
            clients.delete(ws);
          }
        }
      } catch (err) {
        console.error(`[Auto-Kick Error] Key ID ${clientData.uid_key}:`, err);
      }
    }
  }

  for (const [id, record] of authAttemptsByKey) {
    if (nowMs - record.window > AUTH_RATE_WINDOW_MS) authAttemptsByKey.delete(id);
  }
  for (const [id, record] of authAttemptsByIp) {
    if (nowMs - record.window > AUTH_RATE_WINDOW_MS) authAttemptsByIp.delete(id);
  }

  for (const [ip, until] of tempBannedIps) {
    if (nowMs > until) tempBannedIps.delete(ip);
  }
}, 30000);

const BOT_UA_SIGNALS = [
  'bot','crawl','spider','preview','fetch','curl','python','wget',
  'scraper','checker','validator','headless','phantom','selenium',
  'http','java/','go-http','axios','node-fetch','libwww','okhttp',
  'gplinks','shrinkme',
];
const BOT_USERNAME = 'pkngsupport_bot';

const WEB_RATE_WINDOW_MS  = 60_000;
const WEB_RATE_MAX_GLOBAL = 150;
const WEB_RATE_MAX_API    = 50;
const WEB_RATE_MAX_GETKEY = 5;
const WEB_TEMP_BAN_THRESHOLD = 300;
const webRateGlobal = new Map();
const webRateApi    = new Map();
const webRateGetkey = new Map();

function webRL(map, ip, max) {
  if (isTempBanned(ip)) return true;
  const now = Date.now();
  const windowStart = now - (now % WEB_RATE_WINDOW_MS);
  
  let record = map.get(ip);
  if (!record || record.window !== windowStart) {
    record = { window: windowStart, count: 0 };
  }
  
  record.count++;
  map.set(ip, record);

  if (map === webRateGlobal && record.count >= WEB_TEMP_BAN_THRESHOLD) {
    tempBannedIps.set(ip, Date.now() + TEMP_BAN_MS);
    
  }
  return record.count > max;
}

setInterval(() => {
  const now = Date.now();
  for (const m of [webRateGlobal, webRateApi, webRateGetkey]) {
    for (const [k, record] of m) {
      if (now - record.window > WEB_RATE_WINDOW_MS) m.delete(k);
    }
  }
}, 300_000);

setInterval(() => {
  try {
    q(`DELETE FROM pk_key_devices WHERE user_key IN (
        SELECT user_key FROM keys_code 
        WHERE expired_date IS NOT NULL AND expired_date < datetime('now', '-1 day')
       )`);
    q(`DELETE FROM keys_code WHERE expired_date IS NOT NULL AND expired_date < datetime('now', '-1 day')`);
  } catch(e) { }
}, 3600000);

function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    '0.0.0.0'
  ).split(',')[0].trim();
}

const WEB_BOT_UA = [
  'bot','crawl','spider','preview','fetch','curl','python','wget',
  'scraper','checker','validator','headless','phantom','selenium',
  'java/','go-http','axios','node-fetch','libwww','okhttp',
  'postman','insomnia','paw','restlet','httpie','thunder',
];
function isBotUA(ua) {
  if (!ua || ua.length < 10) return true;
  const l = ua.toLowerCase();
  return WEB_BOT_UA.some(s => l.includes(s));
}

function sendJSON(res, code, obj) {
  res.status(code)
    .set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    .end(JSON.stringify(obj));
}
function sendHTML(res, code, html, cacheSecs = 0) {
  res.status(code)
    .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheSecs > 0 ? `public, max-age=${cacheSecs}` : 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' })
    .end(html);
}

function genWebId() {

  let id;
  do { id = -(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)); }
  while (q1('SELECT 1 FROM pk_web_users WHERE web_uid=?', [id]));
  return id;
}

function createWebAccount() {
  const web_uid = genWebId();
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  q(`INSERT INTO pk_web_users(web_uid, token_hash, created_at) VALUES(?,?,datetime('now'))`, [web_uid, tokenHash]);
  return { web_uid, token };
}

function verifyWebAuth(web_uid, token) {
  if (!web_uid || !token || !Number.isInteger(web_uid) || web_uid >= 0) return false;
  const row = q1('SELECT * FROM pk_web_users WHERE web_uid=? LIMIT 1', [web_uid]);
  if (!row) return false;
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(row.token_hash));
  } catch { return false; }
}

function buildWebCbUrl(sessionToken, step) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', HMAC_SECRET)
    .update(`web:${sessionToken}:${step}:${ts}`).digest('hex');
  const base = process.env.PUBLIC_URL || (ALLOWED_DOMAIN ? `https://${ALLOWED_DOMAIN}` : `http://localhost:${HTTP_PORT}`);
  return `${base}/wcb?sid=${sessionToken}&step=${step}&ts=${ts}&sig=${sig}`;
}

async function startWebGetkey(web_uid, days) {
  q('DELETE FROM pk_web_keygen WHERE web_uid=?', [web_uid]);
  const sessionToken = crypto.randomBytes(16).toString('hex');
  q(
    `INSERT INTO pk_web_keygen(web_uid, session_token, total_steps, current_step, step_status, shortener_type, created_at) VALUES(?,?,?,0,'WAIT',?,datetime('now'))`,
    [web_uid, sessionToken, days, 'shrinkme']
  );
  return sessionToken;
}

async function buildWebStepPayload(sess) {
  const cur = parseInt(sess.current_step), total = parseInt(sess.total_steps);
  if (cur >= total) {
    return { done: true, step: total, total };
  }
  const rawUrl = buildWebCbUrl(sess.session_token, cur);
  const { url, type } = await shorten(rawUrl);

  q('UPDATE pk_web_keygen SET shortener_type=? WHERE session_token=?', [type, sess.session_token]);
  return { done: false, step: cur + 1, total, url };
}

const webResetCooldown = new Map();
const WEB_RESET_COOLDOWN_MS = 300_000;
const webGetkeyCooldown = new Map();
const WEB_GETKEY_COOLDOWN_SECS = 300;
const webGetkeyLock = new Set();

function buildPortalHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Key Portal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#000000;
  --bg2:#0a0a0a;
  --bg3:#121212;
  --border:#1f1f1f;
  --border2:#2c2c2c;
  --red:#8b0000;
  --red-bright:#c41e1e;
  --red-glow:rgba(196,30,30,.35);
  --text:#ffffff;
  --muted:#8a8a8a;
  --success:#2ecc71;
  --warn:#e8a33d;
  --font:'Space Grotesk',system-ui,sans-serif;
  --mono:'JetBrains Mono',monospace;
}
html{scroll-behavior:smooth}
body{
  font-family:var(--font);
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  display:flex;flex-direction:column;align-items:center;
  padding:0 16px 60px;
  position:relative;overflow-x:hidden;
}
body::after{
  content:'';position:fixed;top:-220px;left:50%;transform:translateX(-50%);
  width:760px;height:420px;
  background:radial-gradient(ellipse,rgba(139,0,0,.25) 0%,transparent 70%);
  pointer-events:none;z-index:0;
}

header{width:100%;max-width:480px;padding:44px 0 28px;text-align:center;position:relative;z-index:1}
.logo-ring{
  width:64px;height:64px;margin:0 auto 16px;
  border-radius:50%;
  background:#000;border:2px solid var(--red-bright);
  display:flex;align-items:center;justify-content:center;font-size:28px;
  box-shadow:0 0 28px var(--red-glow);
}
h1{font-size:26px;font-weight:700;letter-spacing:-.4px;color:#fff}
.sub{margin-top:8px;color:var(--muted);font-size:13px}

.card{
  width:100%;max-width:480px;
  background:var(--bg2);
  border:1px solid var(--border);
  padding:26px 22px;
  position:relative;z-index:1;margin-bottom:14px;
}
.card-title{
  display:flex;align-items:center;gap:9px;
  font-size:12px;font-weight:600;letter-spacing:.07em;
  color:var(--muted);text-transform:uppercase;margin-bottom:18px;
}
.card-title .dot{width:7px;height:7px;border-radius:50%;background:var(--red-bright);box-shadow:0 0 8px var(--red-bright)}

.tabs{display:flex;gap:0;background:var(--bg3);border:1px solid var(--border);padding:0;margin-bottom:22px}
.tab{
  flex:1;padding:11px 4px;background:none;border:none;
  color:var(--muted);font-size:12px;font-weight:600;font-family:var(--font);
  cursor:pointer;transition:all .15s;border-radius:0;
  border-right:1px solid var(--border);
}
.tab:last-child{border-right:none}
.tab.active{background:var(--red);color:#fff}
.tab:hover:not(.active){color:#fff}

label{display:block;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
input[type=text]{
  width:100%;background:var(--bg3);border:1px solid var(--border);
  color:var(--text);font-family:var(--mono);font-size:14px;
  padding:11px 13px;outline:none;margin-bottom:16px;
  border-radius:0;transition:border-color .15s;
}
input[type=text]:focus{border-color:var(--red-bright)}
input[type=text]::placeholder{color:var(--muted);opacity:.5}

.day-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.day-btn{
  background:var(--bg3);border:1px solid var(--border);
  color:var(--text);font-size:13px;font-weight:600;font-family:var(--font);
  padding:10px 4px;cursor:pointer;transition:all .15s;
  display:flex;flex-direction:column;align-items:center;gap:2px;
  border-radius:0;
}
.day-btn:hover{border-color:var(--red-bright)}
.day-btn.selected{border-color:var(--red-bright);background:rgba(196,30,30,.15);color:#fff}
.day-btn small{font-size:10px;color:var(--muted);font-weight:400}

.btn{
  width:100%;padding:13px;
  background:linear-gradient(180deg,var(--red-bright),#5c0000);
  border:1px solid #3d0000;
  border-radius:10px;
  color:#fff;font-size:14px;font-weight:700;font-family:var(--font);
  cursor:pointer;transition:filter .15s,transform .1s;
  letter-spacing:.02em;
}
.btn:hover{filter:brightness(1.15)}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.35;cursor:not-allowed;transform:none}
.btn.secondary{
  background:var(--bg3);border:1px solid var(--border2);color:var(--text);
}
.btn.secondary:hover{border-color:var(--red-bright)}
.btn.outline{
  background:transparent;border:1px solid var(--border2);color:var(--muted);
}
.btn.outline:hover{border-color:var(--red-bright);color:#fff}
.btn-row{display:flex;gap:8px;margin-top:10px}
.btn-row .btn{margin-top:0}

.result{display:none;margin-top:16px;padding:14px 16px;font-size:13px;line-height:1.65;border-radius:0}
.result.show{display:block;animation:fadeIn .25s ease}
.result.ok{background:rgba(46,204,113,.07);border:1px solid rgba(46,204,113,.25);color:#7ee2a8}
.result.err{background:rgba(196,30,30,.1);border:1px solid rgba(196,30,30,.35);color:#ff9d9d}
.result.warn{background:rgba(232,163,61,.07);border:1px solid rgba(232,163,61,.25);color:#f3c879}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

.key-box{
  background:#000;border:1px solid var(--border2);
  padding:12px 14px;font-family:var(--mono);font-size:13px;color:#fff;
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin-top:10px;cursor:pointer;border-radius:8px;
}
.key-box:hover{border-color:var(--red-bright)}
.key-box .copy-icon{font-size:15px;flex-shrink:0;opacity:.6}
.key-text{word-break:break-all}

.info-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px}
.info-row:last-child{border-bottom:none}
.info-label{color:var(--muted)}
.info-val{font-weight:600;color:var(--text);font-family:var(--mono);font-size:12px}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:6px}
.badge.active{background:rgba(46,204,113,.12);color:#5fe095}
.badge.expired{background:rgba(196,30,30,.15);color:#ff8080}
.badge.inactive{background:rgba(232,163,61,.1);color:#f3c879}

.spin{display:inline-block;width:15px;height:15px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}

.step-bar{display:flex;gap:5px;margin:18px 0}
.step-dot{flex:1;height:6px;background:var(--bg3);border:1px solid var(--border)}
.step-dot.filled{background:var(--red-bright);border-color:var(--red-bright)}

.account-box{
  background:var(--bg3);border:1px dashed var(--border2);padding:14px;
  margin-bottom:18px;font-size:12px;color:var(--muted);border-radius:8px;
}
.account-box b{color:#fff}
.account-box .wid{font-family:var(--mono);color:var(--red-bright);font-size:13px}

.confirm-box{
  background:rgba(196,30,30,.08);border:1px solid rgba(196,30,30,.3);
  padding:14px;margin-top:14px;border-radius:8px;font-size:13px;color:#ff9d9d;
}
.confirm-box .ck{font-family:var(--mono);color:#fff}

#maint-overlay{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,.96);
  z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:14px;text-align:center;padding:24px;
}
#maint-overlay.show{display:flex}
#maint-overlay .icon{font-size:52px}
#maint-overlay h2{font-size:22px;color:var(--warn)}
#maint-overlay p{color:var(--muted);font-size:13px}

@media(max-width:420px){h1{font-size:21px}.card{padding:18px 14px}}
</style>
</head>
<body>

<div id="maint-overlay">
  <div class="icon">🛠️</div>
  <h2>System Under Maintenance</h2>
  <p>Please wait a moment and try again later.</p>
</div>

<header>
  <div class="logo-ring">🔑</div>
  <h1>Key Portal</h1>
  <p class="sub">Get a Key — View Key — Reset Devices (No Telegram required)</p>
</header>

<div class="card">
  <div id="account-info"></div>

  <div class="card-title"><span class="dot"></span>Select an action</div>
  <div class="tabs">
    <button class="tab active" data-tab="getkey" onclick="switchTab('getkey')">Get Key</button>
    <button class="tab" data-tab="mykey" onclick="switchTab('mykey')">My Key</button>
    <button class="tab" data-tab="resetkey" onclick="switchTab('resetkey')">Reset</button>
  </div>

  <!-- ── TAB: GET KEY ── -->
  <div id="tab-getkey">
    <div id="gk-form">
      <label>Select number of days</label>
      <div class="day-grid" id="day-grid"></div>
      <button class="btn" id="gk-btn" onclick="doGetKey()">Get Free Key</button>
    </div>
    <div id="gk-progress" style="display:none">
      <div class="step-bar" id="step-bar"></div>
      <p id="step-label" style="font-size:13px;color:var(--muted);margin-bottom:14px;text-align:center"></p>
      <a id="step-link" class="btn" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">Open Step Link</a>
      <button class="btn secondary" style="margin-top:10px" onclick="checkStepStatus()">I've completed this — Check status</button>
      <button class="btn outline" style="margin-top:10px" onclick="cancelGetkeyFlow()">Cancel and start over</button>
    </div>
    <div class="result" id="gk-result"></div>
  </div>

  <!-- ── TAB: MY KEY ── -->
  <div id="tab-mykey" style="display:none">
    <button class="btn" id="mk-btn" onclick="doMyKey()">View My Key</button>
    <div class="result" id="mk-result"></div>
  </div>

  <!-- ── TAB: RESET KEY ── -->
  <div id="tab-resetkey" style="display:none">
    <label>Key to reset devices for</label>
    <input type="text" id="rk-key" placeholder="PK_FREE_3D_XXXXXX" maxlength="80" style="text-transform:uppercase">
    <button class="btn" id="rk-btn" onclick="doReset()">Reset Devices</button>
    <div class="result" id="rk-result"></div>
  </div>
</div>

<script>
const MAX_DAYS = ${MAX_FREE_DAYS};
let selectedDays = 1;
let lastKnownStep = 0;

// ── Web account (created on first visit, stored locally) ─────────
function getAccount(){
  try{ return JSON.parse(localStorage.getItem('kp_account')||'null'); }catch{ return null; }
}
function setAccount(acc){ localStorage.setItem('kp_account', JSON.stringify(acc)); }

async function ensureAccount(){
  let acc = getAccount();
  if(acc && acc.web_uid && acc.token) return acc;
  const r = await fetch('/api/account/create',{method:'POST'});
  const d = await r.json();
  if(d.ok){ acc = { web_uid: d.web_uid, token: d.token }; setAccount(acc); }
  return acc;
}

function renderAccountBox(acc){
  const el = document.getElementById('account-info');
  if(!acc){ el.innerHTML=''; return; }
  el.innerHTML =
    '<div class="account-box">'+
    'Your Web Account ID: <span class="wid">'+acc.web_uid+'</span><br>'+
    '<b>Save this ID</b> — this browser will remember it automatically for viewing/resetting your key later.'+
    '</div>';
}

(async function init(){
  const acc = await ensureAccount();
  renderAccountBox(acc);

  const params = new URLSearchParams(location.search);
  const stepResult = params.get('step');
  if(stepResult){
    history.replaceState(null,'',location.pathname);
    switchTab('getkey');
    document.getElementById('gk-form').style.display='none';
    document.getElementById('gk-progress').style.display='';
    if(stepResult==='ok'){
      await checkStepStatus();
    }else{
      const reason = params.get('reason')||'ERR';
      setResult('gk-result','err', errText({reason}));
    }
  }
})();

// ── day buttons
(function(){
  const g = document.getElementById('day-grid');
  for(let d=1; d<=MAX_DAYS; d++){
    const b = document.createElement('button');
    b.className = 'day-btn'+(d===1?' selected':'');
    b.innerHTML = d+'<small>day'+(d>1?'s':'')+'</small>';
    b.onclick = ()=>{ selectedDays=d; document.querySelectorAll('.day-btn').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); };
    g.appendChild(b);
  }
})();

function switchTab(name){
  ['getkey','mykey','resetkey'].forEach(t=>{
    document.getElementById('tab-'+t).style.display = t===name ? '' : 'none';
  });
  document.querySelectorAll('.tab').forEach(el=>{
    el.classList.toggle('active', el.dataset.tab===name);
  });
}

function setResult(id,type,html){
  const el=document.getElementById(id);
  el.className='result show '+type;
  el.innerHTML=html;
}
function clearResult(id){
  const el=document.getElementById(id);
  el.className='result'; el.innerHTML='';
}
function setBusy(btnId,busy,label){
  const btn=document.getElementById(btnId);
  if(!btn)return;
  btn.disabled=busy;
  if(busy) btn.innerHTML='<span class="spin"></span>Processing...';
  else if(label!==undefined) btn.innerHTML=label;
}

async function api(path, body){
  const acc = await ensureAccount();
  const r = await fetch(path,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({}, body||{}, acc?{web_uid:acc.web_uid, token:acc.token}:{}))
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, reason: 'ERR', _raw: text.slice(0,200), _status: r.status }; }
}

function fmtExpiry(d){
  if(!d) return '<span style="color:var(--warn)">Not started yet (unused)</span>';
  const dt=new Date(d), now=new Date();
  const exp = dt < now;
  const s = dt.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
  return exp ? '<span class="badge expired">Expired</span> '+s : '<span class="badge active">Active</span> '+s;
}

const ERR_MSG = {
  BANNED:'This account has been banned.',
  COOLDOWN:'Please wait {remain} seconds before trying again.',
  HAS_KEY:'You already have an active key. Check the "My Key" tab.',
  RATE_LIMITED:'Too many requests. Please wait a moment and try again.',
  MAINTENANCE:'System is temporarily under maintenance.',
  NOT_FOUND:'No key or account found.',
  OWNER_MISMATCH:'This key is not linked to your account.',
  SESSION_EXPIRED:'Your session has expired. Please start again.',
  TOO_FAST:'Completed too fast. Please follow each step fully.',
  TOO_SLOW:'Time ran out. Please start the step again.',
  BAD_REQUEST:'Invalid request.',
  ERR:'Something went wrong. Please try again.',
};
function errText(d){
  const tpl = ERR_MSG[d.reason] || ERR_MSG.ERR;
  const msg = tpl.replace('{remain}', d.remain!==undefined ? ('<b>'+d.remain+'</b>') : '');
  if(d._raw) return msg + '<br><small style="opacity:.5">'+d._status+': '+d._raw+'</small>';
  return msg;
}

// ── GET KEY flow ───────────────────────────────────────────────
async function doGetKey(){
  setBusy('gk-btn',true);
  clearResult('gk-result');
  try{
    const d = await api('/api/getkey/start', { days: selectedDays });
    if(d.maintenance){ document.getElementById('maint-overlay').classList.add('show'); return; }
    if(!d.ok){ setResult('gk-result','err', errText(d)); return; }
    document.getElementById('gk-form').style.display='none';
    document.getElementById('gk-progress').style.display='';
    lastKnownStep = 0;
    showStep(d);
  }catch(e){ setResult('gk-result','err', ERR_MSG.ERR); }
  finally{ setBusy('gk-btn', false, 'Get Free Key'); }
}

function cancelGetkeyFlow(){
  document.getElementById('gk-progress').style.display='none';
  document.getElementById('gk-form').style.display='';
  clearResult('gk-result');
  lastKnownStep = 0;
}

function renderStepBar(cur, total){
  const bar = document.getElementById('step-bar');
  bar.innerHTML='';
  for(let i=0;i<total;i++){
    const dot=document.createElement('div');
    dot.className='step-dot'+(i<cur?' filled':'');
    bar.appendChild(dot);
  }
}

function showStep(d){
  if(d.done){
    lastKnownStep = 999;
    document.getElementById('gk-progress').style.display='none';
    setResult('gk-result','ok',
      '<b>Key obtained successfully!</b>'+
      '<div class="key-box" onclick="copyKey(\\''+d.key+'\\')" title="Click to copy">'+
      '<span class="key-text">'+d.key+'</span><span class="copy-icon">⧉</span></div>'+
      '<p style="margin-top:10px;color:var(--muted);font-size:12px">Save this key — you can view it again anytime from the "My Key" tab using your web account.</p>'
    );
    return;
  }
  lastKnownStep = d.step - 1;
  renderStepBar(d.step-1, d.total);
  document.getElementById('step-label').textContent = 'Step '+d.step+' of '+d.total;
  const link = document.getElementById('step-link');
  link.href = d.url;
  link.textContent = 'Open Step '+d.step+' Link';
}

async function checkStepStatus(){
  setResult('gk-result','warn','Checking status...');
  try{
    const d = await api('/api/getkey/status', {});
    if(!d.ok){ setResult('gk-result','err', errText(d)); return; }
    clearResult('gk-result');
    if(d.done){ showStep(d); return; }
    if(d.step > lastKnownStep){
      lastKnownStep = d.step;
      showStep(d);
    }else{
      setResult('gk-result','warn','This step is not verified yet. Please open the link and complete it fully (wait until you reach the final destination page), then check again.');
    }
  }catch(e){ setResult('gk-result','err', ERR_MSG.ERR); }
}

// ── MY KEY ───────────────────────────────────────────────────
async function doMyKey(){
  setBusy('mk-btn',true);
  clearResult('mk-result');
  try{
    const d = await api('/api/mykey', {});
    if(!d.ok){ setResult('mk-result','err', errText(d)); return; }
    const k = d.key;
    const devCount = k.devices ? k.devices.split(',').filter(Boolean).length : 0;
    const maxDev = k.max_devices == 0 ? '∞' : k.max_devices;
    const isExpired = k.expired_date && new Date(k.expired_date) < new Date();

    let actionsHtml = '';
    if(isExpired){
      actionsHtml =
        '<div class="btn-row">'+
        '<button class="btn" onclick="renewExpiredKey()">Renew (Get New Key)</button>'+
        '<button class="btn outline" onclick="confirmDeleteKey()">Delete</button>'+
        '</div>'+
        '<div id="mk-confirm"></div>';
    } else {
      actionsHtml =
        '<div class="btn-row">'+
        '<button class="btn outline" onclick="confirmDeleteKey()">Delete Key</button>'+
        '</div>'+
        '<div id="mk-confirm"></div>';
    }

    setResult('mk-result','ok',
      '<div class="info-row"><span class="info-label">Key</span></div>'+
      '<div class="key-box" onclick="copyKey(\\''+k.user_key+'\\')" title="Click to copy">'+
      '<span class="key-text">'+k.user_key+'</span><span class="copy-icon">⧉</span></div>'+
      '<div class="info-row" style="margin-top:10px"><span class="info-label">Type</span><span class="info-val">'+k.key_type+'</span></div>'+
      '<div class="info-row"><span class="info-label">Status</span><span>'+fmtExpiry(k.expired_date)+'</span></div>'+
      '<div class="info-row"><span class="info-label">Devices</span><span class="info-val">'+devCount+' / '+maxDev+'</span></div>'+
      '<div class="info-row"><span class="info-label">Created</span><span class="info-val">'+(k.created_at||'-')+'</span></div>'+
      actionsHtml
    );
  }catch(e){ setResult('mk-result','err', ERR_MSG.ERR); }
  finally{ setBusy('mk-btn', false, 'View My Key'); }
}

function renewExpiredKey(){
  // Renewing an expired key works the same way as getting a new key:
  // it restarts the verification steps and issues a fresh key.
  switchTab('getkey');
  cancelGetkeyFlow();
  doGetKey();
}

function confirmDeleteKey(){
  const box = document.getElementById('mk-confirm');
  if(!box) return;
  box.innerHTML =
    '<div class="confirm-box">'+
    'Are you sure you want to delete this key? This cannot be undone.'+
    '<div class="btn-row">'+
    '<button class="btn outline" onclick="document.getElementById(\\'mk-confirm\\').innerHTML=\\'\\'">Cancel</button>'+
    '<button class="btn" onclick="doDeleteKey()">Confirm Delete</button>'+
    '</div></div>';
}

async function doDeleteKey(){
  const box = document.getElementById('mk-confirm');
  if(box) box.innerHTML = '<p style="font-size:12px;color:var(--muted)"><span class="spin"></span>Deleting...</p>';
  try{
    const d = await api('/api/mykey/delete', {});
    if(d.ok){
      setResult('mk-result','ok','Key deleted successfully. You can get a new one from the "Get Key" tab.');
    }else{
      setResult('mk-result','err', errText(d));
    }
  }catch(e){ setResult('mk-result','err', ERR_MSG.ERR); }
}

// ── RESET KEY ────────────────────────────────────────────────
async function doReset(){
  const key = document.getElementById('rk-key').value.trim().toUpperCase();
  if(!key){ setResult('rk-result','err','Please enter a key.'); return; }
  setBusy('rk-btn',true);
  clearResult('rk-result');
  try{
    const d = await api('/api/resetkey', { key });
    if(d.ok){
      setResult('rk-result','ok','Devices reset successfully!<br><small>Key <b>'+key+'</b> can now be used on a new device.</small>');
    }else{
      setResult('rk-result','err', errText(d));
    }
  }catch(e){ setResult('rk-result','err', ERR_MSG.ERR); }
  finally{ setBusy('rk-btn', false, 'Reset Devices'); }
}

function copyKey(k){
  navigator.clipboard?.writeText(k).then(()=>{
    const boxes = document.querySelectorAll('.key-box');
    boxes.forEach(b=>{
      if(b.querySelector('.key-text').textContent === k){
        const icon = b.querySelector('.copy-icon');
        icon.textContent = '✓';
        setTimeout(()=>{ icon.textContent='⧉'; }, 1500);
      }
    });
  });
}
</script>
</body>
</html>`;
}

function buildAdminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard</title>
<style>
:root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f8fafc; --text-muted: #94a3b8; --primary: #3b82f6; --primary-hover: #2563eb; --danger: #ef4444; --danger-hover: #dc2626; --success: #10b981; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); padding: 16px; line-height: 1.5; }
h1, h2, h3 { margin-bottom: 12px; font-weight: 600; }
h1 { font-size: 1.5rem; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.1rem; color: #cbd5e1; }
.card { background: var(--card); padding: 16px; border: 1px solid var(--border); margin-bottom: 16px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
input, button, select { width: 100%; padding: 12px; margin-bottom: 12px; background: #0f172a; color: var(--text); border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; outline: none; transition: border-color 0.2s; }
input:focus, select:focus { border-color: var(--primary); }
button { background: var(--primary); color: white; cursor: pointer; font-weight: 600; border: none; transition: background 0.2s; }
button:hover { background: var(--primary-hover); }
button.danger { background: var(--danger); }
button.danger:hover { background: var(--danger-hover); }
.grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media(min-width: 768px) { .grid { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); } h1 { font-size: 2rem; } }
.badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; }
.badge.active { background: rgba(16,185,129,0.2); color: #34d399; }
.badge.expired { background: rgba(239,68,68,0.2); color: #f87171; }
.badge.free { background: rgba(59,130,246,0.2); color: #60a5fa; }
.result-box { margin-top: 8px; font-size: 0.9rem; }
.stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px; }
.stat-box { background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; text-align: center; }
.stat-num { font-size: 1.5rem; font-weight: bold; color: var(--primary); }
.stat-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
.list-item { background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; font-size: 0.9rem; }
.list-item strong { color: #e2e8f0; }
.list-item .meta { color: var(--text-muted); font-size: 0.8rem; margin-top: 4px; }
.action-row { display: flex; gap: 8px; margin-top: 12px; }
.action-row button { margin-bottom: 0; padding: 8px; font-size: 0.9rem; }
#login { max-width: 360px; margin: 10vh auto; }
#dashboard { display: none; max-width: 1200px; margin: 0 auto; }
.empty-state { text-align: center; color: var(--text-muted); padding: 20px 0; font-style: italic; }
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #334155; color: white; padding: 12px 24px; border-radius: 9999px; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0; pointer-events: none; transition: opacity 0.3s; z-index: 1000; }
.toast.show { opacity: 1; }
</style>
</head>
<body>

<div id="login" class="card">
  <h2>Admin Login</h2>
  <p style="color:var(--text-muted); margin-bottom: 16px; font-size: 0.9rem;">Please authenticate to access the dashboard.</p>
  <input type="password" id="admin-pass" placeholder="Password" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Login</button>
  <div id="login-res" style="color:var(--danger); margin-top:12px; font-size:0.9rem; text-align:center;"></div>
</div>

<div id="dashboard">
  <h1>⚙️ System Administration</h1>
  
  <div class="grid">
    <div class="card">
      <h3>📊 System Overview</h3>
      <div id="stats-out">
        <div class="empty-state">Loading stats...</div>
      </div>
      <button onclick="loadStats()" style="margin-top: 16px;">Refresh Stats</button>
    </div>
    
    <div class="card">
      <h3>🔑 Generate Key</h3>
      <input type="number" id="gen-days" placeholder="Duration (Days)" value="30">
      <div style="display:flex; gap:12px;">
        <input type="number" id="gen-dev" placeholder="Max Devices" value="1">
        <select id="gen-type">
          <option value="PAID">PAID</option>
          <option value="FREE">FREE</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </div>
      <input type="text" id="gen-note" placeholder="Custom Note (Optional)">
      <button onclick="genKey()">Generate Key</button>
      <div id="gen-out" class="result-box"></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>🔍 Manage & Search Key</h3>
      <input type="text" id="search-q" placeholder="Enter Key or Telegram ID" onkeydown="if(event.key==='Enter')searchDb()">
      <div class="action-row">
        <button onclick="searchDb()">Search</button>
      </div>
      <div id="search-out" style="margin-top: 16px;"></div>
    </div>

    <div class="card">
      <h3>📡 Online Connections & Admins</h3>
      <div style="display:flex; gap:8px;">
        <button onclick="getOnline()">Refresh Online List</button>
        <button onclick="listAdmins()">View Admins</button>
      </div>
      <div id="online-out" style="margin-top: 16px;">
        <div class="empty-state">Click a button to view data.</div>
      </div>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function formatDate(iso) {
  if(!iso) return 'N/A';
  return new Date(iso).toLocaleString();
}

function renderStats(data) {
  if(!data) return;
  const html = \`
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-num">\${data.totalKeys || 0}</div>
        <div class="stat-label">Total Keys</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">\${data.totalDevices || 0}</div>
        <div class="stat-label">Total Devices</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">\${data.totalWebUsers || 0}</div>
        <div class="stat-label">Web Users</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">\${data.activeConnections || 0}</div>
        <div class="stat-label">Online Conns</div>
      </div>
    </div>
  \`;
  document.getElementById('stats-out').innerHTML = html;
}

function renderKeys(keys) {
  const out = document.getElementById('search-out');
  if(!keys || keys.length === 0) {
    out.innerHTML = '<div class="empty-state">No matching keys found.</div>';
    return;
  }
  let html = '';
  keys.forEach(k => {
    const isUsed = (k.devices||'').split(',').filter(Boolean).length > 0;
    const isExpired = isUsed && k.expired_date && new Date() > new Date(k.expired_date);
    let statBadge = isUsed ? (isExpired ? '<span class="badge expired">Expired</span>' : '<span class="badge active">Active</span>') : '<span class="badge free">Unused</span>';
    
    html += \`
      <div class="list-item">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="word-break:break-all;">\${k.user_key}</strong>
          \${statBadge}
        </div>
        <div class="meta">
          <div>Type: \${k.key_type} | Max Dev: \${k.max_devices} | Days: \${Math.round(k.duration/24)}</div>
          \${k.telegram_user_id ? \`<div>Owner TGID: \${k.telegram_user_id}</div>\` : ''}
          \${k.note ? \`<div>Note: \${k.note}</div>\` : ''}
        </div>
        <div class="action-row">
          <input type="number" id="renew-days-\${k.user_key}" placeholder="Days" style="width:70px; margin-bottom:0;" value="30">
          <button onclick="renewKey('\${k.user_key}')" style="padding:8px 12px;">Renew</button>
          <button class="danger" onclick="resetDev('\${k.user_key}')" style="padding:8px 12px;">Reset Dev</button>
          <button class="danger" onclick="delKey('\${k.user_key}')" style="padding:8px 12px;">Delete</button>
        </div>
      </div>
    \`;
  });
  out.innerHTML = html;
}

function renderOnline(list) {
  const out = document.getElementById('online-out');
  if(!list || list.length === 0) {
    out.innerHTML = '<div class="empty-state">No devices currently online.</div>';
    return;
  }
  let html = '';
  list.forEach(c => {
    html += \`
      <div class="list-item">
        <strong style="word-break:break-all;">\${c.key}</strong>
        <div class="meta">
          <div>IP: \${c.ip || 'N/A'}</div>
          <div>Serial: \${c.serial || 'N/A'}</div>
          <div>App Type: \${c.type || 'N/A'}</div>
          \${c.telegram_id ? \`<div>User TGID: \${c.telegram_id}</div>\` : ''}
          <div>Connected: \${formatDate(c.connectedAt)}</div>
        </div>
      </div>
    \`;
  });
  out.innerHTML = html;
}

function renderAdmins(data) {
  const out = document.getElementById('online-out');
  if(!data || (!data.admins.length && !data.super.length)) {
    out.innerHTML = '<div class="empty-state">No admins found.</div>';
    return;
  }
  let html = '';
  if (data.super) {
    data.super.forEach(s => {
      html += \`<div class="list-item"><strong>\${s}</strong> <span class="badge active" style="margin-left:8px;">Super Admin</span></div>\`;
    });
  }
  if (data.admins) {
    data.admins.forEach(a => {
      html += \`<div class="list-item">
        <strong>\${a.telegram_id}</strong>
        <div class="meta">Added: \${formatDate(a.added_at)}</div>
      </div>\`;
    });
  }
  out.innerHTML = html;
}

async function getAcc() {
  let acc = JSON.parse(localStorage.getItem('kp_account'));
  if(!acc) {
    try {
      const r = await fetch('/api/account/create', {method:'POST'});
      const d = await r.json();
      if(d.ok) { acc = { web_uid: d.web_uid, token: d.token }; localStorage.setItem('kp_account', JSON.stringify(acc)); }
      else { showToast('Failed to create account'); return null; }
    } catch(e) { return null; }
  }
  return acc;
}

async function api(act, pay={}) {
  const acc = await getAcc();
  if(!acc) return null;
  try {
    const r = await fetch('/api/admin/action', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action: act, payload: pay, web_uid: acc.web_uid, token: acc.token })
    });
    const d = await r.json();
    if(r.status === 403 || r.status === 401 || d.reason === 'SESSION_EXPIRED') { 
      document.getElementById('login').style.display='block'; 
      document.getElementById('dashboard').style.display='none'; 
      localStorage.removeItem('kp_account');
    }
    return d;
  } catch(e) { showToast('Network Error'); return null; }
}

async function login() {
  const acc = await getAcc();
  if(!acc) return;
  const p = document.getElementById('admin-pass').value;
  const r = await fetch('/api/admin/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: p, web_uid: acc.web_uid, token: acc.token })
  });
  const d = await r.json();
  if(d.ok) { 
    document.getElementById('login').style.display='none'; 
    document.getElementById('dashboard').style.display='block'; 
    loadStats(); 
  } else { 
    document.getElementById('login-res').innerText = 'Failed: ' + (d.reason||'Invalid password'); 
  }
}

async function loadStats() {
  const d = await api('stats');
  if(d && d.ok) renderStats(d.data);
}

async function genKey() {
  const d = await api('genkey', { 
    days: document.getElementById('gen-days').value, 
    max_devices: document.getElementById('gen-dev').value, 
    type: document.getElementById('gen-type').value, 
    note: document.getElementById('gen-note').value 
  });
  if(d && d.ok) {
    document.getElementById('gen-out').innerHTML = \`
      <div style="background:rgba(16,185,129,0.1); border:1px solid #10b981; padding:12px; border-radius:8px; margin-top:12px;">
        <div style="font-size:0.8rem; color:#a7f3d0; margin-bottom:4px;">Successfully Generated</div>
        <strong style="color:#fff; word-break:break-all; user-select:all;">\${d.key}</strong>
      </div>
    \`;
    loadStats();
  } else if(d) {
    showToast('Failed: ' + d.reason);
  }
}

async function searchDb() {
  const q = document.getElementById('search-q').value;
  const d = await api('search', { query: q });
  if(d && d.ok) renderKeys(d.keys);
}

async function renewKey(key) {
  const days = document.getElementById('renew-days-' + key).value;
  const d = await api('renewkey', { key, days });
  if(d && d.ok) { showToast('Renewed successfully'); searchDb(); }
  else if(d) showToast('Failed: ' + d.reason);
}

async function resetDev(key) {
  if(!confirm('Are you sure you want to reset devices for this key?')) return;
  const d = await api('resetdev', { key });
  if(d && d.ok) { showToast('Devices reset successfully'); searchDb(); }
  else if(d) showToast('Failed: ' + d.reason);
}

async function delKey(key) {
  if(!confirm('Are you sure you want to delete this key? This action is irreversible.')) return;
  const d = await api('delkey', { key });
  if(d && d.ok) { showToast('Key deleted'); searchDb(); loadStats(); }
  else if(d) showToast('Failed: ' + d.reason);
}

async function getOnline() {
  const d = await api('online');
  if(d && d.ok) renderOnline(d.online);
}

async function listAdmins() {
  const d = await api('listadmins');
  if(d && d.ok) renderAdmins(d);
}

// Check session on load
window.onload = async () => {
  const acc = localStorage.getItem('kp_account');
  if(acc) {
    // try background stats load to verify session
    const d = await api('stats');
    if(d && d.ok) {
      document.getElementById('login').style.display='none'; 
      document.getElementById('dashboard').style.display='block';
      renderStats(d.data);
    }
  }
};
</script>
</body>
</html>`;
}

function startHTTP() {
  const app = express();
  app.set('trust proxy', true);

  // Anti-DDoS and Security Middleware
  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
  app.use(cors());
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));
  app.use(hpp());

  app.use('/health', (req, res) => {
    if (ALLOWED_DOMAIN) {
      const host = req.hostname;
      const xForwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
      const headerHost = (req.headers.host || '').split(':')[0].trim();
      if (host === ALLOWED_DOMAIN || xForwardedHost === ALLOWED_DOMAIN || headerHost === ALLOWED_DOMAIN) {
        return res.status(403).end();
      }
    }
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }
    return res.status(405).end();
  });

  app.use((req, res, next) => {
    if (ALLOWED_DOMAIN) {
      const host = req.hostname;
      const xForwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
      const headerHost = (req.headers.host || '').split(':')[0].trim();
      
      if (host !== ALLOWED_DOMAIN && xForwardedHost !== ALLOWED_DOMAIN && headerHost !== ALLOWED_DOMAIN) {
        return res.status(403).set('Content-Type', 'text/plain').set('Connection', 'close').end('Forbidden - Access via this domain is blocked.');
      }
    }
    next();
  });

  app.use((req, res, next) => {
    if (ALLOW_DIRECT_ACCESS) {
      return next();
    }
    const secretFromWorker = req.headers['x-proxy-secret'];
    let isValid = false;
    if (secretFromWorker) {
      try {
        const a = Buffer.from(secretFromWorker);
        const b = Buffer.from(PROXY_SECRET || '');
        isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch { isValid = false; }
    }
    if (!isValid) {
      return res.status(403).set('Content-Type', 'text/plain').set('Connection', 'close').end('Forbidden');
    }
    next();
  });

  app.use((req, res, next) => {
    const ip = getClientIp(req);
    const isOwnerPath = req.path.startsWith('/api/owner/') || req.path.startsWith('/owner') || req.path.startsWith('/api/admin') || req.path.startsWith('/admin');
    
    if (isTempBanned(ip) && !isOwnerPath) {
      req.socket.destroy(); // Aggressive DDoS block
      return;
    }
    
    const ua = req.headers['user-agent'];
    if (isBotUA(ua) && !isOwnerPath) {
      req.socket.destroy();
      return;
    }

    if (!isOwnerPath) {
      if (webRL(webRateGlobal, ip, WEB_RATE_MAX_GLOBAL)) {
        req.socket.destroy(); // Aggressive DDoS block
        return;
      }
    }
    next();
  });

  app.get('/', (req, res) => sendHTML(res, 200, buildPortalHTML(), 300));

  app.post('/api/account/create', (req, res) => {
    try {
      const acc = createWebAccount();
      return sendJSON(res, 200, { ok: true, web_uid: acc.web_uid, token: acc.token });
    } catch { return sendJSON(res, 500, { ok: false, reason: 'ERR' }); }
  });

  app.use('/api/', (req, res, next) => {
    if (req.path.includes('/account/create') || req.path.includes('/owner/')) return next();
    const body = req.body || {};
    const web_uid = parseInt(body.web_uid);
    const token = body.token;
    if (!verifyWebAuth(web_uid, token)) return sendJSON(res, 401, { ok: false, reason: 'SESSION_EXPIRED' });
    if (bannedTgIds.has(web_uid)) return sendJSON(res, 200, { ok: false, reason: 'BANNED' });
    req.web_uid = web_uid;
    next();
  });

  app.post('/api/mykey', (req, res) => {
    try {
      const row = q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1', [req.web_uid]);
      if (!row) return sendJSON(res, 200, { ok: false, reason: 'NOT_FOUND' });
      if (row.blocked) return sendJSON(res, 200, { ok: false, reason: 'BANNED' });
      return sendJSON(res, 200, { ok: true, key: {
        user_key: row.user_key,
        key_type: row.key_type,
        expired_date: row.expired_date,
        devices: row.devices,
        max_devices: row.max_devices,
        created_at: row.created_at,
      }});
    } catch { return sendJSON(res, 500, { ok: false, reason: 'ERR' }); }
  });

  app.post('/api/mykey/delete', (req, res) => {
    try {
      const row = q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1', [req.web_uid]);
      if (!row) return sendJSON(res, 200, { ok: false, reason: 'NOT_FOUND' });
      q('DELETE FROM keys_code WHERE user_key=? AND telegram_user_id=?', [row.user_key, req.web_uid]);
      return sendJSON(res, 200, { ok: true });
    } catch { return sendJSON(res, 500, { ok: false, reason: 'ERR' }); }
  });

  app.post('/api/getkey/start', async (req, res) => {
    const ip = getClientIp(req);
    if (webRL(webRateGetkey, ip, WEB_RATE_MAX_GETKEY)) return sendJSON(res, 429, { ok: false, reason: 'RATE_LIMITED' });
    if (MAINTENANCE_MODE) return sendJSON(res, 200, { ok: false, reason: 'MAINTENANCE', maintenance: true });
    const days = parseInt(req.body.days);
    if (!days || days < 1 || days > MAX_FREE_DAYS) return sendJSON(res, 400, { ok: false, reason: 'BAD_REQUEST' });
    const web_uid = req.web_uid;
    if (webGetkeyLock.has(web_uid)) return sendJSON(res, 200, { ok: false, reason: 'RATE_LIMITED' });
    webGetkeyLock.add(web_uid);
    try {
      const lastTs = webGetkeyCooldown.get(web_uid) || 0;
      const elapsed = Math.floor(Date.now() / 1000) - lastTs;
      if (elapsed < WEB_GETKEY_COOLDOWN_SECS) {
        return sendJSON(res, 200, { ok: false, reason: 'COOLDOWN', remain: WEB_GETKEY_COOLDOWN_SECS - elapsed });
      }
      const existing = q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1', [web_uid]);
      if (existing) {
        const used = (existing.devices || '').split(',').filter(Boolean).length > 0;
        const expired = used && existing.expired_date ? Date.now() > new Date(existing.expired_date).getTime() : false;
        if (!expired) return sendJSON(res, 200, { ok: false, reason: 'HAS_KEY' });
      }
      webGetkeyCooldown.set(web_uid, Math.floor(Date.now() / 1000));
      incStat('getkey_click');
      const sessionToken = await startWebGetkey(web_uid, days);
      const sess = q1('SELECT * FROM pk_web_keygen WHERE session_token=? LIMIT 1', [sessionToken]);
      const payload = await buildWebStepPayload(sess);
      return sendJSON(res, 200, Object.assign({ ok: true }, payload));
    } catch (e) {
      webGetkeyCooldown.delete(web_uid);
      return sendJSON(res, 500, { ok: false, reason: 'ERR' });
    } finally {
      webGetkeyLock.delete(web_uid);
    }
  });

  app.post('/api/getkey/status', async (req, res) => {
    try {
      const web_uid = req.web_uid;
      const sess = q1('SELECT * FROM pk_web_keygen WHERE web_uid=? ORDER BY created_at DESC LIMIT 1', [web_uid]);
      if (!sess) return sendJSON(res, 200, { ok: false, reason: 'SESSION_EXPIRED' });
      if (sess.step_status === 'DONE' && sess.keyname) {
        return sendJSON(res, 200, { ok: true, done: true, key: sess.keyname });
      }
      const cur = parseInt(sess.current_step), total = parseInt(sess.total_steps);
      if (cur >= total) {
        const days = total, dur = days * 24;
        const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
        const newKey = `PK_FREE_${days}D_${rand}`;
        q(`INSERT INTO keys_code(user_key,key_type,duration,max_devices,devices,status,telegram_user_id,created_at) VALUES(?,?,?,1,'',1,?,datetime('now'))`,
          [newKey, 'FREE', dur, web_uid]);
        incStat('getkey_done');
        q(`UPDATE pk_web_keygen SET step_status='DONE', keyname=? WHERE session_token=?`, [newKey, sess.session_token]);
        return sendJSON(res, 200, { ok: true, done: true, key: newKey });
      }
      const payload = await buildWebStepPayload(sess);
      return sendJSON(res, 200, Object.assign({ ok: true, advanced: false }, payload));
    } catch { return sendJSON(res, 500, { ok: false, reason: 'ERR' }); }
  });

  app.post('/api/resetkey', (req, res) => {
    const keyStr = req.body.key;
    if (!keyStr || typeof keyStr !== 'string') return sendJSON(res, 400, { ok: false, reason: 'BAD_REQUEST' });
    const cleanKey = keyStr.trim().toUpperCase();
    const web_uid = req.web_uid;
    const row = q1('SELECT * FROM keys_code WHERE user_key=? AND status=1 LIMIT 1', [cleanKey]);
    if (!row) return sendJSON(res, 200, { ok: false, reason: 'NOT_FOUND' });
    if (row.blocked) return sendJSON(res, 200, { ok: false, reason: 'BANNED' });
    if (Number(row.telegram_user_id) !== web_uid) return sendJSON(res, 200, { ok: false, reason: 'OWNER_MISMATCH' });
    const lastReset = webResetCooldown.get(web_uid) || 0;
    const sinceReset = Date.now() - lastReset;
    if (sinceReset < WEB_RESET_COOLDOWN_MS) {
      return sendJSON(res, 200, { ok: false, reason: 'COOLDOWN', remain: Math.ceil((WEB_RESET_COOLDOWN_MS - sinceReset) / 1000) });
    }
    try {
      resetKeyData(cleanKey);
      webResetCooldown.set(web_uid, Date.now());
      return sendJSON(res, 200, { ok: true });
    } catch { return sendJSON(res, 500, { ok: false, reason: 'ERR' }); }
  });

  const adminSessions = new Set();
  app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
      adminSessions.add(req.web_uid);
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 401, { ok: false, reason: 'INVALID_PASSWORD' });
  });

  app.use('/api/admin/', (req, res, next) => {
    if (req.path === '/login') return next();
    if (!adminSessions.has(req.web_uid)) return sendJSON(res, 403, { ok: false, reason: 'NOT_ADMIN' });
    next();
  });

  app.post('/api/admin/action', async (req, res) => {
    try {
      const { action, payload } = req.body;
      if (action === 'stats') {
        const totalKeys = q1('SELECT COUNT(*) as c FROM keys_code').c;
        const totalDevices = q1('SELECT COUNT(*) as c FROM pk_key_devices').c;
        const totalWebUsers = q1('SELECT COUNT(*) as c FROM pk_web_users').c;
        return sendJSON(res, 200, { ok: true, data: { totalKeys, totalDevices, totalWebUsers, activeConnections: clients.size } });
      }
      if (action === 'genkey') {
        const days = parseInt(payload.days) || 1;
        const maxDev = parseInt(payload.max_devices) || 1;
        const type = payload.type || 'PAID';
        const note = (payload.note || '').trim();
        let newKey, cleanNote = '';
        if (!note || note === 'SKIP_NAME' || note === '-') {
          const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
          newKey = `PK_${type}_${days}D_${rand}`;
        } else {
          cleanNote = note.replace(/[^A-Za-z0-9_\-]/g, '');
          newKey = `PK_${type}_${cleanNote}`;
        }
        q(`INSERT INTO keys_code(user_key,key_type,duration,max_devices,devices,status,note,created_by,created_at) VALUES(?,?,?,?,?,1,?,?,datetime('now'))`,
          [newKey, type, days * 24, maxDev, '', cleanNote, req.web_uid]);
        return sendJSON(res, 200, { ok: true, key: newKey });
      }
      if (action === 'delkey') {
        const key = (payload.key || '').trim().toUpperCase();
        q('DELETE FROM keys_code WHERE user_key=?', [key]);
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'search') {
        const query = `%${(payload.query || '').trim()}%`;
        const rows = q('SELECT * FROM keys_code WHERE user_key LIKE ? OR telegram_user_id LIKE ? LIMIT 50', [query, query]);
        return sendJSON(res, 200, { ok: true, keys: rows });
      }
      if (action === 'resetdev') {
        const key = (payload.key || '').trim().toUpperCase();
        resetKeyData(key);
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'online') {
        const online = [];
        for (const [uid, c] of clients.entries()) {
          online.push({ uid, key: c.user_key, ip: c.ip, type: c.keyType, lib_id: c.lib_id, telegram_id: c.telegram_id, serial: c.serial, connectedAt: c.connectedAt });
        }
        return sendJSON(res, 200, { ok: true, online });
      }
      if (action === 'renewkey') {
        const key = (payload.key || '').trim().toUpperCase();
        const days = parseInt(payload.days) || 1;
        try {
          q('UPDATE keys_code SET duration=?,expired_date=NULL WHERE user_key=?',[days*24,key]);
          return sendJSON(res, 200, { ok: true });
        } catch (e) {
          return sendJSON(res, 404, { ok: false, reason: 'NOT_FOUND' });
        }
      }
      if (action === 'listadmins') {
        const admins = q('SELECT telegram_id,added_at FROM pk_admins');
        return sendJSON(res, 200, { ok: true, admins, super: [...SUPER_ADMINS] });
      }
      return sendJSON(res, 400, { ok: false, reason: 'UNKNOWN_ACTION' });
    } catch(e) { return sendJSON(res, 500, { ok: false, reason: 'ERR', error: e.message }); }
  });

  app.post('/api/owner/action', async (req, res) => {
    try {
      const ownerPath = getSysConfig('owner_path');
      if (!ownerPath || !req.body || req.body.hash !== ownerPath) {
        return sendJSON(res, 403, { ok: false, reason: 'FORBIDDEN' });
      }
      const { action, payload } = req.body;
      if (action === 'listadmins') {
        const admins = q('SELECT telegram_id,added_at FROM pk_admins');
        return sendJSON(res, 200, { ok: true, admins, super: [...SUPER_ADMINS] });
      }
      if (action === 'addadmin') {
        const tgid = parseInt(payload.tgid);
        if (tgid && !SUPER_ADMINS.has(tgid)) {
          q('INSERT OR IGNORE INTO pk_admins(telegram_id) VALUES(?)', [tgid]);
          ac.ts = 0;
        }
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'rmadmin') {
        const tgid = parseInt(payload.tgid);
        q('DELETE FROM pk_admins WHERE telegram_id=?', [tgid]);
        ac.ts = 0;
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'msg') {
        const { targetType, target, message } = payload;
        const out = { action: 'admin_message', message, from: 'Admin' };
        let c = 0;
        if (targetType === 'all') c = broadcastAll(out);
        else if (targetType === 'key') c = broadcastToKey(target, out);
        else if (targetType === 'lib') c = broadcastToLib(target, out);
        else if (targetType === 'serial') c = broadcastToSerial(target, out);
        return sendJSON(res, 200, { ok: true, count: c });
      }
      if (action === 'setversion') {
        q(`INSERT INTO pk_versions(version,download_url,created_at) VALUES(?,?,datetime('now'))`, [payload.version, payload.url]);
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'sysstats') {
        const os = require('os');
        let dbSizeFormatted = '0 B';
        try {
          const fs = require('fs');
          let totalBytes = 0;
          const files = [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm'];
          for (const f of files) {
            if (fs.existsSync(f)) {
              totalBytes += fs.statSync(f).size;
            }
          }
          if (totalBytes > 0) {
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(totalBytes) / Math.log(k));
            dbSizeFormatted = parseFloat((totalBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
          }
        } catch(e) {}
        return sendJSON(res, 200, {
          ok: true,
          getkey_click: getSysConfig('getkey_click', '0'),
          getkey_done: getSysConfig('getkey_done', '0'),
          db_size_formatted: dbSizeFormatted,
          server: {
            uptime: os.uptime(),
            totalmem: os.totalmem(),
            freemem: os.freemem(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            loadavg: os.loadavg()
          }
        });
      }
      if (action === 'cleanup_inactive') {
        let deleted = 0;
        try {
          // Delete inactive web keygens
          q("DELETE FROM pk_web_keygen WHERE step_status = 'WAIT' AND created_at < datetime('now', '-1 day')");
          // Delete inactive bot keygens
          q("DELETE FROM KeyGenAuto WHERE step_status = 'WAIT' AND created_at < datetime('now', '-1 day')");
          q("DELETE FROM pk_step_otp WHERE created_at < datetime('now', '-1 day')");
          // Delete unused free keys older than 1 day
          q("DELETE FROM keys_code WHERE (devices IS NULL OR devices = '') AND key_type = 'FREE' AND created_at < datetime('now', '-1 day')");
          // Delete expired keys (older than 1 day from expiry)
          q(`DELETE FROM pk_key_devices WHERE user_key IN (
              SELECT user_key FROM keys_code 
              WHERE expired_date IS NOT NULL AND expired_date < datetime('now', '-1 day')
             )`);
          q(`DELETE FROM keys_code WHERE expired_date IS NOT NULL AND expired_date < datetime('now', '-1 day')`);
        } catch (e) { }
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'maintenance') {
        MAINTENANCE_MODE = !!payload.state;
        if (MAINTENANCE_MODE) {
          const out = { action: 'shutdown', message: 'SERVER_DISABLED', reason: 'SERVER_DISABLED' };
          broadcastAll(out);
          for (const [ws] of clients) ws.terminate();
          clients.clear();
        }
        return sendJSON(res, 200, { ok: true, state: MAINTENANCE_MODE });
      }
      if (action === 'shutdown') {
        const { target } = payload;
        const out = { action: 'shutdown', message: 'ระบบปิดชั่วคราว' };
        let c = 0;
        if (target === 'all') {
          c = broadcastAll(out);
          for (const [ws] of clients) ws.terminate();
          clients.clear();
        } else {
          const toRemove = [];
          for (const [ws, meta] of clients) {
            if (meta.lib_id === target || meta.key === target) { wsSend(ws, out); c++; toRemove.push(ws); }
          }
          for (const ws of toRemove) { ws.terminate(); clients.delete(ws); }
        }
        return sendJSON(res, 200, { ok: true, count: c });
      }
      if (action === 'ban') {
        const type = payload.type;
        const val = (payload.val || '').trim();
        const toRemove = [];
        if (type === 'key') {
          const key = val.toUpperCase();
          q('UPDATE keys_code SET blocked=1 WHERE user_key=?', [key]);
          for (const [ws, meta] of clients) { if (meta.key === key) { wsSend(ws,{action:'shutdown',message:'KEY_BANNED'}); toRemove.push(ws); } }
        }
        else if (type === 'ip') {
          q('INSERT OR IGNORE INTO pk_banned_ips(ip) VALUES(?)', [val]);
          bannedIps.add(val);
          for (const [ws, meta] of clients) { if (meta.ip === val) { wsSend(ws,{action:'shutdown',message:'IP_BANNED'}); toRemove.push(ws); } }
        }
        else if (type === 'user') {
          const tid = parseInt(val);
          if (tid) {
            q('INSERT OR IGNORE INTO pk_banned_tgids(telegram_id) VALUES(?)', [tid]);
            bannedTgIds.add(tid);
            for (const [ws, meta] of clients) { if (Number(meta.telegram_id) === tid) { wsSend(ws,{action:'shutdown',message:'USER_BANNED'}); toRemove.push(ws); } }
          }
        }
        else if (type === 'serial') {
          q('INSERT OR IGNORE INTO pk_banned_serials(serial) VALUES(?)', [val]);
          bannedSerials.add(val);
          for (const [ws, meta] of clients) { if (meta.serial === val) { wsSend(ws,{action:'shutdown',message:'DEVICE_BANNED'}); toRemove.push(ws); } }
        }
        else if (type === 'lib') {
          q('UPDATE pk_lib_ids SET blocked=1 WHERE lib_id=?', [val]);
          bannedLibIds.add(val);
          for (const [ws, meta] of clients) { if (meta.lib_id === val) { wsSend(ws,{action:'shutdown',message:'LIB_BANNED'}); toRemove.push(ws); } }
        }
        for (const ws of toRemove) { ws.terminate(); clients.delete(ws); }
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'unban') {
        const type = payload.type;
        const val = (payload.val || '').trim();
        if (type === 'key') q('UPDATE keys_code SET blocked=0 WHERE user_key=?', [val.toUpperCase()]);
        else if (type === 'ip') {
          q('DELETE FROM pk_banned_ips WHERE ip=?', [val]);
          bannedIps.delete(val);
        }
        else if (type === 'user') {
          const tid = parseInt(val);
          if (tid) {
            q('DELETE FROM pk_banned_tgids WHERE telegram_id=?', [tid]);
            bannedTgIds.delete(tid);
          }
        }
        else if (type === 'serial') {
          q('DELETE FROM pk_banned_serials WHERE serial=?', [val]);
          bannedSerials.delete(val);
        }
        else if (type === 'lib') {
          q('UPDATE pk_lib_ids SET blocked=0 WHERE lib_id=?', [val]);
          bannedLibIds.delete(val);
        }
        return sendJSON(res, 200, { ok: true });
      }
      if (action === 'libstatus') {
        const libsMap = new Map();
        for (const meta of clients.values()) {
          if (!meta.lib_id) continue;
          if (!libsMap.has(meta.lib_id)) libsMap.set(meta.lib_id, 0);
          libsMap.set(meta.lib_id, libsMap.get(meta.lib_id) + 1);
        }
        const libs = Array.from(libsMap.entries()).map(([lib_id, count]) => ({ lib_id, count, blocked: bannedLibIds.has(lib_id) }));
        return sendJSON(res, 200, { ok: true, libs });
      }
      if (action === 'stats') {
        const totalKeys = q1('SELECT COUNT(*) as c FROM keys_code').c;
        const totalDevices = q1('SELECT COUNT(*) as c FROM pk_key_devices').c;
        const totalWebUsers = q1('SELECT COUNT(*) as c FROM pk_web_users').c;
        const activeConnections = clients.size;
        return sendJSON(res, 200, { ok: true, stats: { totalKeys, totalDevices, totalWebUsers, activeConnections } });
      }
      return sendJSON(res, 400, { ok: false, reason: 'UNKNOWN_ACTION' });
    } catch(e) { return sendJSON(res, 500, { ok: false, reason: 'ERR', error: e.message }); }
  });

  app.get('/owner', (req, res) => {
    const ownerPath = getSysConfig('owner_path');
    if (!ownerPath || req.query.hash !== ownerPath) {
      return res.status(404).set('Content-Type', 'text/html').end('<h1>404 Not Found</h1>');
    }
    return sendHTML(res, 200, buildOwnerHTML(req.query.hash));
  });

  app.get('/admin', (req, res) => sendHTML(res, 200, buildAdminHTML()));

  app.post('/api/*splat', (req, res) => sendJSON(res, 404, { ok: false, reason: 'NOT_FOUND' }));

  app.get('/wcb', (req, res) => {
    try {
      const { sid, step, ts, sig } = req.query;
      if (!sid || !step || !ts || !sig) return res.redirect('/?step=err&reason=INVALID_PARAMS');
      const now = Math.floor(Date.now() / 1000);
      if (now - parseInt(ts) > 3600) return res.redirect('/?step=err&reason=EXPIRED');
      const expectedSig = crypto.createHmac('sha256', HMAC_SECRET)
        .update(`web:${sid}:${step}:${ts}`).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return res.redirect('/?step=err&reason=BAD_SIG');
      const sess = q1('SELECT * FROM pk_web_keygen WHERE session_token=?', [sid]);
      if (!sess) return res.redirect('/?step=err&reason=SESSION_NOT_FOUND');
      const s = parseInt(step);
      if (s === sess.current_step) {
        q('UPDATE pk_web_keygen SET current_step=? WHERE session_token=?', [s + 1, sid]);
      }
      return res.redirect('/?step=ok');
    } catch { return res.redirect('/?step=err&reason=ERR'); }
  });

  app.use((req, res) => res.redirect(302, '/'));

  const srv = http.createServer(app);
  startWS(srv);
  srv.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`✅ HTTP + WebSocket + Web Portal on port ${HTTP_PORT}`);
    console.log(`\uD83C\uDF10 Web Portal: http://localhost:${HTTP_PORT}/`);
  });
  return srv;
}

function httpGet(url) {
  return new Promise(r => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } });
    });
    req.on('error', () => r({}));
    req.setTimeout(8000, () => { req.destroy(); r({}); });
  });
}

async function shortenGP(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await Promise.race([
        httpGet(`https://api.gplinks.com/api?api=${GPLINKS_API}&url=${encodeURIComponent(url)}`),
        new Promise((_, rej) => setTimeout(() => rej(), 6000))
      ]);
      if (r.shortenedUrl) return { url: r.shortenedUrl, type: 'gplinks' };
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

async function shortenSM(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await Promise.race([
        httpGet(`https://shrinkme.io/api?api=${SHRINKME_API}&url=${encodeURIComponent(url)}`),
        new Promise((_, rej) => setTimeout(() => rej(), 6000))
      ]);
      if (r.shortenedUrl) return { url: r.shortenedUrl, type: 'shrinkme' };
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

async function shorten(rawUrl) {
  const order = Math.random() < 0.5
    ? [shortenGP, shortenSM]
    : [shortenSM, shortenGP];
  for (const fn of order) {
    const res = await fn(rawUrl);
    if (res) return res;
  }
  return { url: rawUrl, type: 'raw' };
}

const L = {
  th: {
    w:'👋 สวัสดี <b>{n}</b>!\nยินดีต้อนรับสู่ <b>MossZaSupport Bot</b> 🎮\nพิมพ์ /help เพื่อดูคำสั่ง',
    hu:'📖 <b>คำสั่ง</b>\n\n/getkey — รับ Key ฟรี\n/mykey — ดู Key ของฉัน\n/resetkey — รีเซ็ตอุปกรณ์\n/help — ช่วยเหลือ',
    ha:'🔧 <b>Admin Commands</b>\n\n/genkey — สร้าง Key\n/listkeys [หน้า] — รายการ Key\n/keyinfo &lt;key&gt; — ข้อมูล Key\n/infokey &lt;key|tgid&gt; — ดู Key/อุปกรณ์ + actions (รวม /findkey /devinfo)\n/delkey &lt;key&gt; — ลบ Key\n/resetdev &lt;key&gt; — Reset Devices\n/renewkey &lt;key&gt; &lt;days&gt; — ต่ออายุ\n/stats — สถิติ\n/listadmins — รายชื่อ Admin\n/searchkeys [keyword|days:N|type:X] — ค้นหา Key\n/onlinekeys — ดู Key ที่มี device online',
    ho:'👑 <b>Owner Commands</b>\n\n/ownerpanel — สร้างลิงก์ Web Panel ชั่วคราว\n/closepanel — ปิดลิงก์ Web Panel\n/addadmin &lt;id&gt; — เพิ่ม Admin\n/rmadmin &lt;id&gt; — ลบ Admin\n/setversion &lt;ver&gt; &lt;url&gt; — กำหนด version\n/notifyupdate — แจ้งเตือนอัพเดททุก lib\n/shutdown — ปิดการทำงาน lib ทั้งหมด\n/shutdownlib &lt;lib_id&gt; — ปิด lib ตาม ID\n/ban &lt;key|ip|serial|user|lib&gt; &lt;value&gt; — แบน (unified)\n/unban &lt;key|ip|serial|user|lib&gt; &lt;value&gt; — ปลดแบน (unified)\n/maintenance on|off — โหมดปิดซ่อมระบบ\n/libstatus [filter] — ดู lib ที่เชื่อมต่ออยู่\n/libstatusadv [days:N|type:X|filter] — ค้นหา lib แบบละเอียด\n/msgkey &lt;key&gt; &lt;msg&gt; — ส่งข้อความหา key ที่ online\n/msgdevice &lt;serial&gt; &lt;msg&gt; — ส่งข้อความหา device\n/msgall &lt;msg&gt; — broadcast ทุก device\n/onlinekeys — ดู key ที่มี device online\n/searchkeys [keyword|days:N|type:X] — ค้นหา key',
    mj:'⚠️ กรุณาเข้าร่วม Channel ก่อนรับ Key',jb:'📢 เข้าร่วม Channel',
    pick_days:'🔑 <b>รับ Key ฟรี</b>\n\nเลือกจำนวนวัน:\n<i>(Steps = จำนวนวันที่เลือก)</i>',
    day_btn:'{d} วัน ({d} Steps)',
    ki:'🔑 <b>ข้อมูล Key</b>\n\n🗝 Key: <code>{key}</code>\n📋 ประเภท: {type}\n⏰ หมดอายุ: {expiry}\n📱 Devices: {devices}/{max}\n👤 UID: {uid}\n📅 สร้าง: {created}\n📊 สถานะ: {status}\n📝 โน้ต: {note}',
    xm:'❌ Key หมดอายุแล้ว',am:'✅ Key ยังใช้งานได้',
    bd:'🗑 ลบ Key',br:'🔄 Reset Devices',bw:'🔁 ต่ออายุ Key',bc:'❌ ยกเลิก',bk:'✅ ยืนยัน',
    cd:'⚠️ <b>ยืนยันลบ Key?</b>\n\n<code>{key}</code>\n\n⚠️ ไม่สามารถกู้คืนได้!',
    cr:'⚠️ <b>ยืนยัน Reset Devices?</b>\n\n<code>{key}</code>',
    dl:'✅ ลบ Key สำเร็จ',rs:'✅ Reset Devices สำเร็จ',
    nk:'❌ คุณยังไม่มี Key\n\nใช้ /getkey เพื่อรับฟรี',
    rl:'⏳ <b>กรุณารอก่อน</b>\n\nลองใหม่ได้ใน <b>{m} นาที {s} วินาที</b>',
    na:'⛔ คุณไม่มีสิทธิ์ใช้คำสั่งนี้',nf:'❌ ไม่พบ Key นี้ในระบบ',
    gt:'🔑 <b>สร้าง Key ใหม่</b>\n\nเลือกประเภท Key:',
    gd:'📅 <b>ระยะเวลากี่วัน?</b>\n\nกดปุ่ม หรือพิมพ์ตัวเลขเอง',
    gv:'📱 <b>Max Devices?</b>\n\nกดปุ่ม หรือพิมพ์ตัวเลข (0 = ไม่จำกัด)',
    gn:'📝 <b>ตั้งชื่อ?</b>\n\nพิมพ์ข้อความ หรือข้าม',
    gp:'📋 <b>สรุปก่อนสร้าง Key</b>\n\nประเภท: <b>{type}</b>\nระยะเวลา: <b>{days} วัน</b>\nMax Devices: <b>{devices}</b>\nโน้ต: <b>{note}</b>\n\nยืนยัน?',
    gs:'✅ <b>สร้าง Key สำเร็จ!</b>\n\n🗝 <code>{key}</code>\nประเภท: {type} | {days} วัน | Max: {devices}',
    gx:'❌ ยกเลิกการสร้าง Key',in_:'❌ กรุณาพิมพ์ตัวเลขที่ถูกต้อง',
    st:'📊 <b>สถิติระบบ</b>\n\n🔑 Key ทั้งหมด: {total}\n✅ Active: {active}\n❌ Expired: {expired}\n👥 Admins: {admins}',
    lh:'📋 <b>รายการ Key</b> (หน้า {page}/{total_pages}) — {total} Keys\n\n',
    lr:'• <code>{key}</code> {st} <i>{expiry}</i>\n',
    nq:'📭 ยังไม่มี Key ในระบบ',
    aa:'✅ เพิ่ม Admin <code>{uid}</code> สำเร็จ',ra:'✅ ลบ Admin <code>{uid}</code> สำเร็จ',
    la:'👥 <b>รายชื่อ Admin</b>\n\n{list}',
    rp:'📅 ต่ออายุ Key <code>{key}</code> กี่วัน?\n\nพิมพ์ตัวเลข:',
    rd:'✅ ต่ออายุสำเร็จ!\n\nหมดอายุใหม่: <b>{expiry}</b>',
    sm:'🔑 <b>รับ Key ฟรี</b>\n\n📊 Progress: {bar}\n📌 Step <b>{cur}</b> / {total}\n\n👇 กดปุ่มด้านล่างเพื่อ unlock\n<i>⏳ หมดอายุใน 15 นาที</i>',
    sb:'▶️ Complete Step {n}',un:'ไม่จำกัด',sa:'✅ Active',se:'❌ Expired',si:'⏳ Inactive',
    ask_name:'📝 <b>กรุณาพิมพ์ชื่อ Key ที่ต้องการ:</b>\n\n(หรือกดปุ่มด้านล่างเพื่อข้ามระบบจะสุ่มชื่อตามปกติ)',
    skip_btn:'⏭ ข้ามการตั้งชื่อ (สุ่มรูปแบบเดิม)',
    lbl_rand:'สุ่ม',lbl_unused:'ยังไม่ได้ใช้',lbl_start_first:'จะเริ่มนับอายุเมื่อเปิดใช้งานครั้งแรก',
    claim_btn:'🎁 กดเพื่อ Claim Key ของคุณ 🎉',
    claim_success:'🎉 <b>ยินดีด้วย!</b>\n\n🗝 นี่คือคีย์ของคุณ:\n<code>{key}</code>\n\n📱 Telegram ของคุณเชื่อมโยงกับคีย์นี้แล้ว!',
    session_err:'⚠️ ไม่พบข้อมูลคำขอ หรือหมดเวลาแล้ว',
    fk_header:'🔎 <b>ผลการค้นหา Key จาก Telegram ID</b>\n👤 TGID: <code>{tgid}</code> {username}\n📦 พบทั้งหมด: <b>{count}</b> Key\n🚫 สถานะแบน: {banstatus}\n',
    fk_banned:'⛔ ถูกแบน',fk_notbanned:'✅ ไม่ถูกแบน',
    kib_yes:'🚫 ใช่',kib_no:'✅ ไม่',
    kib:'\n═══════════════\n<b>{idx}.</b>\n🗝 <b>KEY</b> : <code>{key}</code>\n👤 <b>TGID</b> : <code>{tgid}</code>\n📋 ประเภท : {type}\n⏰ หมดอายุ : {expiry}\n📱 Devices : {devices}/{max}\n📅 สร้างเมื่อ : {created}\n📊 สถานะ : {status}\n🔒 ถูกบล็อก : {blocked}\n📝 โน้ต : {note}\n',
    banned_msg:'⛔ <b>บัญชี Telegram ของคุณถูกระงับการใช้งานบอทนี้</b>\n\nหากคิดว่าเป็นความผิดพลาด กรุณาติดต่อแอดมิน',
    bdev:'📱 Device Info',
    dev_header:'📱 <b>ข้อมูลอุปกรณ์ของ Key</b>\n🗝 Key: <code>{key}</code>\n🔢 พบทั้งหมด: {count} เครื่อง\n',
    dev_none:'\n📭 ยังไม่มีประวัติอุปกรณ์',
    dev_online:'🟢 Online (กำลังใช้งานอยู่)',dev_offline:'⚪ Offline',
    devb:'\n═══════════════\n<b>{idx}.</b>\n🔌 Serial : <code>{serial}</code>\n📦 Lib ID : <code>{lib_id}</code>\n🌐 IP : <code>{ip}</code>\n🔄 Version : {version}\n📡 สถานะ : {status}\n🕐 พบครั้งแรก : {first_seen}\n🕐 พบล่าสุด : {last_seen}\n',
    devb_legacy:'\n═══════════════\n<b>{idx}.</b>\n🔌 Serial : <code>{serial}</code>\n⚠️ <i>บันทึกก่อนอัปเดตนี้ — ไม่มีข้อมูล Lib ID/IP</i>\n',
  },
  en: {
    w:'👋 Hello <b>{n}</b>!\nWelcome to <b>Support Bot</b> 🎮\nType /help for commands',
    hu:'📖 <b>Commands</b>\n\n/getkey — Get Free Key\n/mykey — My Key Info\n/resetkey — Reset Devices\n/help — Help',
    ha:'🔧 <b>Admin Commands</b>\n\n/genkey — Generate Key\n/listkeys [page] — List Keys\n/keyinfo &lt;key&gt; — Key Details\n/infokey &lt;key|tgid&gt; — Key/device info + actions (replaces /findkey /devinfo)\n/delkey &lt;key&gt; — Delete Key\n/resetdev &lt;key&gt; — Reset Devices\n/renewkey &lt;key&gt; &lt;days&gt; — Renew Key\n/stats — Statistics\n/listadmins — List Admins\n/searchkeys [keyword|days:N|type:X] — Search Keys\n/onlinekeys — Keys with online devices',
    ho:'👑 <b>Owner Commands</b>\n\n/ownerpanel — Generate Web Panel link\n/closepanel — Invalidate Web Panel link\n/addadmin &lt;id&gt; — Add Admin\n/rmadmin &lt;id&gt; — Remove Admin\n/setversion &lt;ver&gt; &lt;url&gt; — Set version\n/notifyupdate — Notify all libs to update\n/shutdown — Shutdown all libs\n/shutdownlib &lt;lib_id&gt; — Shutdown lib by ID\n/ban &lt;key|ip|serial|user|lib&gt; &lt;value&gt; — Ban (unified)\n/unban &lt;key|ip|serial|user|lib&gt; &lt;value&gt; — Unban (unified)\n/maintenance on|off — Maintenance mode\n/libstatus [filter] — View connected libs\n/libstatusadv [days:N|type:X|filter] — Advanced lib filter\n/msgkey &lt;key&gt; &lt;msg&gt; — Message key online devices\n/msgdevice &lt;serial&gt; &lt;msg&gt; — Message a device\n/msgall &lt;msg&gt; — Broadcast to all devices\n/onlinekeys — List keys with online devices\n/searchkeys [keyword|days:N|type:X] — Search keys',
    mj:'⚠️ Please join our Channel first',jb:'📢 Join Channel',
    pick_days:'🔑 <b>Get Free Key</b>\n\nChoose duration:\n<i>(Steps = Days chosen)</i>',
    day_btn:'{d} Day{p} ({d} Step{p})',
    ki:'🔑 <b>Key Info</b>\n\n🗝 Key: <code>{key}</code>\n📋 Type: {type}\n⏰ Expires: {expiry}\n📱 Devices: {devices}/{max}\n👤 UID: {uid}\n📅 Created: {created}\n📊 Status: {status}\n📝 Note: {note}',
    xm:'❌ Key Expired',am:'✅ Key Active',
    bd:'🗑 Delete Key',br:'🔄 Reset Devices',bw:'🔁 Renew Key',bc:'❌ Cancel',bk:'✅ Confirm',
    cd:'⚠️ <b>Confirm Delete?</b>\n\n<code>{key}</code>\n\n⚠️ Cannot be undone!',
    cr:'⚠️ <b>Confirm Reset Devices?</b>\n\n<code>{key}</code>',
    dl:'✅ Key Deleted',rs:'✅ Devices Reset',
    nk:'❌ You have no Key\n\nUse /getkey to get one free',
    rl:'⏳ <b>Please wait</b>\n\nTry again in <b>{m}m {s}s</b>',
    na:'⛔ No permission',nf:'❌ Key not found',
    gt:'🔑 <b>Generate Key</b>\n\nSelect key type:',
    gd:'📅 <b>How many days?</b>\n\nTap a button or type a number',
    gv:'📱 <b>Max Devices?</b>\n\nTap or type (0 = unlimited)',
    gn:'📝 <b>Name?</b>\n\nType or skip',
    gp:'📋 <b>Confirm Key</b>\n\nType: <b>{type}</b>\nDuration: <b>{days} days</b>\nMax Devices: <b>{devices}</b>\nNote: <b>{note}</b>\n\nConfirm?',
    gs:'✅ <b>Key Created!</b>\n\n🗝 <code>{key}</code>\nType: {type} | {days}d | Max: {devices}',
    gx:'❌ Cancelled',in_:'❌ Please enter a valid number',
    st:'📊 <b>Stats</b>\n\n🔑 Total: {total}\n✅ Active: {active}\n❌ Expired: {expired}\n👥 Admins: {admins}',
    lh:'📋 <b>Keys</b> (page {page}/{total_pages}) — {total} total\n\n',
    lr:'• <code>{key}</code> {st} <i>{expiry}</i>\n',
    nq:'📭 No keys yet',
    aa:'✅ Admin <code>{uid}</code> added',ra:'✅ Admin <code>{uid}</code> removed',
    la:'👥 <b>Admins</b>\n\n{list}',
    rp:'📅 Renew <code>{key}</code> — how many days?\n\nType:',
    rd:'✅ Renewed!\n\nNew expiry: <b>{expiry}</b>',
    sm:'🔑 <b>Get Free Key</b>\n\n📊 Progress: {bar}\n📌 Step <b>{cur}</b> / {total}\n\n👇 Tap below to unlock\n<i>⏳ Expires in 15 min</i>',
    sb:'▶️ Complete Step {n}',un:'Unlimited',sa:'✅ Active',se:'❌ Expired',si:'⏳ Inactive',
    ask_name:'📝 <b>Enter a name for the Key:</b>\n\n(Or tap below to skip)',
    skip_btn:'⏭ Skip (use random name)',
    lbl_rand:'Random',lbl_unused:'Unused',lbl_start_first:'Starts on first use',
    claim_btn:'🎁 Claim Your Key 🎉',
    claim_success:'🎉 <b>Congratulations!</b>\n\n🗝 Your Key:\n<code>{key}</code>\n\n📱 Telegram linked to this key!',
    session_err:'⚠️ Session not found or expired. Use /getkey to start again.',
    fk_header:'🔎 <b>Key search by Telegram ID</b>\n👤 TGID: <code>{tgid}</code> {username}\n📦 Found: <b>{count}</b> key(s)\n🚫 Ban status: {banstatus}\n',
    fk_banned:'⛔ Banned',fk_notbanned:'✅ Not banned',
    kib_yes:'🚫 Yes',kib_no:'✅ No',
    kib:'\n═══════════════\n<b>{idx}.</b>\n🗝 <b>KEY</b> : <code>{key}</code>\n👤 <b>TGID</b> : <code>{tgid}</code>\n📋 Type : {type}\n⏰ Expires : {expiry}\n📱 Devices : {devices}/{max}\n📅 Created : {created}\n📊 Status : {status}\n🔒 Blocked : {blocked}\n📝 Note : {note}\n',
    banned_msg:'⛔ <b>Your Telegram account has been banned from using this bot.</b>\n\nIf you think this is a mistake, please contact an admin.',
    bdev:'📱 Device Info',
    dev_header:'📱 <b>Device Info for Key</b>\n🗝 Key: <code>{key}</code>\n🔢 Found: {count} device(s)\n',
    dev_none:'\n📭 No device history yet',
    dev_online:'🟢 Online (currently connected)',dev_offline:'⚪ Offline',
    devb:'\n═══════════════\n<b>{idx}.</b>\n🔌 Serial : <code>{serial}</code>\n📦 Lib ID : <code>{lib_id}</code>\n🌐 IP : <code>{ip}</code>\n🔄 Version : {version}\n📡 Status : {status}\n🕐 First seen : {first_seen}\n🕐 Last seen : {last_seen}\n',
    devb_legacy:'\n═══════════════\n<b>{idx}.</b>\n🔌 Serial : <code>{serial}</code>\n⚠️ <i>Recorded before this update — no Lib ID/IP data</i>\n',
  },
  id: {
    w: '👋 Halo <b>{n}</b>! <b>Support Bot</b> 🎮 /help',
    hu: '📖 /getkey /mykey /resetkey /help',
    ha: '🔧 /genkey /listkeys /keyinfo /delkey /resetdev /renewkey /stats /addadmin /rmadmin /listadmins',
    mj: '⚠️ Gabung Channel dulu', jb: '📢 Gabung',
    pick_days: '🔑 Pilih durasi Key:\n<i>(Steps = hari yang dipilih)</i>',
    day_btn: '{d} Hari ({d} Steps)',
    gi: '🎮 Ketuk untuk memulai {d} Steps', gb: '🔑 Dapatkan Key {d} Hari',
    ki: '🔑 Key: <code>{key}</code>\nTipe: {type} | Exp: {expiry}\nDevices: {devices}/{max} | {status} | Note: {note}',
    xm: '❌ Kadaluarsa', am: '✅ Aktif', bd: '🗑 Hapus', br: '🔄 Reset', bw: '🔁 Perpanjang', bc: '❌ Batal', bk: '✅ OK',
    cd: '⚠️ Hapus <code>{key}</code>?', cr: '⚠️ Reset <code>{key}</code>?',
    dl: '✅ Dihapus', rs: '✅ Direset', nk: '❌ Belum punya Key\n/getkey', na: '⛔ No permission', nf: '❌ Tidak ada',
    gt: 'Pilih tipe:', gd: 'Berapา hari?', gv: 'Max Devices?', gn: 'Catatan? (- skip)',
    gp: '{type} {days}h Max:{devices} Note:{note} — OK?', gs: '✅ <code>{key}</code>', gx: '❌ Batal', in_: '❌ Angka tidak valid',
    st: '📊 Total:{total} Aktif:{active} Exp:{expired}', lh: '📋 (Hal {page}/{total_pages})\n\n', lr: '• <code>{key}</code> {st} {expiry}\n',
    nq: 'Belum ada', aa: '✅ {uid}', ra: '✅ {uid}', la: '👥 {list}',
    rp: 'Perpanjang {key} berapa hari?', rd: '✅ {expiry}',
    sm: '🔑 {bar} Step <b>{cur}</b>/{total}\n<i>⏳ 15 min</i>', sb: '▶️ Step {n}', un: '∞', sa: '✅', se: '❌', si: '⏳',
    ask_name: '📝 Masukkan nama kuncinya:\n(atau klik lewati)', skip_btn: '⏭ Lewati',
    lbl_rand: 'Acak', lbl_unused: 'Unused', lbl_start_first: 'Akan mulai dihitung pada aktivasi pertama',
    claim_btn: '🎁 Ambil Key Anda 🎉', claim_success: '🎉 Key Anda: <code>{key}</code>', session_err: '⚠️ Sesi kadaluarsa'
  },
  vi: {
    w: '👋 Xin chào <b>{n}</b>! <b>Support Bot</b> 🎮 /help',
    hu: '📖 /getkey /mykey /resetkey /help',
    ha: '🔧 /genkey /listkeys /keyinfo /delkey /resetdev /renewkey /stats /addadmin /rmadmin /listadmins',
    mj: '⚠️ Tham gia Channel trước', jb: '📢 Tham Gia',
    pick_days: '🔑 Chọn thời hạn Key:\n<i>(Steps = số ngày bạn chọn)</i>',
    day_btn: '{d} Ngày ({d} Steps)',
    gi: '🎮 Nhấn để bắt đầu {d} Steps', gb: '🔑 Nhận Key {d} Ngày',
    ki: '🔑 Key: <code>{key}</code>\nLoại: {type} | Hết hạn: {expiry}\nThiết bị: {devices}/{max} | {status} | Note: {note}',
    xm: '❌ Hết hạn', am: '✅ Còn hạn', bd: '🗑 Xóa', br: '🔄 Reset', bw: '🔁 Gia Hạn', bc: '❌ Hủy', bk: '✅ OK',
    cd: '⚠️ Xóa <code>{key}</code>?', cr: '⚠️ Reset <code>{key}</code>?',
    dl: '✅ Đã xóa', rs: '✅ Đã reset', nk: '❌ Chưa có Key\n/getkey', na: '⛔ Không có quyền', nf: '❌ Không tìm thấy',
    gt: 'Chọn loại:', gd: 'Bao nhiêu ngày?', gv: 'Max Devices?', gn: 'Ghi chú? (- bỏ qua)',
    gp: '{type} {days}d Max:{devices} Note:{note} — OK?', gs: '✅ <code>{key}</code>', gx: '❌ Đã hủy', in_: '❌ Nhập số hợp lệ',
    st: '📊 Tổng:{total} HĐ:{active} HH:{expired}', lh: '📋 (Trang {page}/{total_pages})\n\n', lr: '• <code>{key}</code> {st} {expiry}\n',
    nq: 'Chưa có', aa: '✅ {uid}', ra: '✅ {uid}', la: '👥 {list}',
    rp: 'Gia hạn {key} mấy ngày?', rd: '✅ {expiry}',
    sm: '🔑 {bar} Bước <b>{cur}</b>/{total}\n<i>⏳ 15 phút</i>', sb: '▶️ Bước {n}', un: '∞', sa: '✅', se: '❌', si: '⏳',
    ask_name: '📝 Vui lòng nhập tên chìa khóa:\n(hoặc nhấn bỏ qua)', skip_btn: '⏭ Bỏ qua',
    lbl_rand: 'Ngẫu nhiên', lbl_unused: 'Unused', lbl_start_first: 'Sẽ bắt đầu tính thời gian khi sử dụng lần đầu',
    claim_btn: '🎁 Nhận Key của bạn 🎉', claim_success: '🎉 Key: <code>{key}</code>', session_err: '⚠️ Hết thời gian'
  },
  ru: {
    w: '👋 Привет <b>{n}</b>! <b>Support Bot</b> 🎮 /help',
    hu: '📖 /getkey /mykey /resetkey /help',
    ha: '🔧 /genkey /listkeys /keyinfo /delkey /resetdev /renewkey /stats /addadmin /rmadmin /listadmins',
    mj: '⚠️ Вступите в канал', jb: '📢 Вступить',
    pick_days: '🔑 Выберите срок ключа:\n<i>(Шагов = количество дней)</i>',
    day_btn: '{d} дн. ({d} Шагов)',
    gi: '🎮 Нажмите для {d} Шагов', gb: '🔑 Получить ключ на {d} дн.',
    ki: '🔑 Ключ: <code>{key}</code>\nТип: {type} | Истекает: {expiry}\nУстройств: {devices}/{max} | {status} | Прим: {note}',
    xm: '❌ Истёк', am: '✅ Активен', bd: '🗑 Удалить', br: '🔄 Сброс', bw: '🔁 Продлить', bc: '❌ Отмена', bk: '✅ OK',
    cd: '⚠️ Удалить <code>{key}</code>?', cr: '⚠️ Сбросить <code>{key}</code>?',
    dl: '✅ Удалено', rs: '✅ Сброшено', nk: '❌ Нет ключа\n/getkey', na: '⛔ Нет прав', nf: '❌ Не найден',
    gt: 'Тип:', gd: 'Дней?', gv: 'Макс. устр.?', gn: 'Примечание? (- пропустить)',
    gp: '{type} {days}д Макс:{devices} Прим:{note} — OK?', gs: '✅ <code>{key}</code>', gx: '❌ Отменено', in_: '❌ Введите число',
    st: '📊 Всего:{total} Акт:{active} Ист:{expired}', lh: '📋 (Стр {page}/{total_pages})\n\n', lr: '• <code>{key}</code> {st} {expiry}\n',
    nq: 'Нет ключей', aa: '✅ {uid}', ra: '✅ {uid}', la: '👥 {list}',
    rp: 'Продлить {key} на дней?', rd: '✅ {expiry}',
    sm: '🔑 {bar} Шаг <b>{cur}</b>/{total}\n<i>⏳ 15 мин</i>', sb: '▶️ Шаг {n}', un: '∞', sa: '✅', se: '❌', si: '⏳',
    ask_name: '📝 Введите имя ключа:\n(или нажмите пропустить)', skip_btn: '⏭ Пропустить',
    lbl_rand: 'Случайный', lbl_unused: 'Unused', lbl_start_first: 'Начнет отсчет при первой активации',
    claim_btn: '🎁 Забрать Ключ 🎉', claim_success: '🎉 Ключ: <code>{key}</code>', session_err: '⚠️ Сессия истекла'
  },
  hi: {
    w: '👋 नमस्ते <b>{n}</b>!\n<b>Support Bot</b> में आपका स्वागत है 🎮\nकमांड देखने के लिए /help टाइप करें',
    hu: '📖 <b>कमांड</b>\n\n/getkey — फ्री की (Key) प्राप्त करें\n/mykey — मेरी की (Key) की जानकारी\n/help — सहायता',
    ha: '🔧 <b>एडमिन कमांड</b>\n\n/genkey /listkeys /keyinfo /delkey /resetdev /renewkey /stats /addadmin /rmadmin /listadmins',
    mj: '⚠️ की (Key) प्राप्त करने से पहले कृपया हमारे चैनल से जुड़ें', jb: '📢 चैनल से जुड़ें',
    pick_days: '🔑 <b>फ्री की (Key) प्राप्त करें</b>\n\nअवधि चुनें:\n<i>(स्टेपส์ = आपके द्वारा चुने गए दिन)</i>',
    day_btn: '{d} दिन ({d} स्टेपส์)',
    gi: '🎮 {d} स्टेपส์ शुरू करने के लिए नीचे टैप करें', gb: '🔑 {d}-दिन की की (Key) प्राप्त करें',
    ki: '🔑 <b>की (Key) जानकारी</b>\n\n🗝 की: <code>{key}</code>\n📋 प्रकार: {type}\n⏰ समाप्ति तिथि: {expiry}\n📱 डिवाइसेस: {devices}/{max}\n📊 स्थिति: {status}\n📝 नोट: {note}',
    xm: '❌ की (Key) समाप्त हो चुकी है', am: '✅ की (Key) एक्टिव है', bd: '🗑 हटाएं', br: '🔄 रीसेट', bw: '🔁 रिन्यू', bc: '❌ रद्द करें', bk: '✅ पुष्टि करें',
    cd: '⚠️ क्या आप वाक्य में <code>{key}</code> को हटाना चाहते हैं?', cr: '⚠️ क्या आप डिवाइसेस रीसेट करना चाहते हैं <code>{key}</code>?',
    dl: '✅ की (Key) हटा दी गई', rs: '✅ डिवाइसेस रीसेट हो गए', nk: '❌ आपके पास अभी तक कोई की (Key) नहीं है\n\nफ्री प्राप्त करने के लिए /getkey का उपयोग करें', na: '⛔ अनुमति नहीं है', nf: '❌ की (Key) नहीं मिली',
    gt: 'प्रकार चुनें:', gd: 'कितने दिन?', gv: 'मैक्स डिवाइसेस?', gn: 'कोई नोट लिखें (- छोड़ें)',
    gp: '{type} {days} दिन मैक्स:{devices} नोट:{note} — सही है?', gs: '✅ <code>{key}</code> सफलतापूर्वक जनरेट हुआ', gx: '❌ रद्द कर दिया गया', in_: '❌ कृपया एक सही संख्या दर्ज करें',
    st: '📊 कुल:{total} एक्टिव:{active} समाप्त:{expired}', lh: '📋 (पेज {page}/{total_pages})\n\n', lr: '• <code>{key}</code> {st} {expiry}\n',
    nq: 'सिस्टम में अभी कोई की (Key) नहीं है', aa: '✅ एडमिन <code>{uid}</code> जोड़ा गया', ra: '✅ एडमिन <code>{uid}</code> हटाया गया', la: '👥 एडमिन सूची:\n\n{list}',
    rp: 'की <code>{key}</code> को कितने दिनों के लिए रिन्यू करना है?', rd: '✅ नई समाप्ति तिथि: <b>{expiry}</b>',
    sm: '🔑 {bar}\nस्टेप <b>{cur}</b> / {total}\n\n👇 अनलॉक करने के लिए नीचे टैप करें\n<i>⏳ 15 मिनट में समाप्त हो जाएगा</i>', sb: '▶️ स्टेप {n} पूरा करें', un: 'असीमित', sa: '✅ एक्टिव', se: '❌ समाप्त', si: '⏳ इनएक्टिव',
    ask_name: '📝 कृपया कुंजी का नाम टाइप करें:\n(या छोड़ने के लिए नीचे दबाएं)', skip_btn: '⏭ नाम छोड़ें',
    lbl_rand: 'यादृच्छिक', lbl_unused: 'Unused', lbl_start_first: 'पहली बार उपयोग करने पर समय शुरू होगा',
    claim_btn: '🎁 अपनी की (Key) प्राप्त करें 🎉', claim_success: '🎉 आपकी की (Key): <code>{key}</code>', session_err: '⚠️ सत्र समाप्त'
  },
  bn: {
    w: '👋 হ্যালো <b>{n}</b>!\n<b>Support Bot</b>-এ আপনাকে স্বাগতম 🎮\nকমান্ড দেখতে /help টাইপ করুন',
    hu: '📖 <b>কমান্ড</b>\n\n/getkey — ฟรี কী (Key) পান\n/mykey — আমার কী (Key)-এর তথ্য\n/help — সাহায্য',
    ha: '🔧 <b>অ্যাডমিন কমান্ড</b>\n\n/genkey /listkeys /keyinfo /delkey /resetdev /renewkey /stats /addadmin /rmadmin /listadmins',
    mj: '⚠️ কী (Key) পাওয়ার আগে দয়া করে আমাদের চ্যানেলে জয়েন করুন', jb: '📢 চ্যানেলে জয়েন করুন',
    pick_days: '🔑 <b>ফ্রি কী (Key) পান</b>\n\nমেয়াদ নির্বাচন করুন:\n<i>(স্টেপস = আপনার নির্বাচিত দিন)</i>',
    day_btn: '{d} দিন ({d} হয়তো)',
    gi: '🎮 {d} স্টেপส์ शुरू करने के लिए नीचे टैप करें', gb: '🔑 {d}-দিনের কী (Key) পান',
    ki: '🔑 <b>কী (Key)-এর তথ্য</b>\n\n🗝 কী: <code>{key}</code>\n📋 ধরন: {type}\n⏰ মেয়াদ শেষ: {expiry}\n📱 ডিভাইস: {devices}/{max}\n📊 স্ট্যাটাস: {status}\n📝 নোট: {note}',
    xm: '❌ কী (Key)-এর মেয়াদ শেষ হয়ে গেছে', am: '✅ কী (Key) অ্যাক্টিв আছে', bd: '🗑 মুছে ফেলুন', br: '🔄 রিসেট', bw: '🔁 রিনিউ', bc: '❌ বাতিল', bk: '✅ নিশ্চিত করুন',
    cd: '⚠️ আপনি কি নিশ্চিতভাবে <code>{key}</code> মুছে ফেলতে চান?', cr: '⚠️ ডিভাইস রিসেট নিশ্চিত করুন <code>{key}</code>?',
    dl: '✅ কী (Key) মুছে ফেলা হয়েছে', rs: '✅ ডিভাইস রিসেট সফল হয়েছে', nk: '❌ আপনার কোনো কী (Key) নেই\n\nฟ্রি পেতে /getkey ব্যবহার করুন', na: '⛔ কোনো অনুমতি নেই', nf: '❌ কী (Key) পাওয়া যায়নি',
    gt: 'ধরন বেছে নিন:', gd: 'কত দিন?', gv: 'সর্বোচ্চ ডিভাইস কতটি?', gn: 'নোট লিখুন (- এড়িয়ে যান)',
    gp: '{type} {days} দিন সর্বোচ্চ:{devices} নোট:{note} — নিশ্চিত?', gs: '✅ <code>{key}</code> সফলভাবে তৈরি হয়েছে', gx: '❌ বাতিল করা হয়েছে', in_: '❌ দয়া করে একটি সঠিক সংখ্যা লিখুন',
    st: '📊 মোট:{total} অ্যাক্টিভ:{active} মেয়াদোত্তীর্ণ:{expired}', lh: '📋 (পৃষ্ঠা {page}/{total_pages})\n\n', lr: '• <code>{key}</code> {st} {expiry}\n',
    nq: 'সিস্টেমে কোনো কী (Key) নেই', aa: '✅ অ্যাডমিন <code>{uid}</code> যুক্ত হয়েছে', ra: '✅ অ্যাডমিন <code>{uid}</code> সরানো হয়েছে', la: '👥 অ্যাডমিন তালিকা:\n\n{list}',
    rp: 'কী <code>{key}</code> কত দিনের জন্য রিনিউ করতে চান?', rd: '✅ নতুন মেয়াদ: <b>{expiry}</b>',
    sm: '🔑 {bar}\nস্টেপ <b>{cur}</b> / {total}\n\n👇 আনলক করতে নিচে ক্লিক করুন\n<i>⏳ ১৫ মিনিটের মধ্যে মেয়াদ শেষ হবে</i>', sb: '▶️ স্টেপ {n} সম্পন্ন করুন', un: 'অসীম', sa: '✅ অ্যাক্টিভ', se: '❌ মেয়াদোত্তীর্ণ', si: '⏳ ইনঅ্যাক্টিভ',
    ask_name: '📝 অনুগ্রহ করে কী এর নাম লিখুন:\n(অথবা স্কিপ করতে নিচে ক্লিক করুন)', skip_btn: '⏭ স্কিপ করুন',
    lbl_rand: 'এলোমেলো', lbl_unused: 'Unused', lbl_start_first: 'প্রথমবার ব্যবহার করলে মেয়াদ শুরু হবে',
    claim_btn: '🎁 আপনার কী (Key) সংগ্রহ করুন 🎉', claim_success: '🎉 আপনার কী (Key): <code>{key}</code>', session_err: '⚠️ সেশন শেষ'
  }
};
function gl(ctx){ return ctx?.from?.language_code==='th'?'th':'en'; }
function t(lang,key,vars={}){
  const l=L[lang]||L.en; let s=l[key]!==undefined?l[key]:(L.en[key]||`[${key}]`);
  for(const[k,v] of Object.entries(vars)) s=s.split(`{${k}}`).join(v??'');
  return s;
}

let ac={ids:new Set(),ts:0};
async function rfa(){try{const rows=q('SELECT telegram_id FROM pk_admins');ac={ids:new Set(rows.map(r=>Number(r.telegram_id))),ts:Date.now()};}catch{}}
async function isAdmin(uid){if(Date.now()-ac.ts>300000)await rfa();return SUPER_ADMINS.has(uid)||ac.ids.has(uid);}
const isSA=uid=>SUPER_ADMINS.has(uid);

function fe(c,d){return new Date(new Date(c).getTime()+d*3600000).toISOString().replace('T',' ').slice(0,16)+' UTC';}
function ie(c,d){return Date.now()>new Date(c).getTime()+d*3600000;}
function pb(c,t_){return'🟥'.repeat(c)+'⬛'.repeat(t_-c);}
function dc(d){if(!d||d==='gen')return 0;return d.split(',').filter(Boolean).length;}
function buildCbUrl(uid,token,step){

  const otp=crypto.randomBytes(6).toString('hex');
  const ts=Math.floor(Date.now()/1000);
  q(`INSERT OR REPLACE INTO pk_step_otp(otp_code,uid,step_token,step_num,url_ts,created_at,used)
     VALUES(?,?,?,?,?,datetime('now'),0)`,
    [otp,uid,token,step,ts]);
  return `https://t.me/${BOT_USERNAME}?start=otp_${otp}`;
}

const ST=new Map();
const ss=(u,s)=>ST.set(u,s),gs=u=>ST.get(u)||null,cs=u=>ST.delete(u);

function kbPickDays(lang){
  const btns=[];
  for(let d=1;d<=MAX_FREE_DAYS;d++){const p=(lang==='en'&&d>1)?'s':'';btns.push({text:t(lang,'day_btn',{d,p}),callback_data:`free_d_${d}`});}
  return Markup.inlineKeyboard([btns]);
}
function kbMy(isUsed,exp,lang){

  const row1=[];
  if(isUsed) row1.push(Markup.button.callback(t(lang,'br'),'my_rst'));
  if(exp)    row1.push(Markup.button.callback(t(lang,'bw'),'my_rnw'));
  const row2=[Markup.button.callback(t(lang,'bd'),'my_del')];
  return row1.length
    ? Markup.inlineKeyboard([row1, row2])
    : Markup.inlineKeyboard([row2]);
}
function kbC(lang,ok,no='noop'){return Markup.inlineKeyboard([[Markup.button.callback(t(lang,'bk'),ok),Markup.button.callback(t(lang,'bc'),no)]]);}
function kbAK(ks,lang){return Markup.inlineKeyboard([[Markup.button.callback(t(lang,'br'),`k_rst:${ks}`),Markup.button.callback(t(lang,'bw'),`k_rnw:${ks}`)],[Markup.button.callback(t(lang,'bdev'),`k_dev:${ks}`)],[Markup.button.callback(t(lang,'bd'),`k_del:${ks}`)]]);}
const KBD=Markup.inlineKeyboard([[{text:'1d',callback_data:'gk_d_1'},{text:'3d',callback_data:'gk_d_3'},{text:'7d',callback_data:'gk_d_7'},{text:'30d',callback_data:'gk_d_30'},{text:'365d',callback_data:'gk_d_365'}],[{text:'✏️ Custom',callback_data:'gk_d_c'}],[{text:'❌ Cancel',callback_data:'gk_no'}]]);
const KBV=Markup.inlineKeyboard([[{text:'1',callback_data:'gk_v_1'},{text:'2',callback_data:'gk_v_2'},{text:'3',callback_data:'gk_v_3'},{text:'5',callback_data:'gk_v_5'},{text:'∞',callback_data:'gk_v_0'}],[{text:'✏️ Custom',callback_data:'gk_v_c'}],[{text:'❌ Cancel',callback_data:'gk_no'}]]);

function fki(row,lang,{idx,showBlocked}={}){
  const isUsed=dc(row.devices)>0;
  let exp=false;
  let expiryDisplay=t(lang,'lbl_start_first');
  if(isUsed){
    if(row.expired_date){
      exp=Date.now()>new Date(row.expired_date).getTime();
      expiryDisplay=row.expired_date.replace('T',' ').slice(0,16)+' UTC';
    }else{
      exp=ie(row.created_at,row.duration);
      expiryDisplay=fe(row.created_at,row.duration);
    }
  }
  let statusText=t(lang,'sa');
  if(!isUsed)statusText=t(lang,'si');else if(exp)statusText=t(lang,'se');

  if(idx!==undefined){
    const blockedText=(row.blocked&&showBlocked)?t(lang,'kib_yes'):t(lang,'kib_no');
    return t(lang,'kib',{
      idx,key:row.user_key,tgid:row.telegram_user_id||'N/A',
      type:row.key_type||'FREE',expiry:expiryDisplay,
      devices:dc(row.devices),max:(row.max_devices==0)?t(lang,'un'):row.max_devices,
      created:new Date(row.created_at).toISOString().slice(0,10),
      status:statusText,blocked:blockedText,note:row.note||'-',
    });
  }
  return t(lang,'ki',{key:row.user_key,type:row.key_type||'FREE',expiry:expiryDisplay,devices:dc(row.devices),max:(row.max_devices==0)?t(lang,'un'):row.max_devices,uid:row.telegram_user_id||'N/A',created:new Date(row.created_at).toISOString().slice(0,10),status:statusText,note:row.note||'-'});
}

function fkiNum(row,idx,lang){ return fki(row,lang,{idx,showBlocked:true}); }

function fdi(keyRow,lang){
  const devRows=q('SELECT * FROM pk_key_devices WHERE user_key=? ORDER BY last_seen DESC',[keyRow.user_key]);
  let text=t(lang,'dev_header',{key:keyRow.user_key,count:devRows.length});

  if(!devRows.length){

    const serials=(keyRow.devices||'').split(',').filter(Boolean);
    if(!serials.length)return text+t(lang,'dev_none');
    serials.forEach((s,i)=>{text+=t(lang,'devb_legacy',{idx:i+1,serial:s});});
    return text+'═══════════════';
  }

  for(let i=0;i<devRows.length;i++){
    const d=devRows[i];
    const online=[...clients.values()].some(m=>m.key===keyRow.user_key&&m.serial===d.serial);
    text+=t(lang,'devb',{
      idx:i+1,
      serial:d.serial,
      lib_id:d.lib_id||'N/A',
      ip:d.ip||'N/A',
      version:d.version||'N/A',
      status:online?t(lang,'dev_online'):t(lang,'dev_offline'),
      first_seen:d.first_seen,
      last_seen:d.last_seen,
    });
  }
  return text+'═══════════════';
}

async function isMem(ctx){
  if(!CHANNEL_ID)return true;
  try{const m=await ctx.telegram.getChatMember(CHANNEL_ID,ctx.from.id);return['member','administrator','creator'].includes(m.status);}catch{return true;}
}

async function sendStep(tg,uid,chatId,sess,lang='en'){
  const cur=parseInt(sess.current_step),total=parseInt(sess.total_steps);
  if(cur>=total){
    await tg.sendMessage(chatId,t(lang,'sm',{bar:pb(total,total),cur:total,total}),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:t(lang,'claim_btn'),callback_data:'claim_final_key'}]]}});
  }else{

    const deepLink=buildCbUrl(uid,sess.active_token,cur);
    const {url}=await shorten(deepLink);
    await tg.sendMessage(chatId,t(lang,'sm',{bar:pb(cur,total),cur:cur+1,total}),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:t(lang,'sb',{n:cur+1}),url}]]}});
  }
}

async function skl(tg,chatId,page,lang,eid=null){
  try{
    const limit=10,offset=(page-1)*limit;
    const [{total}]=q('SELECT COUNT(*) total FROM keys_code');
    const total_pages=Math.ceil(total/limit)||1;
    const keys=q('SELECT * FROM keys_code ORDER BY created_at DESC LIMIT ? OFFSET ?',[limit,offset]);
    if(!total){tg.sendMessage(chatId,t(lang,'nq'),{parse_mode:'HTML'});return;}
    let text=t(lang,'lh',{page,total_pages,total});
    for(const k of keys){const isUsed=dc(k.devices)>0;const st=!isUsed?'⏳':(ie(k.created_at,k.duration)?'❌':'✅');text+=t(lang,'lr',{key:k.user_key,st,expiry:isUsed?fe(k.created_at,k.duration).slice(0,10):t(lang,'lbl_unused')});}
    const nav=[];
    if(page>1)nav.push({text:'◀️',callback_data:`kl_p:${page-1}`});
    nav.push({text:`${page}/${total_pages}`,callback_data:'noop'});
    if(page<total_pages)nav.push({text:'▶️',callback_data:`kl_p:${page+1}`});
    const opts={parse_mode:'HTML',reply_markup:{inline_keyboard:[nav]}};
    if(eid)await tg.editMessageText(chatId,eid,null,text,opts);else await tg.sendMessage(chatId,text,opts);
  }catch(e){tg.sendMessage(chatId,'❌ '+e.message);}
}

const sessionCooldown=new Map();
const SESSION_COOLDOWN_SECS=300;
const getKeyLock=new Set();

async function startGetkey(ctx,days){
  const lang=gl(ctx),uid=ctx.from.id;
  if(getKeyLock.has(uid))return;
  getKeyLock.add(uid);
  incStat('getkey_click');
  const lastTs=sessionCooldown.get(uid)||0;
  const elapsed=Math.floor(Date.now()/1000)-lastTs;
  if(elapsed<SESSION_COOLDOWN_SECS){
    const remain=SESSION_COOLDOWN_SECS-elapsed;
    const m=Math.floor(remain/60),s=remain%60;
    getKeyLock.delete(uid);
    return ctx.replyWithHTML(t(lang,'rl',{m,s}));
  }
  try{
    sessionCooldown.set(uid,Math.floor(Date.now()/1000));

    q('DELETE FROM KeyGenAuto WHERE telegram_user_id=?',[uid]);
    const token=crypto.randomBytes(16).toString('hex');
    q(
      `INSERT INTO KeyGenAuto(telegram_user_id,active_token,total_steps,current_step,step_status,created_at) VALUES(?,?,?,0,'WAIT',datetime('now'))`,
      [uid,token,days]
    );
    const sess=q1('SELECT * FROM KeyGenAuto WHERE active_token=? LIMIT 1',[token]);
    await sendStep(ctx.telegram,uid,uid,sess,lang);
  }catch(e){sessionCooldown.delete(uid);ctx.reply('❌ '+e.message);}
  finally{getKeyLock.delete(uid);}
}

bot.catch((err,ctx)=>{
  const code=err?.response?.error_code||err?.code;
  if(code===403||code===400){return;}
  console.error('Bot error:',err);
});
process.on('unhandledRejection',r=>{
  const code=r?.response?.error_code||r?.code;
  if(code===403||code===400){return;}
  console.error('UnhandledRejection:',r);
});

function getUsername(tgid) {
  const row = q1('SELECT username, first_name FROM pk_user_settings WHERE telegram_id=? LIMIT 1', [tgid]);
  if (!row) return null;
  if (row.username) return '@' + row.username;
  if (row.first_name) return row.first_name;
  return null;
}

bot.use(async (ctx, next) => {
  const from = ctx.from;
  if (from?.id) {
    try {
      const usrSql = `INSERT INTO pk_user_settings(telegram_id,lang,username,first_name,updated_at)`
        + ` VALUES(?,?,?,?,datetime('now'))`
        + ` ON CONFLICT(telegram_id) DO UPDATE SET`
        + `   username=excluded.username,first_name=excluded.first_name,updated_at=excluded.updated_at`;
      q(usrSql, [from.id, from.language_code === 'th' ? 'th' : 'en', from.username || null, from.first_name || null]);
    } catch {}
  }
  return next();
});

bot.start(async ctx=>{
  const lang=gl(ctx),uid=ctx.from.id;
  const param=ctx.startPayload||'';

  if(param.startsWith('otp_')){
    const otp=param.slice(4).replace(/[^a-f0-9]/gi,'').slice(0,12);
    if(!otp) return ctx.replyWithHTML('❌ OTP incorrect');

    const otpRow=q1('SELECT * FROM pk_step_otp WHERE otp_code=? AND used=0 LIMIT 1',[otp]);
    if(!otpRow){
      return ctx.replyWithHTML('❌ OTP Incorrect or already in use.');
    }

    if(otpRow.uid!==uid){
      return ctx.replyWithHTML('❌ OTP This is not yours.');
    }

    const elapsed=Math.floor(Date.now()/1000)-otpRow.url_ts;
    if(elapsed>MAX_STEP_SECS){
      q('UPDATE pk_step_otp SET used=1 WHERE otp_code=?',[otp]);
      return ctx.replyWithHTML('⏰ The OTP has expired. Please press /getkey again.');
    }

    q('UPDATE pk_step_otp SET used=1 WHERE otp_code=?',[otp]);

    const sess=q1('SELECT * FROM KeyGenAuto WHERE telegram_user_id=? AND active_token=? LIMIT 1',
      [uid,otpRow.step_token]);
    if(!sess||sess.step_status==='DONE'){
      return ctx.replyWithHTML('⚠️ Session has expired. Please press /getkey again.');
    }

    if(parseInt(sess.current_step)!==otpRow.step_num){
      return ctx.replyWithHTML('⚠️ This OTP does not match the current step.');
    }

    const nextStep=parseInt(sess.current_step)+1;
    q('UPDATE KeyGenAuto SET current_step=? WHERE active_token=?',[nextStep,sess.active_token]);
    const updated=q1('SELECT * FROM KeyGenAuto WHERE active_token=? LIMIT 1',[sess.active_token]);
    await sendStep(ctx.telegram,uid,uid,updated,lang);
    return;
  }

  try{q('INSERT OR REPLACE INTO pk_user_settings(telegram_id,lang) VALUES(?,?)',[uid,lang]);}catch{}
  await ctx.replyWithHTML(t(lang,'w',{n:ctx.from.first_name||'User'})).catch(()=>{});
});

bot.command('help',async ctx=>{
  const lang=gl(ctx),adm=await isAdmin(ctx.from.id),sa=isSA(ctx.from.id);
  let msg=t(lang,'hu');
  if(adm)msg+='\n\n'+t(lang,'ha');
  if(sa)msg+='\n\n'+t(lang,'ho');
  await ctx.replyWithHTML(msg);
});

bot.command('mykey',async ctx=>{
  const lang=gl(ctx);
  try{
    const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[ctx.from.id]);
    if(!key)return ctx.replyWithHTML(t(lang,'nk'));
    const isUsed=dc(key.devices)>0,exp=isUsed?ie(key.created_at,key.duration):false;
    const hdr=!isUsed?('⏳ '+t(lang,'si')):(exp?t(lang,'xm'):t(lang,'am'));
    await ctx.replyWithHTML(hdr+'\n\n'+fki(key,lang),kbMy(isUsed,exp,lang));
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('getkey',async ctx=>{
  const lang=gl(ctx),uid=ctx.from.id;
  if(MAINTENANCE_MODE&&!isSA(uid))return ctx.replyWithHTML('🛠 <b>System under maintenance</b>\nPlease try again later.');
  try{
    const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[uid]);
    if(key){
      const isUsed=dc(key.devices)>0;

      const exp=isUsed?(key.expired_date?Date.now()>new Date(key.expired_date).getTime():ie(key.created_at,key.duration)):false;

      if(exp){ }
      else{
        const hdr=!isUsed?('⏳ '+t(lang,'si')):t(lang,'am');
        return ctx.replyWithHTML(hdr+'\n\n'+fki(key,lang),kbMy(isUsed,exp,lang));
      }
    }
  }catch{}
  if(CHANNEL_ID&&!(await isMem(ctx)))return ctx.replyWithHTML(t(lang,'mj'),Markup.inlineKeyboard([[Markup.button.url(t(lang,'jb'),CHANNEL_INV)]]));
  await ctx.replyWithHTML(t(lang,'pick_days'),kbPickDays(lang));
});

bot.action(/^free_d_(\d+)$/,async ctx=>{
  const lang=gl(ctx);
  await ctx.answerCbQuery().catch(()=>{});
  if(MAINTENANCE_MODE&&!isSA(ctx.from.id))return ctx.replyWithHTML('🛠 <b>System under maintenance</b>\nPlease try again later.');
  const days=parseInt(ctx.match[1]);
  if(days<1||days>MAX_FREE_DAYS)return ctx.reply('❌ Invalid.');
  try{await ctx.deleteMessage();}catch{}
  await startGetkey(ctx,days);
});

function resetKeyData(key){
  q('UPDATE keys_code SET devices=NULL,expired_date=NULL WHERE user_key=?',[key]);
  q('DELETE FROM pk_key_devices WHERE user_key=?',[key]);
  broadcastToKey(key, { action: 'shutdown', message: 'DEVICES_RESET', reason: 'DEVICES_RESET' });
  for (const [ws, meta] of clients) {
    if (meta.key === key) ws.terminate();
  }
}

function deleteKeyData(key) {
  q('DELETE FROM keys_code WHERE user_key=?', [key]);
  q('DELETE FROM pk_key_devices WHERE user_key=?', [key]);
  broadcastToKey(key, { action: 'shutdown', message: 'KEY_DELETED', reason: 'KEY_DELETED' });
  for (const [ws, meta] of clients) {
    if (meta.key === key) ws.terminate();
  }
}

function renewKeyData(key, days) {
  const row = q1('SELECT * FROM keys_code WHERE user_key=?', [key]);
  if (!row) throw new Error('Key not found');
  const addHours = days * 24;
  const newDur = (row.duration || 0) + addHours;
  
  if (!row.devices) {
    q('UPDATE keys_code SET duration=? WHERE user_key=?', [newDur, key]);
    return null; // expiry not set yet
  } else {
    let base = Date.now();
    if (row.expired_date) {
      const eTime = new Date(row.expired_date).getTime();
      if (eTime > base) base = eTime;
    } else {
      // If used but expired_date is null, base is created_at + original duration? Actually, just start from now.
    }
    const newExp = new Date(base + addHours * 3600000).toISOString();
    q('UPDATE keys_code SET duration=?, expired_date=? WHERE user_key=?', [newDur, newExp, key]);
    return newExp;
  }
}

bot.command('resetkey',async ctx=>{
  const lang=gl(ctx), ks=(ctx.message.text.split(' ')[1]||'').trim().toUpperCase();
  if(!ks)return ctx.reply('Usage: /resetkey <key>');
  try{resetKeyData(ks);ctx.replyWithHTML(t(lang,'rs'));}catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('genkey',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  ss(ctx.from.id,{step:'type',data:{},lang});
  await ctx.replyWithHTML(t(lang,'gt'),Markup.inlineKeyboard([[Markup.button.callback('🆓 FREE','gk_t_FREE'),Markup.button.callback('👑 ADMIN','gk_t_ADMIN')],[Markup.button.callback('❌ Cancel','gk_no')]]));
});

bot.command('listkeys',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  await skl(ctx.telegram,ctx.chat.id,parseInt(ctx.message.text.split(' ')[1])||1,lang);
});

bot.command('keyinfo',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  const ks=ctx.message.text.split(' ')[1];
  if(!ks)return ctx.reply('Usage: /keyinfo <key>');
  try{const key=q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1',[ks]);if(!key)return ctx.replyWithHTML(t(lang,'nf'));await ctx.replyWithHTML(fki(key,lang),kbAK(key.user_key,lang));}catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('infokey', async ctx => {
  const lang = gl(ctx);
  if (!(await isAdmin(ctx.from.id))) return ctx.replyWithHTML(t(lang, 'na'));
  const arg = ctx.message.text.split(' ')[1];
  if (!arg) return ctx.reply('Usage: /infokey <key_string | telegram_id>');

  try {

    if (/^\d+$/.test(arg)) {
      const tgid = parseInt(arg);
      const rows = q('SELECT * FROM keys_code WHERE telegram_user_id=? ORDER BY created_at DESC', [tgid]);
      const isBanned = bannedTgIds.has(tgid);
      const banStatusText = isBanned ? t(lang, 'fk_banned') : t(lang, 'fk_notbanned');

      if (!rows.length) {
        const uname = getUsername(tgid); const unameStr = uname ? uname : ''; const header = t(lang, 'fk_header', { tgid, count: 0, banstatus: banStatusText, username: unameStr });
        const banBtn = isBanned
          ? [{ text: '✅ Unban User', callback_data: `ik_unbanuser:${tgid}` }]
          : [{ text: '🚫 Ban User', callback_data: `ik_banuser:${tgid}` }];
        return ctx.replyWithHTML(header + t(lang, 'nf'), { reply_markup: { inline_keyboard: [banBtn] } });
      }

      const uname2 = getUsername(tgid); const unameStr2 = uname2 ? uname2 : ''; let text = t(lang, 'fk_header', { tgid, count: rows.length, banstatus: banStatusText, username: unameStr2 });
      for (let i = 0; i < rows.length; i++) text += fki(rows[i], lang, { idx: i + 1, showBlocked: true });
      text += '═══════════════';

      const banBtn = isBanned
        ? [{ text: '✅ Unban User', callback_data: `ik_unbanuser:${tgid}` }]
        : [{ text: '🚫 Ban User', callback_data: `ik_banuser:${tgid}` }];

      return ctx.replyWithHTML(text, { reply_markup: { inline_keyboard: [banBtn] } });
    }

    const key = q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1', [arg]);
    if (!key) return ctx.replyWithHTML(t(lang, 'nf'));

    const keyText = fki(key, lang);
    const devText = fdi(key, lang);

    const isBlocked = !!key.blocked;
    await ctx.replyWithHTML(keyText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: t(lang, 'br'), callback_data: `k_rst:${key.user_key}` },
            { text: t(lang, 'bw'), callback_data: `k_rnw:${key.user_key}` },
          ],
          [
            isBlocked
              ? { text: '✅ Unban Key', callback_data: `ik_unbankey:${key.user_key}` }
              : { text: '🚫 Ban Key',   callback_data: `ik_bankey:${key.user_key}` },
            { text: t(lang, 'bdev'), callback_data: `k_dev:${key.user_key}` },
          ],
          [{ text: t(lang, 'bd'), callback_data: `k_del:${key.user_key}` }],
        ],
      },
    });
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.action(/^ik_banuser:(\d+)$/, async ctx => {
  if (!isSA(ctx.from.id)) return ctx.answerCbQuery('⛔ Owner only', { show_alert: true }).catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  const tgid = parseInt(ctx.match[1]);
  await doBan(ctx, 'user', String(tgid));

  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Unban User', callback_data: `ik_unbanuser:${tgid}` }]] }); } catch {}
});
bot.action(/^ik_unbanuser:(\d+)$/, async ctx => {
  if (!isSA(ctx.from.id)) return ctx.answerCbQuery('⛔ Owner only', { show_alert: true }).catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  const tgid = parseInt(ctx.match[1]);
  await doUnban(ctx, 'user', String(tgid));
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '🚫 Ban User', callback_data: `ik_banuser:${tgid}` }]] }); } catch {}
});
bot.action(/^ik_bankey:(.+)$/, async ctx => {
  if (!isSA(ctx.from.id)) return ctx.answerCbQuery('⛔ Owner only', { show_alert: true }).catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  const key = ctx.match[1];
  await doBan(ctx, 'key', key);
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Unban Key', callback_data: `ik_unbankey:${key}` },{ text: '📱 Devices', callback_data: `k_dev:${key}` }],[{ text: '🗑 Delete', callback_data: `k_del:${key}` }]] }); } catch {}
});
bot.action(/^ik_unbankey:(.+)$/, async ctx => {
  if (!isSA(ctx.from.id)) return ctx.answerCbQuery('⛔ Owner only', { show_alert: true }).catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  const key = ctx.match[1];
  await doUnban(ctx, 'key', key);
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '🔄 Reset', callback_data: `k_rst:${key}` },{ text: '🔁 Renew', callback_data: `k_rnw:${key}` }],[{ text: '🚫 Ban Key', callback_data: `ik_bankey:${key}` },{ text: '📱 Devices', callback_data: `k_dev:${key}` }],[{ text: '🗑 Delete', callback_data: `k_del:${key}` }]] }); } catch {}
});

bot.command('delkey',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  const ks=(ctx.message.text.split(' ')[1]||'').trim().toUpperCase();
  if(!ks)return ctx.reply('Usage: /delkey <key>');
  await ctx.replyWithHTML(t(lang,'cd',{key:ks}),kbC(lang,`k_del_ok:${ks}`,'noop'));
});

bot.command('resetdev',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  const ks=(ctx.message.text.split(' ')[1]||'').trim().toUpperCase();
  if(!ks)return ctx.reply('Usage: /resetdev <key>');
  try{resetKeyData(ks);ctx.replyWithHTML(t(lang,'rs'));}catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('renewkey',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  const[,ks,ds]=ctx.message.text.split(' ');
  if(!ks||!ds)return ctx.reply('Usage: /renewkey <key> <days>');
  const days=parseInt(ds);if(isNaN(days)||days<1)return ctx.replyWithHTML(t(lang,'in_'));
  try{
    const row=q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1',[ks]);
    if(!row)return ctx.replyWithHTML(t(lang,'nf'));
    const newDur=days*24;
    q('UPDATE keys_code SET duration=?,expired_date=NULL WHERE user_key=?',[newDur,ks]);
    const expiry=fe(new Date().toISOString(),newDur);
    ctx.replyWithHTML(t(lang,'rd',{expiry}));
  }catch(e){ctx.reply('❌ '+e.message);}
});


bot.command('cleartemp', async ctx => {
  if (!(await isSA(ctx.from.id))) return ctx.replyWithHTML('⛔ Super Admin only');
  try {
    q('DELETE FROM pk_step_otp');
    q("DELETE FROM KeyGenAuto WHERE step_status='WAIT'");
    q("DELETE FROM pk_web_keygen WHERE step_status='WAIT'");
    sessionCooldown.clear();
    webGetkeyCooldown.clear();
    getKeyLock.clear();
    webGetkeyLock.clear();
    ctx.reply('✅ GETKEY OTP, pending sessions & temporary locks cleared.');
  } catch(e) {
    ctx.reply('❌ ' + e.message);
  }
});

bot.command('stats',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  try{
    const[{total}]=q('SELECT COUNT(*) total FROM keys_code');
    const rows=q('SELECT * FROM keys_code');
    let active=0,expired=0;
    for(const r of rows){const u=dc(r.devices)>0;if(!u){active++;}else if(ie(r.created_at,r.duration)){expired++;}else{active++;}}
    const[{admins}]=q('SELECT COUNT(*) admins FROM pk_admins');
    ctx.replyWithHTML(t(lang,'st',{total,active,expired,admins}));
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('listadmins',async ctx=>{
  const lang=gl(ctx);
  if(!(await isAdmin(ctx.from.id)))return ctx.replyWithHTML(t(lang,'na'));
  try{
    const admins=q('SELECT telegram_id,added_at FROM pk_admins');
    const sl=[...SUPER_ADMINS].map(id=>`• <code>${id}</code> 👑 Super Admin`).join('\n');
    const al=admins.map(a=>`• <code>${a.telegram_id}</code> — ${a.added_at}`).join('\n');
    ctx.replyWithHTML(t(lang,'la',{list:sl+(al?'\n'+al:'')}));
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('addadmin',async ctx=>{
  const lang=gl(ctx);
  if(!isSA(ctx.from.id))return ctx.replyWithHTML(t(lang,'na'));
  const uid=parseInt(ctx.message.text.split(' ')[1]);
  if(isNaN(uid))return ctx.reply('Usage: /addadmin <telegram_id>');
  try{q(`INSERT OR REPLACE INTO pk_admins(telegram_id,added_by,added_at) VALUES(?,?,datetime('now'))`,[uid,ctx.from.id]);ac.ts=0;ctx.replyWithHTML(t(lang,'aa',{uid}));}catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('rmadmin',async ctx=>{
  const lang=gl(ctx);
  if(!isSA(ctx.from.id))return ctx.replyWithHTML(t(lang,'na'));
  const uid=parseInt(ctx.message.text.split(' ')[1]);
  if(isNaN(uid))return ctx.reply('Usage: /rmadmin <telegram_id>');
  try{q('DELETE FROM pk_admins WHERE telegram_id=?',[uid]);ac.ts=0;ctx.replyWithHTML(t(lang,'ra',{uid}));}catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('setversion',async ctx=>{
  if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only');
  const parts=ctx.message.text.split(' ');
  if(parts.length<3)return ctx.reply('Usage: /setversion <version> <download_url>');
  const[,ver,dl]=parts;
  try{
    q(`INSERT INTO pk_versions(version,download_url,created_at) VALUES(?,?,datetime('now'))`,[ver,dl]);
    ctx.replyWithHTML(`✅ Version set to <b>${ver}</b>\nDownload: ${dl}`);
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.command('notifyupdate',async ctx=>{
  if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only');
  const arg=ctx.message.text.split(' ')[1];
  const dlRow=q1('SELECT * FROM pk_versions ORDER BY id DESC LIMIT 1');
  const payload={
    action:'update_available',
    version:dlRow?.version||CURRENT_VERSION,
    download_url:dlRow?.download_url||'',
    message:'There`s a new update. Please update to continue using the lib'
  };
  let count;
  if(arg){
    count=broadcastToKey(arg,payload);
    if(count===0)count=broadcastToLibId(arg,payload);
    ctx.reply(`📢 Sent update notification to ${count} lib(s) [filter: ${arg}]`);
  }else{
    count=broadcastAll(payload);
    ctx.reply(`📢 Sent update notification to ${count} connected lib(s)`);
  }
});

bot.command('shutdown',async ctx=>{
  if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only');
  const count=broadcastAll({action:'shutdown',message:'ระบบปิดชั่วคราว โปรดรอการแจ้งเตือน'});

  for(const[ws] of clients){ws.terminate();}
  clients.clear();
  ctx.reply(`🔴 Shutdown sent to ${count} lib(s). All disconnected.`);
});

bot.command('shutdownlib',async ctx=>{
  if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only');
  const arg=ctx.message.text.split(' ')[1];
  if(!arg)return ctx.reply('Usage: /shutdownlib <lib_id_or_key>');
  const payload={action:'shutdown',message:'ระบบปิดชั่วคราว'};
  let count=0;const toRemove=[];
  for(const[ws,meta] of clients){
    if(meta.lib_id===arg||meta.key===arg){wsSend(ws,payload);count++;toRemove.push(ws);}
  }
  for(const ws of toRemove){ws.terminate();clients.delete(ws);}
  ctx.reply(`🔴 Shutdown ${arg}: ${count} lib(s) affected`);
});

bot.command('maintenance',async ctx=>{
  if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only');
  const arg=(ctx.message.text.split(' ')[1]||'').toLowerCase();
  if(arg!=='on'&&arg!=='off')return ctx.reply('Usage: /maintenance on|off');
  if(arg==='on'){
    MAINTENANCE_MODE=true;
    const payload={action:'shutdown',message:'SERVER_DISABLED',reason:'SERVER_DISABLED'};
    const count=broadcastAll(payload);
    for(const[ws] of clients){ws.terminate();}
    clients.clear();
    ctx.reply(`🛠 Maintenance mode: ON\nDisconnected ${count} lib(s). New connections and /getkey are blocked until /maintenance off.`);
  }else{
    MAINTENANCE_MODE=false;
    ctx.reply('✅ Maintenance mode: OFF\nServer is back online.');
  }
});

async function doBan(ctx, typeRaw, value) {
  const type = (typeRaw || '').toLowerCase();
  const lang = gl(ctx);
  const validTypes = ['key','ip','serial','user','lib'];
  if (!validTypes.includes(type)) {
    return ctx.reply('Usage: /ban <key|ip|serial|user|lib> <value>');
  }
  if (!value) return ctx.reply(`Usage: /ban ${type} <value>`);

  if (type === 'key') {
    const row = q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1', [value]);
    if (!row) return ctx.reply('❌ Key not found');
    q('UPDATE keys_code SET blocked=1 WHERE user_key=?', [value]);
    for (const [ws, meta] of clients) {
      if (meta.key === value) { wsSend(ws, {action:'shutdown',message:'USER_BLOCKED'}); ws.terminate(); clients.delete(ws); }
    }
    return ctx.replyWithHTML(`🚫 key <code>${value}</code> banned`);
  }
  if (type === 'ip') {
    bannedIps.add(value);
    q(`INSERT OR REPLACE INTO pk_banned_ips(ip,created_at) VALUES(?,datetime('now'))`, [value]);
    const toRemove = [];
    for (const [ws, meta] of clients) { if (meta.ip === value) { wsSend(ws,{action:'shutdown',message:'IP_BANNED'}); toRemove.push(ws); } }
    for (const ws of toRemove) { ws.terminate(); clients.delete(ws); }
    return ctx.replyWithHTML(`🚫 IP <code>${value}</code> banned (${toRemove.length} disconnected)`);
  }
  if (type === 'serial') {
    bannedSerials.add(value);
    q(`INSERT OR REPLACE INTO pk_banned_serials(serial,created_at) VALUES(?,datetime('now'))`, [value]);
    const toRemove = [];
    for (const [ws, meta] of clients) { if (meta.serial === value) { wsSend(ws,{action:'shutdown',message:'DEVICE_BANNED'}); toRemove.push(ws); } }
    for (const ws of toRemove) { ws.terminate(); clients.delete(ws); }
    return ctx.replyWithHTML(`🚫 serial <code>${value}</code> banned (${toRemove.length} disconnected)`);
  }
  if (type === 'user') {
    const uid = parseInt(value);
    if (isNaN(uid)) return ctx.reply('❌ Invalid Telegram ID');
    bannedTgIds.add(uid);
    q(`INSERT OR REPLACE INTO pk_banned_tgids(telegram_id,created_at) VALUES(?,datetime('now'))`, [uid]);
    const toRemove = [];
    for (const [ws, meta] of clients) { if (Number(meta.telegram_id) === uid) { wsSend(ws,{action:'shutdown',message:'USER_BLOCKED'}); toRemove.push(ws); } }
    for (const ws of toRemove) { ws.terminate(); clients.delete(ws); }
    return ctx.replyWithHTML(`🚫 Telegram ID <code>${uid}</code> banned (${toRemove.length} disconnected)`);
  }
  if (type === 'lib') {
    bannedLibIds.add(value);
    q(`INSERT OR REPLACE INTO pk_lib_ids(lib_id,blocked,created_at) VALUES(?,1,datetime('now'))`, [value]);
    for (const [ws, meta] of clients) {
      if (meta.lib_id === value) { wsSend(ws,{action:'shutdown',message:'LIB_DISABLED'}); ws.terminate(); clients.delete(ws); }
    }
    return ctx.reply(`🚫 lib_id <code>${value}</code> banned`);
  }
}

async function doUnban(ctx, typeRaw, value) {
  const type = (typeRaw || '').toLowerCase();
  const validTypes = ['key','ip','serial','user','lib'];
  if (!validTypes.includes(type)) {
    return ctx.reply('Usage: /unban <key|ip|serial|user|lib> <value>');
  }
  if (!value) return ctx.reply(`Usage: /unban ${type} <value>`);

  if (type === 'key') {
    const row = q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1', [value]);
    if (!row) return ctx.reply('❌ Key not found');
    q('UPDATE keys_code SET blocked=0 WHERE user_key=?', [value]);
    return ctx.replyWithHTML(`✅ key <code>${value}</code> unbanned`);
  }
  if (type === 'ip') {
    bannedIps.delete(value);
    q('DELETE FROM pk_banned_ips WHERE ip=?', [value]);
    return ctx.replyWithHTML(`✅ IP <code>${value}</code> unbanned`);
  }
  if (type === 'serial') {
    bannedSerials.delete(value);
    q('DELETE FROM pk_banned_serials WHERE serial=?', [value]);
    return ctx.replyWithHTML(`✅ serial <code>${value}</code> unbanned`);
  }
  if (type === 'user') {
    const uid = parseInt(value);
    if (isNaN(uid)) return ctx.reply('❌ Invalid Telegram ID');
    bannedTgIds.delete(uid);
    q('DELETE FROM pk_banned_tgids WHERE telegram_id=?', [uid]);
    return ctx.replyWithHTML(`✅ Telegram ID <code>${uid}</code> unbanned`);
  }
  if (type === 'lib') {
    bannedLibIds.delete(value);
    q('UPDATE pk_lib_ids SET blocked=0 WHERE lib_id=?', [value]);
    return ctx.reply(`✅ lib_id <code>${value}</code> unbanned`);
  }
}

bot.command('ban', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  const [, type, value] = ctx.message.text.split(' ');
  await doBan(ctx, type, value);
});
bot.command('unban', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  const [, type, value] = ctx.message.text.split(' ');
  await doUnban(ctx, type, value);
});

bot.command('bankey',    async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doBan(ctx,'key',ctx.message.text.split(' ')[1]); });
bot.command('unbankey',  async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doUnban(ctx,'key',ctx.message.text.split(' ')[1]); });
bot.command('banip',     async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doBan(ctx,'ip',ctx.message.text.split(' ')[1]); });
bot.command('unbanip',   async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doUnban(ctx,'ip',ctx.message.text.split(' ')[1]); });
bot.command('banserial', async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doBan(ctx,'serial',ctx.message.text.split(' ')[1]); });
bot.command('unbanserial',async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doUnban(ctx,'serial',ctx.message.text.split(' ')[1]); });
bot.command('banuser',   async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doBan(ctx,'user',ctx.message.text.split(' ')[1]); });
bot.command('unbanuser', async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doUnban(ctx,'user',ctx.message.text.split(' ')[1]); });
bot.command('banlib',    async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doBan(ctx,'lib',ctx.message.text.split(' ')[1]); });
bot.command('unbanlib',  async ctx=>{ if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only'); await doUnban(ctx,'lib',ctx.message.text.split(' ')[1]); });

function fmtUptime(ms){
  let s=Math.floor(ms/1000);
  const h=Math.floor(s/3600);s%=3600;
  const m=Math.floor(s/60);s%=60;
  if(h>0)return `${h}h ${m}m ${s}s`;
  if(m>0)return `${m}m ${s}s`;
  return `${s}s`;
}

const LIBSTATUS_PAGE_SIZE = 15;
function renderLibStatusPage(page){
  const now=Date.now();
  const entries=[...clients.values()];
  const total=entries.length;
  const totalPages=Math.max(1,Math.ceil(total/LIBSTATUS_PAGE_SIZE));
  page=Math.min(Math.max(1,page),totalPages);
  const start=(page-1)*LIBSTATUS_PAGE_SIZE;
  const pageEntries=entries.slice(start,start+LIBSTATUS_PAGE_SIZE);

  const lines=pageEntries.map((m,i)=>{
    const idx=start+i+1;
    const uptime=m.connectedAt?fmtUptime(now-m.connectedAt):'—';
    const keyShort=m.key?(m.key.length>18?m.key.slice(0,18)+'…':m.key):'N/A';
    const uname=m.telegram_id?getUsername(Number(m.telegram_id)):null;
    const unameStr=uname?` ${uname}`:'';
    const banned=m.telegram_id&&bannedTgIds.has(Number(m.telegram_id))?' 🚫':'';
    return (
      `<b>${idx}.</b> <code>${m.lib_id||'N/A'}</code>\n` +
      `  🗝 <code>${keyShort}</code>\n` +
      `  👤 <code>${m.telegram_id||'N/A'}</code>${unameStr}${banned}\n` +
      `  🌐 <code>${m.ip||'N/A'}</code>  ⏱ ${uptime}`
    );
  });

  const text=
    `🟢 <b>Connected: ${total}</b>  (${page}/${totalPages})\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    (lines.length?lines.join('\n\n'):'(empty)') +
    `\n\n<i>/libstatus &lt;key|tgid|ip|serial|lib_id&gt;</i>`;

  const buttons=[];
  if(page>1)buttons.push({text:'⬅️',callback_data:`libst:${page-1}`});
  buttons.push({text:`${page}/${totalPages} 🔄`,callback_data:`libst:${page}`});
  if(page<totalPages)buttons.push({text:'➡️',callback_data:`libst:${page+1}`});

  return {text,page,totalPages,keyboard:Markup.inlineKeyboard([buttons])};
}

bot.command('libstatus',async ctx=>{
  if(!isSA(ctx.from.id))return ctx.replyWithHTML('⛔ Owner only');
  if(!clients.size)return ctx.reply('📭 No libs connected');

  const args=ctx.message.text.split(' ').slice(1).filter(Boolean);
  let page=1;
  let filter=null;
  for(const a of args){
    const pm=a.match(/^p(\d+)$/i);
    if(pm){page=Math.max(1,parseInt(pm[1]));}
    else filter=a;
  }

  const now=Date.now();

  if(filter){
    const entries=[...clients.values()].filter(m=>m.key===filter||m.ip===filter||m.serial===filter||m.lib_id===filter||String(m.telegram_id)===filter);
    if(!entries.length)return ctx.reply(`📭 No match for "${filter}"`);
    const lines=entries.map((m,i)=>{
      const connectedAt=m.connectedAt?new Date(m.connectedAt).toISOString().replace('T',' ').slice(0,19):'N/A';
      const uptime=m.connectedAt?fmtUptime(now-m.connectedAt):'N/A';
      const banned=m.telegram_id&&bannedTgIds.has(Number(m.telegram_id))?' 🚫 BANNED':'';
      const uname=m.telegram_id?getUsername(Number(m.telegram_id)):null;
      const unameStr=uname?` (${uname})`:'';
      return (
        `🟢 <b>Match ${entries.length>1?`${i+1}/${entries.length}`:''}` + `</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Lib ID : <code>${m.lib_id||'N/A'}</code>\n` +
        `🗝 Key     : <code>${m.key||'N/A'}</code>\n` +
        `👤 TG ID  : <code>${m.telegram_id||'N/A'}</code>${unameStr}${banned}\n` +
        `🔌 Serial : <code>${m.serial||'N/A'}</code>\n` +
        `🌐 IP      : <code>${m.ip||'N/A'}</code>\n` +
        `🕐 Since  : ${connectedAt} UTC\n` +
        `⏱ Uptime : ${uptime}`
      );
    });
    return ctx.replyWithHTML(lines.join('\n\n'));
  }

  const {text,keyboard}=renderLibStatusPage(page);
  ctx.replyWithHTML(text,keyboard);
});

bot.action(/^libst:(\d+)$/,async ctx=>{
  if(!isSA(ctx.from.id))return ctx.answerCbQuery('⛔ Owner only',{show_alert:true}).catch(()=>{});
  await ctx.answerCbQuery().catch(()=>{});
  if(!clients.size){
    try{await ctx.editMessageText('📭 No libs connected');}catch{}
    return;
  }
  const page=parseInt(ctx.match[1]);
  const {text,keyboard}=renderLibStatusPage(page);
  try{await ctx.editMessageText(text,{parse_mode:'HTML',...keyboard});}catch{}
});

bot.command('searchkeys', async ctx => {
  const lang = gl(ctx);
  if (!(await isAdmin(ctx.from.id))) return ctx.replyWithHTML(t(lang, 'na'));

  const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!raw) return ctx.reply('Usage: /searchkeys <keyword|days:N|type:X> ...\nExamples:\n  /searchkeys myuser\n  /searchkeys days:7\n  /searchkeys type:ADMIN\n  /searchkeys days:3 type:FREE');

  let keyword = null, filterDays = null, filterType = null;
  const tokens = raw.split(/\s+/);
  const remaining = [];
  for (const tok of tokens) {
    const dm = tok.match(/^days:(\d+)$/i);
    const tm = tok.match(/^type:(\w+)$/i);
    if (dm) { filterDays = parseInt(dm[1]); }
    else if (tm) { filterType = tm[1].toUpperCase(); }
    else { remaining.push(tok); }
  }
  if (remaining.length) keyword = remaining.join(' ');

  let sql = 'SELECT * FROM keys_code WHERE 1=1';
  const params = [];
  if (keyword) {
    sql += ' AND (user_key LIKE ? OR note LIKE ? OR CAST(telegram_user_id AS TEXT) LIKE ?)';
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  if (filterDays !== null) {
    sql += ' AND duration=?';
    params.push(filterDays * 24);
  }
  if (filterType) {
    sql += ' AND UPPER(key_type)=?';
    params.push(filterType);
  }
  sql += ' ORDER BY created_at DESC LIMIT 20';

  try {
    const rows = q(sql, params);
    if (!rows.length) return ctx.replyWithHTML(`🔍 ไม่พบ Key ที่ตรงกัน\n\n<i>keyword: ${keyword||'-'} | days: ${filterDays??'-'} | type: ${filterType||'-'}</i>`);

    let text = `🔍 <b>ผลการค้นหา</b> (${rows.length} รายการ)\n`;
    if (keyword)    text += `🔤 Keyword: <code>${keyword}</code>\n`;
    if (filterDays !== null) text += `📅 Days: <b>${filterDays}</b>\n`;
    if (filterType) text += `📋 Type: <b>${filterType}</b>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < rows.length; i++) {
      const k = rows[i];
      const isUsed = dc(k.devices) > 0;
      const exp = isUsed ? (k.expired_date ? Date.now() > new Date(k.expired_date).getTime() : ie(k.created_at, k.duration)) : false;
      const st = !isUsed ? '⏳' : (exp ? '❌' : '✅');
      const onlineNow = [...clients.values()].some(m => m.key === k.user_key);
      const onlineDot = onlineNow ? ' 🟢' : '';
      const days = Math.floor((k.duration || 0) / 24);
      text += `${i+1}. ${st}${onlineDot} <code>${k.user_key}</code>\n`;
      text += `   📋 ${k.key_type||'FREE'} | ${days}d | 📱${dc(k.devices)}/${k.max_devices||'∞'}\n`;
      if (k.note) text += `   📝 ${k.note}\n`;
      text += '\n';
    }
    if (rows.length === 20) text += '<i>⚠️ แสดงสูงสุด 20 รายการ กรุณา filter ให้แคบลง</i>';
    await ctx.replyWithHTML(text);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('libstatusadv', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  if (!clients.size) return ctx.reply('📭 No libs connected');

  const args = ctx.message.text.split(' ').slice(1).filter(Boolean);
  let filterDays = null, filterType = null, filterStr = null;

  for (const a of args) {
    const dm = a.match(/^days:(\d+)$/i);
    const tm = a.match(/^type:(\w+)$/i);
    if (dm) filterDays = parseInt(dm[1]);
    else if (tm) filterType = tm[1].toUpperCase();
    else filterStr = a;
  }

  const now = Date.now();

  let entries = [...clients.values()];

  if (filterDays !== null || filterType !== null || filterStr !== null) {
    entries = entries.filter(m => {
      if (filterStr) {
        if (m.key !== filterStr && m.ip !== filterStr && m.serial !== filterStr && m.lib_id !== filterStr && String(m.telegram_id) !== filterStr) return false;
      }
      if (filterDays !== null || filterType !== null) {
        const row = q1('SELECT key_type, duration FROM keys_code WHERE user_key=? LIMIT 1', [m.key]);
        if (!row) return false;
        if (filterDays !== null && Math.floor((row.duration || 0) / 24) !== filterDays) return false;
        if (filterType !== null && (row.key_type || '').toUpperCase() !== filterType) return false;
      }
      return true;
    });
  }

  if (!entries.length) return ctx.reply('📭 ไม่มี lib ที่ตรงกับ filter');

  const lines = entries.slice(0, 30).map((m, i) => {
    const uptime = m.connectedAt ? fmtUptime(now - m.connectedAt) : '—';
    const connectedAt = m.connectedAt ? new Date(m.connectedAt).toISOString().replace('T', ' ').slice(0, 19) : 'N/A';
    const uname = m.telegram_id ? getUsername(Number(m.telegram_id)) : null;
    const unameStr = uname ? ` (${uname})` : '';
    const banned = m.telegram_id && bannedTgIds.has(Number(m.telegram_id)) ? ' 🚫' : '';
    const row = q1('SELECT key_type, duration FROM keys_code WHERE user_key=? LIMIT 1', [m.key]);
    const typeTag = row ? `[${row.key_type||'FREE'} ${Math.floor((row.duration||0)/24)}d]` : '';
    return (
      `<b>${i+1}.</b> <code>${m.lib_id||'N/A'}</code> ${typeTag}\n` +
      `  🗝 <code>${m.key||'N/A'}</code>\n` +
      `  👤 <code>${m.telegram_id||'N/A'}</code>${unameStr}${banned}\n` +
      `  🌐 <code>${m.ip||'N/A'}</code>  ⏱ ${uptime}\n` +
      `  🕐 Since: ${connectedAt} UTC`
    );
  });

  let header = `🟢 <b>Connected: ${clients.size}</b> | Match: <b>${entries.length}</b>\n`;
  if (filterDays !== null) header += `📅 days:${filterDays}  `;
  if (filterType) header += `📋 type:${filterType}  `;
  if (filterStr) header += `🔍 filter:${filterStr}`;
  header += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  const text = header + lines.join('\n\n') + (entries.length > 30 ? `\n\n<i>⚠️ แสดงสูงสุด 30 รายการ</i>` : '');
  await ctx.replyWithHTML(text);
});

bot.command('msgkey', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 2) return ctx.reply('Usage: /msgkey <key> <message>');
  const key = parts[0];
  const msg = parts.slice(1).join(' ');
  if (!msg.trim()) return ctx.reply('❌ กรุณาระบุข้อความ');

  const payload = { action: 'admin_message', message: msg, from: 'Admin' };
  const count = broadcastToKey(key, payload);
  if (count === 0) return ctx.reply(`📭 Key <code>${key}</code> ไม่มี device online อยู่`, { parse_mode: 'HTML' });
  await ctx.replyWithHTML(`✅ ส่งข้อความไปยัง <b>${count}</b> device ที่ใช้ key <code>${key}</code>\n📩 "<i>${msg}</i>"`);
});

bot.command('msgdevice', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  const parts = ctx.message.text.split(' ').slice(1);
  if (parts.length < 2) return ctx.reply('Usage: /msgdevice <serial> <message>');
  const serial = parts[0];
  const msg = parts.slice(1).join(' ');
  if (!msg.trim()) return ctx.reply('❌ กรุณาระบุข้อความ');

  const payload = { action: 'admin_message', message: msg, from: 'Admin' };
  let count = 0;
  for (const [ws, meta] of clients) {
    if (meta.serial === serial) { wsSend(ws, payload); count++; }
  }
  if (count === 0) return ctx.reply(`📭 Serial <code>${serial}</code> ไม่ online อยู่`, { parse_mode: 'HTML' });
  await ctx.replyWithHTML(`✅ ส่งข้อความไปยัง device <code>${serial}</code>\n📩 "<i>${msg}</i>"`);
});

bot.command('msgall', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  const msg = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!msg) return ctx.reply('Usage: /msgall <message>');

  const payload = { action: 'admin_message', message: msg, from: 'Admin' };
  const count = broadcastAll(payload);
  if (count === 0) return ctx.reply('📭 ไม่มี device online อยู่เลย');
  await ctx.replyWithHTML(`✅ Broadcast ไปยัง <b>${count}</b> device ที่ online\n📩 "<i>${msg}</i>"`);
});

bot.command('onlinekeys', async ctx => {
  if (!(await isAdmin(ctx.from.id))) return ctx.replyWithHTML('⛔ No permission');
  if (!clients.size) return ctx.reply('📭 No devices online');

  const keyMap = new Map();
  for (const [, meta] of clients) {
    if (!keyMap.has(meta.key)) keyMap.set(meta.key, { count: 0, meta });
    keyMap.get(meta.key).count++;
  }

  let text = `🟢 <b>Online Keys</b> — ${keyMap.size} unique key(s), ${clients.size} device(s)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  let i = 1;
  for (const [key, { count, meta }] of keyMap) {
    const row = q1('SELECT key_type, duration, note, telegram_user_id FROM keys_code WHERE user_key=? LIMIT 1', [key]);
    const typeTag = row ? `[${row.key_type||'FREE'} ${Math.floor((row.duration||0)/24)}d]` : '';
    const uname = meta.telegram_id ? getUsername(Number(meta.telegram_id)) : null;
    const unameStr = uname ? ` ${uname}` : '';
    text += `${i++}. <code>${key}</code> ${typeTag}\n`;
    text += `   👤 <code>${meta.telegram_id||'N/A'}</code>${unameStr} | 📱 <b>${count}</b> device(s) online\n\n`;
  }
  await ctx.replyWithHTML(text);
});

bot.command('ownerpanel', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  const existing = getSysConfig('owner_path');
  if (existing) {
    return ctx.replyWithHTML('⚠️ An Owner Panel link is already active!\n\nPlease use /closepanel to invalidate the current one before generating a new one. This ensures only one admin has access at a time.');
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+!?@$*';
  let str = '';
  for(let i=0; i<300; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  setSysConfig('owner_path', str);
  const domain = ALLOWED_DOMAIN ? `https://${ALLOWED_DOMAIN}` : 'http://localhost:3000';
  await ctx.replyWithHTML(`👑 <b>Owner Control Panel Link</b>\n\nGenerated a secure endpoint for you:\n${domain}/owner?hash=${encodeURIComponent(str)}\n\n<i>⚠️ Important: This link will NOT expire automatically. You MUST use /closepanel when finished to secure the system.</i>`);
});

bot.command('closepanel', async ctx => {
  if (!isSA(ctx.from.id)) return ctx.replyWithHTML('⛔ Owner only');
  setSysConfig('owner_path', '');
  await ctx.replyWithHTML('✅ Owner Panel link invalidated successfully.');
});

bot.action('noop',async ctx=>{await ctx.answerCbQuery().catch(()=>{});});

bot.action(/^claim_s:([A-F0-9]+)$/,async ctx=>{
  const lang=gl(ctx),uid=ctx.from.id;
  await ctx.answerCbQuery().catch(()=>{});
  const otpCode=ctx.match[1];
  try{

    const otp=q1('SELECT * FROM pk_step_otp WHERE otp_code=? AND uid=? AND used=0 LIMIT 1',[otpCode,uid]);
    if(!otp)return ctx.reply('❌ Invalid or expired OTP');
    q('UPDATE pk_step_otp SET used=1 WHERE otp_code=?',[otpCode]);
    try{await ctx.deleteMessage();}catch{}

    const sess=q1('SELECT * FROM KeyGenAuto WHERE active_token=? AND telegram_user_id=? LIMIT 1',[otp.step_token,uid]);
    if(!sess)return ctx.replyWithHTML(t(lang,'session_err'));

    const nextStep=parseInt(sess.current_step)+1;
    q('UPDATE KeyGenAuto SET current_step=? WHERE active_token=?',[nextStep,otp.step_token]);
    const updSess=q1('SELECT * FROM KeyGenAuto WHERE active_token=? LIMIT 1',[otp.step_token]);

    if(nextStep>=parseInt(sess.total_steps)){

      const days=parseInt(sess.total_steps);
      const dur=days*24;
      const rand=crypto.randomBytes(6).toString('hex').toUpperCase();
      const newKey=`PK_FREE_${days}D_${rand}`;
      q(`INSERT INTO keys_code(user_key,key_type,duration,max_devices,devices,status,telegram_user_id,created_at) VALUES(?,?,?,1,'',1,?,datetime('now'))`,[newKey,'FREE',dur,uid]);
      incStat('getkey_done');
      q("UPDATE KeyGenAuto SET step_status='DONE',keyname=? WHERE active_token=?",[newKey,otp.step_token]);
      await ctx.replyWithHTML(t(lang,'claim_success',{key:newKey}));
    }else{
      await sendStep(ctx.telegram,uid,ctx.chat.id,updSess,lang);
    }
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.action('claim_final_key',async ctx=>{
  const lang=gl(ctx),uid=ctx.from.id;
  await ctx.answerCbQuery().catch(()=>{});
  try{
    const sess=q1("SELECT * FROM KeyGenAuto WHERE telegram_user_id=? AND step_status='WAIT' ORDER BY created_at DESC LIMIT 1",[uid]);
    if(!sess){

      const existing=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[uid]);
      if(existing){await ctx.replyWithHTML(t(lang,'claim_success',{key:existing.user_key}));try{await ctx.deleteMessage();}catch{}return;}
      return ctx.replyWithHTML(t(lang,'session_err'));
    }
    const cur=parseInt(sess.current_step),total=parseInt(sess.total_steps);

    if(cur<total){try{await ctx.deleteMessage();}catch{}await sendStep(ctx.telegram,uid,ctx.chat.id,sess,lang);return;}

    if(sess.keyname){

      await ctx.replyWithHTML(t(lang,'claim_success',{key:sess.keyname}));
      try{await ctx.deleteMessage();}catch{}
      return;
    }

    const days=parseInt(sess.total_steps);
    const dur=days*24;
    const rand=crypto.randomBytes(6).toString('hex').toUpperCase();
    const newKey=`PK_FREE_${days}D_${rand}`;
    q(`INSERT INTO keys_code(user_key,key_type,duration,max_devices,devices,status,telegram_user_id,created_at) VALUES(?,?,?,1,'',1,?,datetime('now'))`,[newKey,'FREE',dur,uid]);
    incStat('getkey_done');
    q("UPDATE KeyGenAuto SET step_status='DONE',keyname=? WHERE active_token=?",[newKey,sess.active_token]);
    await ctx.replyWithHTML(t(lang,'claim_success',{key:newKey}));
    try{await ctx.deleteMessage();}catch{}
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.action('my_del',async ctx=>{const lang=gl(ctx);await ctx.answerCbQuery().catch(()=>{});try{const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[ctx.from.id]);if(!key)return ctx.reply(t(lang,'nk'));await ctx.editMessageText(t(lang,'cd',{key:key.user_key}),{parse_mode:'HTML',...kbC(lang,'my_del_ok','my_cancel')});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action('my_del_ok',async ctx=>{const lang=gl(ctx);await ctx.answerCbQuery().catch(()=>{});try{const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[ctx.from.id]);if(!key)return ctx.reply(t(lang,'nk'));q('DELETE FROM keys_code WHERE user_key=?',[key.user_key]);await ctx.editMessageText(t(lang,'dl'),{parse_mode:'HTML'});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action('my_rst',async ctx=>{const lang=gl(ctx);await ctx.answerCbQuery().catch(()=>{});try{const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[ctx.from.id]);if(!key)return ctx.reply(t(lang,'nk'));await ctx.editMessageText(t(lang,'cr',{key:key.user_key}),{parse_mode:'HTML',...kbC(lang,'my_rst_ok','my_cancel')});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action('my_rst_ok',async ctx=>{const lang=gl(ctx);await ctx.answerCbQuery().catch(()=>{});try{const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[ctx.from.id]);if(!key)return ctx.reply(t(lang,'nk'));resetKeyData(key.user_key);const k2=q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1',[key.user_key]);await ctx.editMessageText(t(lang,'rs')+'\n\n'+fki(k2,lang),{parse_mode:'HTML',...kbMy(dc(k2.devices)>0,false,lang)});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action('my_rnw',async ctx=>{const lang=gl(ctx),uid=ctx.from.id;await ctx.answerCbQuery().catch(()=>{});const lastTs=sessionCooldown.get(uid)||0;const elapsed=Math.floor(Date.now()/1000)-lastTs;if(elapsed<SESSION_COOLDOWN_SECS){const remain=SESSION_COOLDOWN_SECS-elapsed;const m=Math.floor(remain/60),s=remain%60;return ctx.replyWithHTML(t(lang,'rl',{m,s}));}try{await ctx.editMessageText(t(lang,'pick_days'),{parse_mode:'HTML',reply_markup:kbPickDays(lang).reply_markup});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action('my_cancel',async ctx=>{const lang=gl(ctx);await ctx.answerCbQuery().catch(()=>{});try{const key=q1('SELECT * FROM keys_code WHERE telegram_user_id=? AND status=1 ORDER BY created_at DESC LIMIT 1',[ctx.from.id]);if(key){const u=dc(key.devices)>0,e=u?ie(key.created_at,key.duration):false;await ctx.editMessageText(fki(key,lang),{parse_mode:'HTML',...kbMy(u,e,lang)});}else await ctx.deleteMessage();}catch{}});
bot.action(/^kl_p:(\d+)$/,async ctx=>{const lang=gl(ctx);if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});await skl(ctx.telegram,ctx.chat.id,parseInt(ctx.match[1]),lang,ctx.callbackQuery.message.message_id);});
bot.action(/^k_rst:(.+)$/,async ctx=>{const lang=gl(ctx),ks=ctx.match[1];if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});await ctx.editMessageText(t(lang,'cr',{key:ks}),{parse_mode:'HTML',...kbC(lang,`k_rst_ok:${ks}`,'noop')});});
bot.action(/^k_rst_ok:(.+)$/,async ctx=>{const lang=gl(ctx),ks=ctx.match[1];if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});try{resetKeyData(ks);const key=q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1',[ks]);await ctx.editMessageText(key?fki(key,lang):t(lang,'rs'),{parse_mode:'HTML',...(key?kbAK(ks,lang):{})});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action(/^k_del:(.+)$/,async ctx=>{const lang=gl(ctx),ks=ctx.match[1];if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});await ctx.editMessageText(t(lang,'cd',{key:ks}),{parse_mode:'HTML',...kbC(lang,`k_del_ok:${ks}`,'noop')});});
bot.action(/^k_del_ok:(.+)$/,async ctx=>{const lang=gl(ctx),ks=ctx.match[1];if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});try{q('DELETE FROM keys_code WHERE user_key=?',[ks]);await ctx.editMessageText(`✅ Deleted <code>${ks}</code>`,{parse_mode:'HTML'});}catch(e){ctx.reply('❌ '+e.message);}});
bot.action(/^k_rnw:(.+)$/,async ctx=>{const lang=gl(ctx),ks=ctx.match[1];if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});ss(ctx.from.id,{step:'renew_days',data:{keyStr:ks},lang});await ctx.reply(t(lang,'rp',{key:ks}),{parse_mode:'HTML'});});
bot.action(/^k_dev:(.+)$/,async ctx=>{const lang=gl(ctx),ks=ctx.match[1];if(!(await isAdmin(ctx.from.id))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});try{const key=q1('SELECT * FROM keys_code WHERE user_key=? LIMIT 1',[ks]);if(!key)return ctx.reply(t(lang,'nf'));await ctx.replyWithHTML(fdi(key,lang));}catch(e){ctx.reply('❌ '+e.message);}});
bot.action(/^gk_t_(FREE|ADMIN)$/,async ctx=>{const lang=gl(ctx),type=ctx.match[1],uid=ctx.from.id;if(!(await isAdmin(uid))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});let st=gs(uid)||{data:{},lang};st.data.type=type;st.step='days';ss(uid,st);await ctx.editMessageText(t(lang,'gt'),{parse_mode:'HTML',reply_markup:KBD.reply_markup});});
bot.action(/^gk_d_(\d+|c)$/,async ctx=>{const lang=gl(ctx),val=ctx.match[1],uid=ctx.from.id;if(!(await isAdmin(uid))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}const st=gs(uid);if(!st){return ctx.answerCbQuery('Expired — /genkey',{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});if(val==='c'){st.step='days_custom';ss(uid,st);await ctx.reply(t(lang,'gd'));return;}st.data.days=parseInt(val);st.step='devices';ss(uid,st);await ctx.editMessageText(t(lang,'gv'),{parse_mode:'HTML',reply_markup:KBV.reply_markup});});
bot.action(/^gk_v_(\d+|c)$/,async ctx=>{const lang=gl(ctx),val=ctx.match[1],uid=ctx.from.id;if(!(await isAdmin(uid))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}const st=gs(uid);if(!st){return ctx.answerCbQuery('Expired — /genkey',{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});if(val==='c'){st.step='devices_custom';ss(uid,st);await ctx.reply(t(lang,'gv'));return;}st.data.max_devices=parseInt(val);st.step='note';ss(uid,st);await ctx.editMessageText(t(lang,'ask_name'),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:t(lang,'skip_btn'),callback_data:'gk_skip_name'}]]}});});
bot.action('gk_skip_name',async ctx=>{const lang=gl(ctx),uid=ctx.from.id,st=gs(uid);if(!st){return ctx.answerCbQuery('Expired — /genkey',{show_alert:true}).catch(()=>{});}await ctx.answerCbQuery().catch(()=>{});st.data.note='SKIP_NAME';st.step='confirm';ss(uid,st);const{type,days,max_devices}=st.data,dv=max_devices===0?t(lang,'un'):max_devices;await ctx.editMessageText(t(lang,'gp',{type,days,devices:dv,note:t(lang,'lbl_rand')}),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:t(lang,'bk'),callback_data:'gk_ok'},{text:t(lang,'bc'),callback_data:'gk_no'}]]}});});
bot.action('gk_no',async ctx=>{const lang=gl(ctx);await ctx.answerCbQuery().catch(()=>{});cs(ctx.from.id);await ctx.editMessageText(t(lang,'gx'),{parse_mode:'HTML'});});
bot.action('gk_ok',async ctx=>{
  const lang=gl(ctx),uid=ctx.from.id;
  if(!(await isAdmin(uid))){return ctx.answerCbQuery(t(lang,'na'),{show_alert:true}).catch(()=>{});}
  const st=gs(uid);if(!st||!st.data.type){return ctx.answerCbQuery('Expired',{show_alert:true}).catch(()=>{});}
  await ctx.answerCbQuery().catch(()=>{});cs(uid);
  try{
    const{type,days,max_devices,note}=st.data;
    const dur=days*24;
    let newKey,cleanNote='';
    if(!note||note==='SKIP_NAME'||note==='-'){
      const rand=crypto.randomBytes(6).toString('hex').toUpperCase();
      newKey=`PK_${type}_${days}D_${rand}`;
    }else{
      cleanNote=note.replace(/[^A-Za-z0-9_\-]/g,'');
      newKey=`PK_${type}_${cleanNote}`;
    }
    q(`INSERT INTO keys_code(user_key,key_type,duration,max_devices,devices,status,note,created_by,created_at) VALUES(?,?,?,?,?,1,?,?,datetime('now'))`,[newKey,type,dur,max_devices,'',cleanNote,uid]);
    const dv=max_devices===0?t(lang,'un'):max_devices;
    await ctx.editMessageText(t(lang,'gs',{key:newKey,type,days,devices:dv}),{parse_mode:'HTML'});
  }catch(e){ctx.reply('❌ '+e.message);}
});

bot.on('text',async ctx=>{
  const uid=ctx.from.id,lang=gl(ctx),st=gs(uid);
  if(!st)return;
  const txt=ctx.message.text.trim();
  if(st.step==='days_custom'){const n=parseInt(txt);if(isNaN(n)||n<1)return ctx.replyWithHTML(t(lang,'in_'));st.data.days=n;st.step='devices';ss(uid,st);return ctx.replyWithHTML(t(lang,'gv'),KBV);}
  if(st.step==='devices_custom'){const n=parseInt(txt);if(isNaN(n)||n<0)return ctx.replyWithHTML(t(lang,'in_'));st.data.max_devices=n;st.step='note';ss(uid,st);return ctx.replyWithHTML(t(lang,'gn'),{parse_mode:'HTML'});}
  if(st.step==='note'){st.data.note=txt;st.step='confirm';ss(uid,st);const{type,days,max_devices,note}=st.data,dv=max_devices===0?t(lang,'un'):max_devices;return ctx.replyWithHTML(t(lang,'gp',{type,days,devices:dv,note}),Markup.inlineKeyboard([[Markup.button.callback(t(lang,'bk'),'gk_ok'),Markup.button.callback(t(lang,'bc'),'gk_no')]]));}
  if(st.step==='renew_days'){const n=parseInt(txt);if(isNaN(n)||n<1)return ctx.replyWithHTML(t(lang,'in_'));cs(uid);try{const expiry=renewKeyData(st.data.keyStr, n);ctx.replyWithHTML(t(lang,'rd',{expiry: expiry ? fe(expiry, 0) : t(lang, 'lbl_unused')}));}catch(e){ctx.reply('❌ '+e.message);}}
});

function getSysConfig(k, def = null) {
  const r = q1('SELECT v FROM pk_sys_config WHERE k = ?', [k]);
  return r ? r.v : def;
}
function setSysConfig(k, v) {
  q('INSERT INTO pk_sys_config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, v]);
}
function incStat(k) {
  const curr = parseInt(getSysConfig(k, '0')) || 0;
  setSysConfig(k, (curr + 1).toString());
}

function initTables(){
  db.exec(`
    CREATE TABLE IF NOT EXISTS pk_admins (
      telegram_id INTEGER PRIMARY KEY,
      added_by    INTEGER DEFAULT NULL,
      added_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_user_settings (
      telegram_id INTEGER PRIMARY KEY,
      lang        TEXT DEFAULT 'en',
      username    TEXT DEFAULT NULL,
      first_name  TEXT DEFAULT NULL,
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      version      TEXT NOT NULL,
      download_url TEXT NOT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    DROP TABLE IF EXISTS pk_files;

    CREATE TABLE IF NOT EXISTS pk_lib_ids (
      lib_id     TEXT PRIMARY KEY,
      blocked    INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_banned_ips (
      ip         TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_banned_serials (
      serial     TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_banned_tgids (
      telegram_id INTEGER PRIMARY KEY,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_step_otp (
      otp_code   TEXT PRIMARY KEY,
      uid        INTEGER NOT NULL,
      step_token TEXT NOT NULL,
      step_num   INTEGER NOT NULL,
      url_ts     INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      used       INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_otp_uid ON pk_step_otp(uid);

    CREATE TABLE IF NOT EXISTS pk_key_devices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key   TEXT NOT NULL,
      serial     TEXT NOT NULL,
      lib_id     TEXT,
      ip         TEXT,
      version    TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_key, serial)
    );
    CREATE INDEX IF NOT EXISTS idx_pkd_key ON pk_key_devices(user_key);

    CREATE TABLE IF NOT EXISTS keys_code (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key         TEXT UNIQUE NOT NULL,
      key_type         TEXT DEFAULT 'FREE',
      duration         INTEGER DEFAULT 0,
      max_devices      INTEGER DEFAULT 0,
      devices          TEXT DEFAULT '',
      status           INTEGER DEFAULT 1,
      note             TEXT DEFAULT NULL,
      blocked          INTEGER DEFAULT 0,
      telegram_user_id INTEGER DEFAULT NULL,
      registrator      TEXT DEFAULT NULL,
      expired_date     TEXT DEFAULT NULL,
      created_by       INTEGER DEFAULT NULL,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS KeyGenAuto (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER DEFAULT NULL,
      active_token     TEXT NOT NULL,
      total_steps      INTEGER DEFAULT 0,
      current_step     INTEGER DEFAULT 0,
      step_status      TEXT DEFAULT 'WAIT',
      keyname          TEXT DEFAULT NULL,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_web_users (
      web_uid    INTEGER PRIMARY KEY,
      token_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pk_web_keygen (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      web_uid        INTEGER NOT NULL,
      session_token  TEXT NOT NULL,
      total_steps    INTEGER DEFAULT 0,
      current_step   INTEGER DEFAULT 0,
      step_status    TEXT DEFAULT 'WAIT',
      shortener_type TEXT DEFAULT 'shrinkme',
      keyname        TEXT DEFAULT NULL,
      created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webkeygen_uid ON pk_web_keygen(web_uid);
    CREATE INDEX IF NOT EXISTS idx_webkeygen_token ON pk_web_keygen(session_token);
    CREATE INDEX IF NOT EXISTS idx_kga_token ON KeyGenAuto(active_token);
    CREATE INDEX IF NOT EXISTS idx_kga_uid ON KeyGenAuto(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_kga_status ON KeyGenAuto(step_status);
    
    CREATE INDEX IF NOT EXISTS idx_kc_uid ON keys_code(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_kc_type ON keys_code(key_type);
    CREATE INDEX IF NOT EXISTS idx_kc_exp ON keys_code(expired_date);
    
    CREATE INDEX IF NOT EXISTS idx_wu_tokenhash ON pk_web_users(token_hash);
    CREATE INDEX IF NOT EXISTS idx_webkeygen_status ON pk_web_keygen(step_status);
    CREATE INDEX IF NOT EXISTS idx_kc_userkey ON keys_code(user_key);
    CREATE INDEX IF NOT EXISTS idx_kc_id ON keys_code(id);
    CREATE INDEX IF NOT EXISTS idx_kga_created_at ON KeyGenAuto(created_at);


    
    CREATE TABLE IF NOT EXISTS pk_sys_config (
      k TEXT PRIMARY KEY,
      v TEXT
    );
  `);

  if (!getSysConfig('getkey_click')) setSysConfig('getkey_click', '0');
  if (!getSysConfig('getkey_done')) setSysConfig('getkey_done', '0');

  const alters = [
    "ALTER TABLE keys_code ADD COLUMN devices TEXT DEFAULT ''",
    "ALTER TABLE keys_code ADD COLUMN max_devices INTEGER DEFAULT 0",
    "ALTER TABLE keys_code ADD COLUMN status INTEGER DEFAULT 1",
    "ALTER TABLE keys_code ADD COLUMN duration INTEGER DEFAULT 0",
    "ALTER TABLE keys_code ADD COLUMN telegram_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE keys_code ADD COLUMN key_type TEXT DEFAULT 'FREE'",
    "ALTER TABLE keys_code ADD COLUMN note TEXT DEFAULT NULL",
    "ALTER TABLE keys_code ADD COLUMN blocked INTEGER DEFAULT 0",
    "ALTER TABLE keys_code ADD COLUMN registrator TEXT DEFAULT NULL",
    "ALTER TABLE keys_code ADD COLUMN expired_date TEXT DEFAULT NULL",
    "ALTER TABLE keys_code ADD COLUMN created_by INTEGER DEFAULT NULL",
    "ALTER TABLE KeyGenAuto ADD COLUMN telegram_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE KeyGenAuto ADD COLUMN keyname TEXT DEFAULT NULL",
    "ALTER TABLE pk_web_keygen ADD COLUMN shortener_type TEXT DEFAULT 'shrinkme'",
  ];
  for (const sql of alters) { try { db.exec(sql); } catch {} }

  const userAlters = [
    "ALTER TABLE pk_user_settings ADD COLUMN username TEXT DEFAULT NULL",
    "ALTER TABLE pk_user_settings ADD COLUMN first_name TEXT DEFAULT NULL",
  ];
  for (const sql of userAlters) { try { db.exec(sql); } catch {} }

  const banned = q('SELECT lib_id FROM pk_lib_ids WHERE blocked=1');
  for (const { lib_id } of banned) bannedLibIds.add(lib_id);

  const bannedIpRows = q('SELECT ip FROM pk_banned_ips');
  for (const { ip } of bannedIpRows) bannedIps.add(ip);
  const bannedSerialRows = q('SELECT serial FROM pk_banned_serials');
  for (const { serial } of bannedSerialRows) bannedSerials.add(serial);

  const bannedTgIdRows = q('SELECT telegram_id FROM pk_banned_tgids');
  for (const { telegram_id } of bannedTgIdRows) bannedTgIds.add(Number(telegram_id));

  console.log('✅ DB tables OK');
}

async function main(){
  console.log('🚀 Starting server...');
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoAuthToken) {
    db = new Database(DB_PATH, {
      syncUrl: tursoUrl,
      authToken: tursoAuthToken
    });
    try {
      db.sync();
      console.log('✅ Turso LibSQL connected in sync mode.');
    } catch(err) {
      console.error('⚠️ Turso sync failed on startup:', err.message);
    }
    setInterval(() => {
      try { db.sync(); } catch(e) {}
    }, 60000);
  } else {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    console.log('✅ Local SQLite connected.');
  }
  db.pragma('foreign_keys = ON');
  initTables();
  startHTTP();
  bot.launch().then(() => {
    console.log('✅ Bot running!');
  }).catch(err => {
    console.error('⚠️ Telegram bot failed to launch (maybe another instance is running?):', err.message);
  });
  process.once('SIGINT', ()=>{ bot.stop('SIGINT'); process.exit(0); });
  process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); process.exit(0); });
}

main().catch(console.error);
