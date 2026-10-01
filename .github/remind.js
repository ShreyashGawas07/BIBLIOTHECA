// Sends the daily "time to read" push at the time saved in the PUSH_CONFIG secret (created in the app's Settings).
const wp = require('web-push');
if (!process.env.PUSH_CONFIG) { console.log('PUSH_CONFIG secret not set, skipping'); process.exit(0); }
const c = JSON.parse(Buffer.from(process.env.PUSH_CONFIG.trim(), 'base64').toString());
const now = new Date(), half = now.getUTCMinutes() < 30 ? 0 : 30;
if (process.env.FORCE !== 'true' && (now.getUTCHours() !== c.h || half !== c.m)) { console.log('Not reminder time'); process.exit(0); }
wp.setVapidDetails('mailto:noreply@example.com', c.pub, c.priv);
wp.sendNotification(c.sub, '', { TTL: 6 * 3600, urgency: 'high' })
  .then(r => console.log('Sent', r.statusCode))
  .catch(e => { console.error('Push failed', e.statusCode, e.body); process.exit(1); });
