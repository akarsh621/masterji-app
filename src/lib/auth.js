import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb } from './db';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set. Add it to .env.local');
}
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '24h';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

export function getAuthUser(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) return null;

  const db = getDb();
  const user = db.prepare('SELECT id, name, role, active FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.active) return null;

  return user;
}

export function requireAuth(request) {
  const user = getAuthUser(request);
  if (!user) {
    return { error: 'Login zaroori hai', status: 401 };
  }
  return { user };
}

export function requireAdmin(request) {
  const result = requireAuth(request);
  if (result.error) return result;
  if (result.user.role !== 'admin') {
    return { error: 'Sirf admin access kar sakta hai', status: 403 };
  }
  return result;
}

const PRINT_AGENT_TOKEN = process.env.PRINT_AGENT_TOKEN || '';
const AGENT_USER = { id: 0, name: 'PrintAgent', role: 'agent' };

function isAgentRequest(request) {
  if (!PRINT_AGENT_TOKEN) return false;
  const header = request.headers.get('x-print-agent-token') || '';
  const a = Buffer.from(header);
  const b = Buffer.from(PRINT_AGENT_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAuthOrAgent(request) {
  if (isAgentRequest(request)) return { user: AGENT_USER };
  return requireAuth(request);
}

export function requireAdminOrAgent(request) {
  if (isAgentRequest(request)) return { user: AGENT_USER };
  return requireAdmin(request);
}
