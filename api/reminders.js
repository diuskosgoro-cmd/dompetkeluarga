// Vercel Function: menjadwalkan / membatalkan push pengingat tagihan lewat OneSignal.
// Environment Variables (Vercel > Settings > Environment Variables):
//   ONESIGNAL_APP_ID   = App ID OneSignal
//   ONESIGNAL_API_KEY  = REST API Key OneSignal (JANGAN ditaruh di index.html)
const crypto = require('crypto');

const APP = process.env.ONESIGNAL_APP_ID;
const KEY = process.env.ONESIGNAL_API_KEY;
const API = 'https://api.onesignal.com';
const hdr = { 'Content-Type': 'application/json', Authorization: 'Key ' + KEY };

// external_id OneSignal dipakai sebagai kunci anti-duplikat; bentuk UUID dari hash
const uuid = s => {
  const h = crypto.createHash('sha1').update(s).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
};
// format waktu yang diterima send_after, dalam UTC
const fmt = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' GMT+0000';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Gunakan POST' });
  if (!APP || !KEY) return res.status(500).json({ error: 'ONESIGNAL_APP_ID / ONESIGNAL_API_KEY belum diisi di Vercel' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !/^[A-Za-z0-9_-]{3,64}$/.test(b.externalId || '')) return res.status(400).json({ error: 'externalId tidak valid' });

  const now = Date.now();
  const added = [], cancelled = [], errors = [];

  // 1) batalkan pengingat yang sudah tidak perlu (tagihan lunas / dihapus / diubah)
  for (const id of (Array.isArray(b.cancel) ? b.cancel : []).slice(0, 50)) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) continue;
    try {
      const r = await fetch(`${API}/notifications/${id}?app_id=${APP}`, { method: 'DELETE', headers: hdr });
      if (r.ok || r.status === 400 || r.status === 404) cancelled.push(id); // 400/404 = sudah terkirim / tidak ada
    } catch (e) { /* dicoba lagi di sinkronisasi berikutnya */ }
  }

  // 2) jadwalkan pengingat baru
  for (const a of (Array.isArray(b.add) ? b.add : []).slice(0, 20)) {
    const at = +a.at;
    if (!a.key || !a.n || !(at > now && at < now + 40 * 864e5)) continue;
    try {
      const r = await fetch(`${API}/notifications?c=push`, {
        method: 'POST', headers: hdr,
        body: JSON.stringify({
          app_id: APP,
          target_channel: 'push',
          include_aliases: { external_id: [b.externalId] },
          headings: { en: String(a.title || 'Pengingat tagihan').slice(0, 100) },
          contents: { en: String(a.body || '').slice(0, 200) },
          send_after: fmt(at),
          external_id: uuid(b.externalId + '|' + a.key + '|' + a.n)
        })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.id && !j.errors) added.push({ key: a.key, id: j.id });
      else errors.push({ key: a.key, status: r.status, detail: j.errors || j });
    } catch (e) { errors.push({ key: a.key, status: 0, detail: String(e) }); }
  }

  res.status(200).json({ added, cancelled, errors });
};
