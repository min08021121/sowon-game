import { IDS, GAMES, redis, secret, samePassword, readBody, ipOf, limited, rebuildBoard, parse } from './_lib.js';

// 관리자: 비밀번호가 맞을 때만 실명 목록 / 기록 삭제
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  res.setHeader('Cache-Control', 'no-store');
  if (!secret()) return res.status(500).json({ error: 'no_admin_password' });
  try {
    const r = await redis();
    const b = readBody(req);
    if (await limited(r, 'sowon:rl:admin:' + ipOf(req), 30, 600)) return res.status(429).json({ error: 'rate' });
    if (!samePassword(b.password || '', secret())) return res.status(401).json({ error: 'password' });

    if (b.action === 'delete') {
      if (!GAMES[b.game] || typeof b.id !== 'string') return res.status(400).json({ error: 'bad' });
      await r.hdel('sowon:rec:' + b.game, b.id);
      await r.zrem('sowon:lb:' + b.game, b.id);
      await rebuildBoard(r, b.game);
      return res.status(200).json({ ok: true });
    }

    const out = {};
    for (const g of IDS) {
      const all = (await r.hgetall('sowon:rec:' + g)) || {};
      out[g] = Object.entries(all).map(([id, v]) => { const x = parse(v) || {}; return { id, name: x.name, nick: x.nick, score: x.score, at: x.at }; });
    }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
}
