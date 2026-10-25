import crypto from 'node:crypto';
import { GAMES, redis, secret, sign, readBody, ipOf, limited } from './_lib.js';

// 게임 시작 때 받는 확인표(플레이 시간 검증용)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!secret()) return res.status(500).json({ error: 'no_admin_password' });
  const { game } = readBody(req);
  if (!GAMES[game]) return res.status(400).json({ error: 'game' });
  try {
    const r = await redis();
    if (await limited(r, 'sowon:rl:start:' + ipOf(req), 60, 60)) return res.status(429).json({ error: 'rate' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token: sign({ g: game, t: Date.now(), n: crypto.randomUUID() }) });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
}
