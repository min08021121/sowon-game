import { GAMES, IDS, redis, verify, idOf, norm, readBody, ipOf, limited, rebuildBoard, parse } from './_lib.js';

export default async function handler(req, res) {
  try {
    const r = await redis();

    // 순위표 조회: 저장된 스냅숏 3개를 한 번에 읽고, 5초간 CDN 캐시
    if (req.method === 'GET') {
      const raw = await r.mget(...IDS.map(g => 'sowon:board:' + g));
      const out = {};
      IDS.forEach((g, i) => { out[g] = parse(raw[i]) || []; });
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');
      return res.status(200).json(out);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

    // 기록 제출
    const b = readBody(req);
    const game = b.game, name = norm(b.name), nick = norm(b.nick), score = Number(b.score);
    const cfg = GAMES[game];
    if (!cfg) return res.status(400).json({ error: 'game' });
    if (name.length < 2 || name.length > 20 || nick.length < 1 || nick.length > 12) return res.status(400).json({ error: 'name' });
    if (!Number.isFinite(score) || score < 0 || score > cfg.max) return res.status(400).json({ error: 'score' });

    const tok = verify(b.token);
    if (!tok || tok.g !== game) return res.status(400).json({ error: 'token' });
    const elapsed = (Date.now() - tok.t) / 1000;
    if (elapsed < 0 || elapsed > 3 * 3600) return res.status(400).json({ error: 'token' });
    if (score > elapsed * cfg.perSec + cfg.slack) return res.status(400).json({ error: 'too_fast' });

    if (await limited(r, 'sowon:rl:score:' + ipOf(req), 30, 60)) return res.status(429).json({ error: 'rate' });
    const fresh = await r.set('sowon:used:' + tok.n, 1, { nx: true, ex: 4 * 3600 });
    if (!fresh) return res.status(400).json({ error: 'token_used' });

    const id = idOf(name);
    const prev = parse(await r.hget('sowon:rec:' + game, id));
    const prevScore = prev && typeof prev.score === 'number' ? prev.score : null;
    const isBest = prevScore === null || score > prevScore;
    if (isBest) {
      await r.hset('sowon:rec:' + game, { [id]: JSON.stringify({ name, nick, score, at: Date.now() }) });
      await r.zadd('sowon:lb:' + game, { score, member: id });
    }
    const best = isBest ? score : prevScore;
    const above = await r.zcount('sowon:lb:' + game, '(' + best, '+inf');
    const list = isBest ? await rebuildBoard(r, game) : (parse(await r.get('sowon:board:' + game)) || []);
    const top = list.find(x => x.id !== id);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, best: isBest, prev: prevScore, id, rank: Number(above) + 1, topScore: top ? top.score : null, board: list });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
}
