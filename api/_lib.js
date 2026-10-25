import crypto from 'node:crypto';

// 게임별 점수 상한과 "플레이 시간 대비 가능한 최대 점수"
export const GAMES = {
  knife:  { max: 1800,   perSec: 1,  slack: 3 },   // 초
  runner: { max: 100000, perSec: 24, slack: 10 },  // m (최고 속도 약 22.5m/s)
  stack:  { max: 1500,   perSec: 5,  slack: 3 },   // 층
};
export const IDS = Object.keys(GAMES);

let client = null;
export async function redis() {
  if (globalThis.__mockRedis) return globalThis.__mockRedis;
  if (!client) {
    const { Redis } = await import('@upstash/redis');
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
    });
  }
  return client;
}

export const secret = () => process.env.ADMIN_PASSWORD || '';

const mac = body => crypto.createHmac('sha256', 'sowon-token:' + secret()).update(body).digest('base64url');
export function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return body + '.' + mac(body);
}
export function verify(tok) {
  if (typeof tok !== 'string' || tok.length > 400) return null;
  const [body, m] = tok.split('.');
  if (!body || !m) return null;
  const exp = mac(body);
  if (m.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(exp))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}
export function samePassword(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export const idOf = name => crypto.createHash('sha256').update('sowon:' + name).digest('hex').slice(0, 24);
export const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
export const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

export async function limited(r, key, max, sec) {
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, sec);
  return n > max;
}

const parse = v => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

// 순위표 스냅숏(공개용: 실명 제외)을 다시 만들어 board:<게임> 에 저장
export async function rebuildBoard(r, game) {
  const z = await r.zrange('sowon:lb:' + game, 0, 99, { rev: true, withScores: true });
  const ids = [], scores = [];
  for (let i = 0; i < z.length; i += 2) { ids.push(String(z[i])); scores.push(Number(z[i + 1])); }
  let recs = {};
  if (ids.length) recs = (await r.hmget('sowon:rec:' + game, ...ids)) || {};
  const list = ids.map((id, i) => {
    const rec = parse(recs[id]) || {};
    return { id, nick: rec.nick || '-', score: scores[i], at: rec.at || 0 };
  });
  await r.set('sowon:board:' + game, JSON.stringify(list));
  return list;
}
export { parse };
