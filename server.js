const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SEED_DB_B64 = require('./nes_po_db_b64.js');

let NativeDatabaseSync = null;
try {
  ({ DatabaseSync: NativeDatabaseSync } = require('node:sqlite'));
} catch {
  NativeDatabaseSync = null;
}

// Load .env file if present (zero external dependencies)
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const PORT = process.env.PORT || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL_ENV);
const SEED_DB_PATH = path.join(__dirname, 'nes_po.db');
const DB_PATH = IS_VERCEL ? '/tmp/nes_po.db' : SEED_DB_PATH;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

// Ensure writable /tmp/nes_po.db exists on Vercel Serverless (from local file or embedded Base64 seed)
if (!fs.existsSync(DB_PATH)) {
  if (fs.existsSync(SEED_DB_PATH)) {
    fs.copyFileSync(SEED_DB_PATH, DB_PATH);
  } else if (SEED_DB_B64) {
    fs.writeFileSync(DB_PATH, Buffer.from(SEED_DB_B64, 'base64'));
  }
}

// Universal SQLite Adapter: Uses built-in node:sqlite (Node 22+) OR sql.js WASM (Node 18/20 on Vercel)
let SQLJS_MODULE = null;
class SqlJsDatabaseAdapter {
  constructor(filePath) {
    this.filePath = filePath;
    const buf = fs.existsSync(filePath)
      ? fs.readFileSync(filePath)
      : Buffer.from(SEED_DB_B64, 'base64');
    this.rawDb = new SQLJS_MODULE.Database(new Uint8Array(buf));
    this.inTx = false;
  }
  _persist() {
    if (this.inTx) return;
    try {
      const data = this.rawDb.export();
      fs.writeFileSync(this.filePath, Buffer.from(data));
    } catch {}
  }
  exec(sql) {
    const u = String(sql).trim().toUpperCase();
    if (u.startsWith('BEGIN')) this.inTx = true;
    this.rawDb.run(sql);
    if (u.startsWith('COMMIT') || u.startsWith('ROLLBACK')) {
      this.inTx = false;
      this._persist();
    } else if (!this.inTx) {
      this._persist();
    }
  }
  prepare(sql) {
    const self = this;
    return {
      get(...params) {
        const stmt = self.rawDb.prepare(sql);
        try {
          if (params.length > 0) stmt.bind(params.map(p => (p === undefined ? null : p)));
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...params) {
        const stmt = self.rawDb.prepare(sql);
        const rows = [];
        try {
          if (params.length > 0) stmt.bind(params.map(p => (p === undefined ? null : p)));
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
      run(...params) {
        self.rawDb.run(sql, params.map(p => (p === undefined ? null : p)));
        let lastInsertRowid = 0;
        try {
          const res = self.rawDb.exec('SELECT last_insert_rowid() AS id');
          if (res && res[0] && res[0].values && res[0].values[0]) {
            lastInsertRowid = Number(res[0].values[0][0]);
          }
        } catch {}
        self._persist();
        return { lastInsertRowid };
      }
    };
  }
  close() {
    try { this.rawDb.close(); } catch {}
  }
}

let db = null;
async function ensureDbInitialized() {
  if (db) return;
  if (NativeDatabaseSync) {
    db = new NativeDatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
  } else {
    if (!SQLJS_MODULE) {
      let initSqlJs;
      try {
        initSqlJs = require('sql.js/dist/sql-asm.js');
      } catch {
        initSqlJs = require('sql.js');
      }
      SQLJS_MODULE = await initSqlJs();
    }
    db = new SqlJsDatabaseAdapter(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

let supabaseSyncedColdStart = false;

async function pullDbFromSupabaseIfConfigured() {
  await ensureDbInitialized();
  if (!HAS_SUPABASE || supabaseSyncedColdStart) return;
  supabaseSyncedColdStart = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/nes_cloud_snapshots?id=eq.1&select=db_base64,updated_at`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) return;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].db_base64) {
      const buf = Buffer.from(rows[0].db_base64, 'base64');
      if (buf.length > 4096) {
        try { db.close(); } catch {}
        db = null;
        fs.writeFileSync(DB_PATH, buf);
        await ensureDbInitialized();
      }
    }
  } catch (err) {
    console.warn('Supabase pull warning:', err.message);
  }
}

async function pushDbToSupabaseIfConfigured() {
  if (!HAS_SUPABASE) return;
  try {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
    const b64 = fs.readFileSync(DB_PATH).toString('base64');
    await fetch(`${SUPABASE_URL}/rest/v1/nes_cloud_snapshots`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        id: 1,
        db_base64: b64,
        updated_at: new Date().toISOString()
      })
    });
  } catch (err) {
    console.warn('Supabase push warning:', err.message);
  }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

async function sendJson(res, status, data) {
  if (res._isMutatingApi && status >= 200 && status < 300) {
    await pushDbToSupabaseIfConfigured();
  }
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    try {
      if (Buffer.isBuffer(req.body)) {
        const str = req.body.toString('utf-8');
        return Promise.resolve(str ? JSON.parse(str) : {});
      }
      if (typeof req.body === 'string') {
        return Promise.resolve(req.body ? JSON.parse(req.body) : {});
      }
      if (typeof req.body === 'object') {
        return Promise.resolve(req.body);
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf-8');
      total += buf.length;
      if (total > 25 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function computeNextPoNumber() {
  const settings = db.prepare('SELECT po_number_prefix, po_number_separator FROM document_settings WHERE id = 1').get();
  const prefix = (settings && settings.po_number_prefix) || 'PO/NES/';
  const sep = (settings && settings.po_number_separator) || '-';
  const year = new Date().getFullYear();
  const rows = db.prepare('SELECT po_number FROM purchase_orders').all();
  let maxSeq = 62;
  for (const r of rows) {
    const m = String(r.po_number).match(/(\d{4})[-/](\d{4})$/);
    if (m && Number(m[2]) === year) {
      const seq = Number(m[1]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}${nextSeq}${sep}${year}`;
}

function computeNextPrNumber() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const rows = db.prepare('SELECT pr_number FROM purchase_requisitions').all();
  let maxSeq = 28;
  for (const r of rows) {
    const m = String(r.pr_number).match(/\/(\d+)$/);
    if (m) {
      const seq = Number(m[1]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return `2/${month}/${String(maxSeq + 1).padStart(3, '0')}`;
}

function computeNextLotNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = db.prepare('SELECT COUNT(*) AS c FROM wms_lots').get().c || 0;
  return `LOT-${d}-${String(count + 1).padStart(2, '0')}`;
}

function computeNextItemCode(categoryId) {
  const cat = db.prepare('SELECT category_code FROM item_categories WHERE category_id = ?').get(Number(categoryId));
  const prefix = cat ? cat.category_code : 'IT';
  const rows = db.prepare('SELECT item_code FROM items WHERE category_id = ?').all(Number(categoryId));
  let maxNum = 0;
  for (const r of rows) {
    const m = String(r.item_code).match(/-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  const padLen = maxNum >= 99 ? String(maxNum + 1).length : 2;
  return `${prefix}-${String(maxNum + 1).padStart(padLen, '0')}`;
}

function computeNextVendorCode() {
  const rows = db.prepare('SELECT vendor_code FROM vendors').all();
  let maxSeq = 411;
  for (const r of rows) {
    const m = String(r.vendor_code).match(/^(\d+)\//);
    if (m) {
      const seq = Number(m[1]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  const thaiYear = new Date().getFullYear() + 543;
  return `${String(maxSeq + 1).padStart(3, '0')}/${thaiYear}`;
}

function refreshItemLastPrices() {
  db.exec(`
    UPDATE items
    SET last_unit_price = (
        SELECT pi.unit_price
        FROM po_items pi
        JOIN purchase_orders po ON pi.po_id = po.po_id
        WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
        ORDER BY po.po_date DESC, po.po_id DESC
        LIMIT 1
    ),
    last_vendor_id = (
        SELECT po.vendor_id
        FROM po_items pi
        JOIN purchase_orders po ON pi.po_id = po.po_id
        WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
        ORDER BY po.po_date DESC, po.po_id DESC
        LIMIT 1
    ),
    last_po_date = (
        SELECT po.po_date
        FROM po_items pi
        JOIN purchase_orders po ON pi.po_id = po.po_id
        WHERE pi.item_id = items.item_id AND po.approval_status = 'APPROVED'
        ORDER BY po.po_date DESC, po.po_id DESC
        LIMIT 1
    )
  `);
}

function syncPoToPr(poId) {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(Number(poId));
  if (!po) return;

  let pr = null;
  if (po.pr_id) {
    pr = db.prepare('SELECT * FROM purchase_requisitions WHERE pr_id = ?').get(Number(po.pr_id));
  }
  if (!pr && po.pr_number) {
    pr = db.prepare('SELECT * FROM purchase_requisitions WHERE pr_number = ?').get(String(po.pr_number).trim());
  }
  if (!pr) return;

  // Ensure PO stores pr_id, pr_number, requester & department snapshots
  db.prepare(`
    UPDATE purchase_orders
    SET pr_id = ?, pr_number = ?, pr_requester_snapshot = ?, pr_department_snapshot = ?
    WHERE po_id = ?
  `).run(pr.pr_id, pr.pr_number, pr.requester_name || '', pr.department || '', po.po_id);

  const telFax = [po.vendor_tel_snapshot ? `Tel: ${po.vendor_tel_snapshot}` : '', po.vendor_fax_snapshot ? `Fax: ${po.vendor_fax_snapshot}` : ''].filter(Boolean).join(' ');

  // Update PR Header with linked PO No, totals, purchasing officer & vendor snapshot
  db.prepare(`
    UPDATE purchase_requisitions
    SET linked_po_id = ?,
        linked_po_number = ?,
        po_sub_total = ?,
        po_vat_amount = ?,
        po_grand_total = ?,
        purchasing_officer_name = ?,
        purchasing_date = ?,
        vendor_id = COALESCE(?, vendor_id),
        vendor_name_snapshot = CASE WHEN ? != '' THEN ? ELSE vendor_name_snapshot END,
        vendor_address_snapshot = CASE WHEN ? != '' THEN ? ELSE vendor_address_snapshot END,
        vendor_tel_fax_snapshot = CASE WHEN ? != '' THEN ? ELSE vendor_tel_fax_snapshot END,
        status = 'PO_ISSUED',
        updated_at = CURRENT_TIMESTAMP
    WHERE pr_id = ?
  `).run(
    po.po_id,
    po.po_number,
    Number(po.net_total || po.sub_total || 0),
    Number(po.vat_amount || 0),
    Number(po.grand_total || 0),
    po.issued_by || 'ฝ่ายจัดซื้อ',
    po.po_date || new Date().toISOString().slice(0, 10),
    po.vendor_id,
    po.vendor_name_snapshot || '', po.vendor_name_snapshot || '',
    po.vendor_address_snapshot || '', po.vendor_address_snapshot || '',
    telFax, telFax,
    pr.pr_id
  );

  // Sync actual_unit_price & actual_line_total from PO Items into PR Items ("สำหรับแผนกจัดซื้อเท่านั้น")
  const poItems = db.prepare('SELECT * FROM po_items WHERE po_id = ? ORDER BY line_no ASC').all(po.po_id);
  const prItems = db.prepare('SELECT * FROM pr_items WHERE pr_id = ? ORDER BY line_no ASC').all(pr.pr_id);

  for (let i = 0; i < prItems.length; i++) {
    const pri = prItems[i];
    let matchedPoItem = poItems.find(pi => pi.item_id && pri.item_id && Number(pi.item_id) === Number(pri.item_id));
    if (!matchedPoItem && poItems[i]) {
      matchedPoItem = poItems[i];
    }
    if (matchedPoItem) {
      db.prepare(`
        UPDATE pr_items
        SET actual_unit_price = ?, actual_line_total = ?
        WHERE pr_item_id = ?
      `).run(Number(matchedPoItem.unit_price || 0), Number(matchedPoItem.line_total || 0), pri.pr_item_id);
    }
  }
}

function getAllVendorsWithTags() {
  const vendors = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM purchase_orders po WHERE po.vendor_id = v.vendor_id) AS po_count
    FROM vendors v
    ORDER BY v.vendor_id DESC
  `).all();

  const mappings = db.prepare(`
    SELECT m.vendor_id, t.tag_name
    FROM vendor_tag_mappings m
    JOIN vendor_tags t ON m.tag_id = t.tag_id
  `).all();

  const tagMap = new Map();
  for (const m of mappings) {
    if (!tagMap.has(m.vendor_id)) tagMap.set(m.vendor_id, []);
    tagMap.get(m.vendor_id).push(m.tag_name);
  }

  return vendors.map(v => ({
    ...v,
    tags: tagMap.get(v.vendor_id) || []
  }));
}

function getAllItemsWithDetails() {
  return db.prepare(`
    SELECT i.*,
      c.category_code,
      c.category_name,
      c.icon_url AS category_icon_url,
      v.vendor_name AS last_vendor_name,
      v.vendor_code AS last_vendor_code,
      COALESCE((SELECT SUM(wl.remaining_qty) FROM wms_lots wl WHERE wl.item_id = i.item_id), 0) AS current_stock,
      (SELECT COUNT(*) FROM wms_lots wl WHERE wl.item_id = i.item_id AND wl.remaining_qty > 0) AS active_lot_count
    FROM items i
    LEFT JOIN item_categories c ON i.category_id = c.category_id
    LEFT JOIN vendors v ON i.last_vendor_id = v.vendor_id
    ORDER BY i.item_id ASC
  `).all();
}

function getAllPrsWithItems() {
  const prs = db.prepare(`
    SELECT pr.*,
      po.approval_status AS linked_po_status
    FROM purchase_requisitions pr
    LEFT JOIN purchase_orders po ON pr.linked_po_id = po.po_id
    ORDER BY pr.pr_id DESC
  `).all();

  const allPrItems = db.prepare('SELECT * FROM pr_items ORDER BY pr_id DESC, line_no ASC').all();
  const map = new Map();
  for (const it of allPrItems) {
    if (!map.has(it.pr_id)) map.set(it.pr_id, []);
    map.get(it.pr_id).push(it);
  }

  return prs.map(p => ({
    ...p,
    purpose_flags: (() => { try { return JSON.parse(p.purpose_flags || '[]'); } catch { return []; } })(),
    items: map.get(p.pr_id) || []
  }));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const requestHandler = async (req, res) => {
  try {
    await pullDbFromSupabaseIfConfigured();

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let rawPathname = urlObj.searchParams.get('__pathname') || urlObj.pathname;
    if (rawPathname === '/api/index.js' || rawPathname === '/api/index') {
      const routeMatches = req.headers['x-now-route-matches'];
      if (routeMatches) {
        const matchParams = new URLSearchParams(routeMatches);
        const captured = matchParams.get('1');
        if (captured) rawPathname = `/api/${decodeURIComponent(captured)}`;
      }
    }
    if (rawPathname.length > 1) {
      rawPathname = rawPathname.replace(/\/+$/, '');
    }
    const pathname = rawPathname;
    const method = req.method.toUpperCase();

    res._isMutatingApi = pathname.startsWith('/api/') &&
      pathname !== '/api/auth/login' &&
      (method === 'POST' || method === 'PUT' || method === 'DELETE');

    // Download / Export SQLite .db file (for migrating from Vercel/Supabase Cloud to Customer Server)
    if (pathname === '/api/admin/export-db' && method === 'GET') {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
      const buf = fs.readFileSync(DB_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="nes_po.db"',
        'Content-Length': buf.length
      });
      return res.end(buf);
    }

    // ==========================================
    // 1. AUTH & USER MANAGEMENT API (RBAC)
    // ==========================================
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND is_active = 1').get(username);
      if (!user || user.password_hash !== hashPassword(password)) {
        return sendJson(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (Invalid username or password)' });
      }
      return sendJson(res, 200, {
        user: {
          user_id: user.user_id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          department: user.department,
          email: user.email
        }
      });
    }

    if (pathname === '/api/users' && method === 'GET') {
      const users = db.prepare('SELECT user_id, username, full_name, role, department, email, is_active, created_at FROM users ORDER BY user_id ASC').all();
      return sendJson(res, 200, users);
    }

    if (pathname === '/api/users' && method === 'POST') {
      const body = await parseBody(req);
      if (body.actor_role !== 'ADMIN') {
        return sendJson(res, 403, { error: 'เฉพาะผู้ดูแลระบบ (Role: Admin) เท่านั้นที่สามารถสร้างบัญชีผู้ใช้ได้' });
      }
      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();
      const fullName = String(body.full_name || '').trim();
      const role = String(body.role || 'PURCHASING').toUpperCase();
      if (!username || !password || !fullName) {
        return sendJson(res, 400, { error: 'กรุณากรอก Username, รหัสผ่าน และชื่อ-นามสกุลให้ครบถ้วน' });
      }
      if (!['ADMIN', 'APPROVER', 'PURCHASING', 'NORMAL_USER'].includes(role)) {
        return sendJson(res, 400, { error: 'Role ต้องเป็น ADMIN, APPROVER, PURCHASING หรือ NORMAL_USER เท่านั้น' });
      }
      const info = db.prepare(`
        INSERT INTO users (username, password_hash, full_name, role, department, email, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(username, hashPassword(password), fullName, role, String(body.department || '').trim(), String(body.email || '').trim());

      const created = db.prepare('SELECT user_id, username, full_name, role, department, email, is_active, created_at FROM users WHERE user_id = ?').get(info.lastInsertRowid);
      return sendJson(res, 201, created);
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userMatch) {
      const targetUserId = Number(userMatch[1]);
      if (method === 'PUT') {
        const body = await parseBody(req);
        if (body.actor_role !== 'ADMIN') {
          return sendJson(res, 403, { error: 'เฉพาะ Admin เท่านั้นที่สามารถแก้ไขข้อมูลผู้ใช้ได้' });
        }
        const existing = db.prepare('SELECT * FROM users WHERE user_id = ?').get(targetUserId);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบบัญชีผู้ใช้' });

        const newHash = body.password && String(body.password).trim() !== ''
          ? hashPassword(String(body.password).trim())
          : existing.password_hash;

        db.prepare(`
          UPDATE users
          SET username = ?, password_hash = ?, full_name = ?, role = ?, department = ?, email = ?, is_active = ?
          WHERE user_id = ?
        `).run(
          String(body.username || existing.username).trim(),
          newHash,
          String(body.full_name || existing.full_name).trim(),
          String(body.role || existing.role).toUpperCase(),
          body.department !== undefined ? String(body.department).trim() : existing.department,
          body.email !== undefined ? String(body.email).trim() : existing.email,
          body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
          targetUserId
        );
        const updated = db.prepare('SELECT user_id, username, full_name, role, department, email, is_active, created_at FROM users WHERE user_id = ?').get(targetUserId);
        return sendJson(res, 200, updated);
      }

      if (method === 'DELETE') {
        const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'ADMIN'").get().c;
        const target = db.prepare('SELECT * FROM users WHERE user_id = ?').get(targetUserId);
        if (target && target.role === 'ADMIN' && adminCount <= 1) {
          return sendJson(res, 400, { error: 'ไม่สามารถลบ Admin คนสุดท้ายของระบบได้' });
        }
        db.prepare('DELETE FROM users WHERE user_id = ?').run(targetUserId);
        return sendJson(res, 200, { deleted: true });
      }
    }

    // ==========================================
    // 2. BOOTSTRAP API
    // ==========================================
    if (pathname === '/api/bootstrap' && method === 'GET') {
      const settings = db.prepare('SELECT * FROM document_settings WHERE id = 1').get();
      const categories = db.prepare('SELECT * FROM item_categories ORDER BY category_id ASC').all();
      const vendorTags = db.prepare('SELECT * FROM vendor_tags ORDER BY tag_id ASC').all();
      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM vendors) AS total_vendors,
          (SELECT COUNT(*) FROM items) AS total_items,
          (SELECT COUNT(*) FROM purchase_orders) AS total_pos,
          (SELECT COUNT(*) FROM purchase_orders WHERE approval_status = 'PENDING') AS pending_pos,
          (SELECT COUNT(*) FROM purchase_orders WHERE approval_status = 'APPROVED') AS approved_pos,
          (SELECT COUNT(*) FROM purchase_orders WHERE approval_status = 'REJECTED') AS rejected_pos,
          (SELECT COUNT(*) FROM purchase_orders WHERE approval_status = 'DRAFT') AS draft_pos,
          (SELECT COALESCE(SUM(grand_total), 0) FROM purchase_orders WHERE approval_status = 'APPROVED') AS approved_spend,
          (SELECT COUNT(*) FROM purchase_requisitions WHERE status = 'OPEN') AS open_prs,
          (SELECT COUNT(*) FROM purchase_requisitions) AS total_prs,
          (SELECT COUNT(*) FROM wms_lots WHERE remaining_qty > 0) AS active_lots
      `).get();

      return sendJson(res, 200, {
        settings,
        categories,
        vendor_tags: vendorTags,
        next_po_number: computeNextPoNumber(),
        next_pr_number: computeNextPrNumber(),
        next_lot_number: computeNextLotNumber(),
        next_vendor_code: computeNextVendorCode(),
        stats
      });
    }

    // ==========================================
    // 3. PURCHASE REQUISITIONS (PR - FM-PU-01 / Rev.06) API
    // ==========================================
    if (pathname === '/api/prs' && method === 'GET') {
      return sendJson(res, 200, getAllPrsWithItems());
    }

    if (pathname === '/api/prs' && method === 'POST') {
      const body = await parseBody(req);
      const prNumber = String(body.pr_number || '').trim() || computeNextPrNumber();
      const prDate = body.pr_date || new Date().toISOString().slice(0, 10);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        return sendJson(res, 400, { error: 'กรุณาเพิ่มรายการขอซื้ออย่างน้อย 1 รายการ' });
      }

      const info = db.prepare(`
        INSERT INTO purchase_requisitions (
          pr_number, pr_date, department, vendor_id, vendor_name_snapshot,
          vendor_address_snapshot, vendor_tel_fax_snapshot, purpose_flags,
          requester_name, requester_user_id, reviewer_name, approver_name,
          purchasing_officer_name, purchasing_date, accounting_officer_name, accounting_date,
          status, effective_date, form_code, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)
      `).run(
        prNumber,
        prDate,
        body.department || 'แผนกผลิต (Production)',
        body.vendor_id ? Number(body.vendor_id) : null,
        body.vendor_name_snapshot || '',
        body.vendor_address_snapshot || '',
        body.vendor_tel_fax_snapshot || '',
        JSON.stringify(Array.isArray(body.purpose_flags) ? body.purpose_flags : []),
        body.requester_name || 'ผู้ขอซื้อ',
        body.requester_user_id ? Number(body.requester_user_id) : null,
        body.reviewer_name || '',
        body.approver_name || '',
        body.purchasing_officer_name || '',
        body.purchasing_date || '',
        body.accounting_officer_name || '',
        body.accounting_date || '',
        body.effective_date || 'Effective date : 11/11/2026',
        body.form_code || 'FM-PU-01 / Rev.06',
        body.remarks || ''
      );

      const prId = Number(info.lastInsertRowid);
      const insertPrItem = db.prepare(`
        INSERT INTO pr_items (
          pr_id, line_no, item_id, item_code_snapshot, item_name_snapshot,
          purpose, required_date, quantity, unit, actual_unit_price, actual_line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      items.forEach((it, idx) => {
        insertPrItem.run(
          prId,
          idx + 1,
          it.item_id ? Number(it.item_id) : null,
          it.item_code_snapshot || '',
          it.item_name_snapshot || '',
          it.purpose || '',
          it.required_date || '',
          Number(it.quantity || 1),
          it.unit || 'PCS',
          it.actual_unit_price !== undefined && it.actual_unit_price !== null && it.actual_unit_price !== '' ? Number(it.actual_unit_price) : null,
          it.actual_line_total !== undefined && it.actual_line_total !== null && it.actual_line_total !== '' ? Number(it.actual_line_total) : null
        );
      });

      const created = getAllPrsWithItems().find(p => p.pr_id === prId);
      return sendJson(res, 201, created);
    }

    const prMatch = pathname.match(/^\/api\/prs\/(\d+)$/);
    if (prMatch) {
      const prId = Number(prMatch[1]);
      if (method === 'GET') {
        const pr = getAllPrsWithItems().find(p => p.pr_id === prId);
        if (!pr) return sendJson(res, 404, { error: 'ไม่พบใบขอซื้อ (PR)' });
        return sendJson(res, 200, pr);
      }

      if (method === 'PUT') {
        const body = await parseBody(req);
        const existing = db.prepare('SELECT * FROM purchase_requisitions WHERE pr_id = ?').get(prId);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบใบขอซื้อ (PR)' });

        db.prepare(`
          UPDATE purchase_requisitions
          SET pr_number = ?, pr_date = ?, department = ?, vendor_id = ?,
              vendor_name_snapshot = ?, vendor_address_snapshot = ?, vendor_tel_fax_snapshot = ?,
              purpose_flags = ?, requester_name = ?, reviewer_name = ?, approver_name = ?,
              purchasing_officer_name = ?, purchasing_date = ?, accounting_officer_name = ?, accounting_date = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE pr_id = ?
        `).run(
          String(body.pr_number || existing.pr_number).trim(),
          body.pr_date || existing.pr_date,
          body.department !== undefined ? body.department : existing.department,
          body.vendor_id !== undefined ? (body.vendor_id ? Number(body.vendor_id) : null) : existing.vendor_id,
          body.vendor_name_snapshot !== undefined ? body.vendor_name_snapshot : existing.vendor_name_snapshot,
          body.vendor_address_snapshot !== undefined ? body.vendor_address_snapshot : existing.vendor_address_snapshot,
          body.vendor_tel_fax_snapshot !== undefined ? body.vendor_tel_fax_snapshot : existing.vendor_tel_fax_snapshot,
          Array.isArray(body.purpose_flags) ? JSON.stringify(body.purpose_flags) : existing.purpose_flags,
          body.requester_name !== undefined ? body.requester_name : existing.requester_name,
          body.reviewer_name !== undefined ? body.reviewer_name : existing.reviewer_name,
          body.approver_name !== undefined ? body.approver_name : existing.approver_name,
          body.purchasing_officer_name !== undefined ? body.purchasing_officer_name : existing.purchasing_officer_name,
          body.purchasing_date !== undefined ? body.purchasing_date : existing.purchasing_date,
          body.accounting_officer_name !== undefined ? body.accounting_officer_name : existing.accounting_officer_name,
          body.accounting_date !== undefined ? body.accounting_date : existing.accounting_date,
          prId
        );

        if (Array.isArray(body.items)) {
          db.prepare('DELETE FROM pr_items WHERE pr_id = ?').run(prId);
          const insertPrItem = db.prepare(`
            INSERT INTO pr_items (
              pr_id, line_no, item_id, item_code_snapshot, item_name_snapshot,
              purpose, required_date, quantity, unit, actual_unit_price, actual_line_total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          body.items.forEach((it, idx) => {
            insertPrItem.run(
              prId,
              idx + 1,
              it.item_id ? Number(it.item_id) : null,
              it.item_code_snapshot || '',
              it.item_name_snapshot || '',
              it.purpose || '',
              it.required_date || '',
              Number(it.quantity || 1),
              it.unit || 'PCS',
              it.actual_unit_price !== undefined && it.actual_unit_price !== null && it.actual_unit_price !== '' ? Number(it.actual_unit_price) : null,
              it.actual_line_total !== undefined && it.actual_line_total !== null && it.actual_line_total !== '' ? Number(it.actual_line_total) : null
            );
          });
        }

        const updated = getAllPrsWithItems().find(p => p.pr_id === prId);
        return sendJson(res, 200, updated);
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM purchase_requisitions WHERE pr_id = ?').run(prId);
        return sendJson(res, 200, { deleted: true });
      }
    }

    // ==========================================
    // 4. WMS INVENTORY & CYCLE COUNT API
    // ==========================================
    if (pathname === '/api/wms/overview' && method === 'GET') {
      const lots = db.prepare(`
        SELECT wl.*,
          i.item_code,
          i.item_name,
          i.image_url,
          c.category_name,
          c.icon_url AS category_icon_url
        FROM wms_lots wl
        JOIN items i ON wl.item_id = i.item_id
        LEFT JOIN item_categories c ON i.category_id = c.category_id
        ORDER BY wl.lot_id DESC
      `).all();

      const transactions = db.prepare(`
        SELECT wt.*,
          i.item_code,
          i.item_name
        FROM wms_transactions wt
        JOIN items i ON wt.item_id = i.item_id
        ORDER BY wt.tx_id DESC
        LIMIT 200
      `).all();

      return sendJson(res, 200, { lots, transactions });
    }

    if (pathname === '/api/wms/inbound' && method === 'POST') {
      const body = await parseBody(req);
      const itemId = Number(body.item_id);
      const qty = Number(body.quantity || 0);
      if (!itemId || qty <= 0) {
        return sendJson(res, 400, { error: 'กรุณาเลือกสินค้าและระบุจำนวนรับเข้าที่มากกว่า 0' });
      }
      const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
      if (!item) return sendJson(res, 404, { error: 'ไม่พบสินค้า' });

      const vendorId = body.vendor_id ? Number(body.vendor_id) : null;
      const vendor = vendorId ? db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(vendorId) : null;
      const vendorName = body.vendor_name_snapshot || (vendor ? vendor.vendor_name : 'ไม่ระบุผู้ขาย');
      const lotNumber = String(body.lot_number || '').trim() || computeNextLotNumber();
      const receivedDate = body.received_date || new Date().toISOString().slice(0, 10);
      const unit = String(body.unit || item.default_unit || 'PCS').trim();
      const unitCost = Number(body.unit_cost || item.last_unit_price || 0);
      const location = String(body.location || 'คลัง Tooling (Main Store)').trim();
      const poNumber = String(body.po_number_snapshot || '').trim();
      const remarks = String(body.remarks || '').trim();
      const actor = String(body.performed_by || 'ฝ่ายจัดซื้อ').trim();

      const info = db.prepare(`
        INSERT INTO wms_lots (
          lot_number, item_id, vendor_id, vendor_name_snapshot, po_number_snapshot,
          received_date, initial_qty, remaining_qty, unit, unit_cost, location, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lotNumber, itemId, vendorId, vendorName, poNumber,
        receivedDate, qty, qty, unit, unitCost, location, remarks, actor
      );
      const lotId = Number(info.lastInsertRowid);

      db.prepare(`
        INSERT INTO wms_transactions (
          tx_type, item_id, lot_id, lot_number_snapshot, vendor_id, vendor_name_snapshot,
          qty_before, qty_change, qty_after, unit, reference_doc, reason, performed_by
        ) VALUES ('INBOUND', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        itemId, lotId, lotNumber, vendorId, vendorName,
        qty, qty, unit, poNumber || lotNumber, remarks || 'รับเข้าสินค้าคงคลังตาม Lot', actor
      );

      return sendJson(res, 201, { lot_id: lotId, lot_number: lotNumber });
    }

    if (pathname === '/api/wms/outbound' && method === 'POST') {
      const body = await parseBody(req);
      const lotId = Number(body.lot_id);
      const qty = Number(body.quantity || 0);
      if (!lotId || qty <= 0) {
        return sendJson(res, 400, { error: 'กรุณาเลือก Lot ที่ต้องการตัดเบิก และระบุจำนวนที่มากกว่า 0' });
      }
      const lot = db.prepare('SELECT * FROM wms_lots WHERE lot_id = ?').get(lotId);
      if (!lot) return sendJson(res, 404, { error: 'ไม่พบข้อมูล Lot สินค้า' });
      if (qty > Number(lot.remaining_qty)) {
        return sendJson(res, 400, { error: `จำนวนที่เบิก (${qty}) มากกว่าจำนวนคงเหลือใน Lot นี้ (${lot.remaining_qty} ${lot.unit})` });
      }

      const before = Number(lot.remaining_qty);
      const after = Math.round((before - qty) * 100) / 100;
      const actor = String(body.performed_by || 'ฝ่ายจัดซื้อ/คลังสินค้า').trim();

      db.prepare('UPDATE wms_lots SET remaining_qty = ? WHERE lot_id = ?').run(after, lotId);
      db.prepare(`
        INSERT INTO wms_transactions (
          tx_type, item_id, lot_id, lot_number_snapshot, vendor_id, vendor_name_snapshot,
          qty_before, qty_change, qty_after, unit, reference_doc, reason, performed_by
        ) VALUES ('OUTBOUND', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lot.item_id, lot.lot_id, lot.lot_number, lot.vendor_id, lot.vendor_name_snapshot,
        before, -qty, after, lot.unit,
        String(body.reference_doc || '').trim(),
        String(body.reason || 'เบิกจ่ายสินค้าออกจากคลัง').trim(),
        actor
      );

      return sendJson(res, 200, { lot_id: lotId, remaining_qty: after });
    }

    if (pathname === '/api/wms/cycle-count' && method === 'POST') {
      const body = await parseBody(req);
      const lotId = body.lot_id ? Number(body.lot_id) : null;
      const itemId = Number(body.item_id);
      const countedQty = Number(body.counted_qty);
      if (isNaN(countedQty) || countedQty < 0) {
        return sendJson(res, 400, { error: 'กรุณาระบุจำนวนที่ตรวจนับจริง (ต้องไม่ติดลบ)' });
      }
      const actor = String(body.performed_by || 'เจ้าหน้าที่ตรวจนับสต็อก').trim();
      const reason = String(body.reason || 'ตรวจนับสต็อกประจำรอบ (Manual Cycle Count)').trim();

      let lot = lotId ? db.prepare('SELECT * FROM wms_lots WHERE lot_id = ?').get(lotId) : null;
      if (!lot) {
        // If item has no lot yet, create an initial cycle count lot
        const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
        if (!item) return sendJson(res, 404, { error: 'ไม่พบสินค้า' });
        const lotNum = computeNextLotNumber() + '-CC';
        const today = new Date().toISOString().slice(0, 10);
        const info = db.prepare(`
          INSERT INTO wms_lots (
            lot_number, item_id, vendor_name_snapshot, received_date,
            initial_qty, remaining_qty, unit, unit_cost, location, remarks, created_by
          ) VALUES (?, ?, 'ปรับยอดจากการตรวจนับ (Cycle Count)', ?, ?, ?, ?, ?, 'คลัง Tooling', ?, ?)
        `).run(lotNum, itemId, today, countedQty, countedQty, item.default_unit || 'PCS', Number(item.last_unit_price || 0), reason, actor);

        const newLotId = Number(info.lastInsertRowid);
        db.prepare(`
          INSERT INTO wms_transactions (
            tx_type, item_id, lot_id, lot_number_snapshot, vendor_name_snapshot,
            qty_before, qty_change, qty_after, unit, reference_doc, reason, performed_by
          ) VALUES ('CYCLE_COUNT', ?, ?, ?, 'Cycle Count Adjustment', 0, ?, ?, ?, 'CYCLE-COUNT', ?, ?)
        `).run(itemId, newLotId, lotNum, countedQty, countedQty, item.default_unit || 'PCS', reason, actor);

        return sendJson(res, 200, { lot_id: newLotId, remaining_qty: countedQty });
      }

      const before = Number(lot.remaining_qty);
      const diff = Math.round((countedQty - before) * 100) / 100;
      db.prepare('UPDATE wms_lots SET remaining_qty = ? WHERE lot_id = ?').run(countedQty, lot.lot_id);

      db.prepare(`
        INSERT INTO wms_transactions (
          tx_type, item_id, lot_id, lot_number_snapshot, vendor_id, vendor_name_snapshot,
          qty_before, qty_change, qty_after, unit, reference_doc, reason, performed_by
        ) VALUES ('CYCLE_COUNT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CYCLE-COUNT', ?, ?)
      `).run(
        lot.item_id, lot.lot_id, lot.lot_number, lot.vendor_id, lot.vendor_name_snapshot,
        before, diff, countedQty, lot.unit, reason, actor
      );

      return sendJson(res, 200, { lot_id: lot.lot_id, qty_before: before, qty_change: diff, remaining_qty: countedQty });
    }

    // ==========================================
    // 5. ITEMS API
    // ==========================================
    if (pathname === '/api/items' && method === 'GET') {
      return sendJson(res, 200, getAllItemsWithDetails());
    }

    if (pathname === '/api/items/next-code' && method === 'GET') {
      const catId = urlObj.searchParams.get('category_id') || 1;
      return sendJson(res, 200, { next_code: computeNextItemCode(catId) });
    }

    if (pathname === '/api/items' && method === 'POST') {
      const body = await parseBody(req);
      const catId = Number(body.category_id || 1);
      const cat = db.prepare('SELECT icon_url, default_unit FROM item_categories WHERE category_id = ?').get(catId);
      const itemCode = (body.item_code || '').trim() || computeNextItemCode(catId);
      const itemName = (body.item_name || '').trim();
      if (!itemName) return sendJson(res, 400, { error: 'กรุณาระบุชื่อสินค้า (Item Name)' });

      const unit = (body.default_unit || (cat && cat.default_unit) || 'PCS').trim();
      const imageUrl = body.image_url || (cat ? cat.icon_url : '');
      const picEngineer = (body.pic_engineer || 'วิศวกร Tooling').trim();
      const lastPrice = body.last_unit_price !== undefined && body.last_unit_price !== '' && body.last_unit_price !== null
        ? Number(body.last_unit_price)
        : null;

      const stmt = db.prepare(`
        INSERT INTO items (item_code, category_id, item_name, default_unit, image_url, pic_engineer, last_unit_price, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `);
      const info = stmt.run(itemCode, catId, itemName, unit, imageUrl, picEngineer, lastPrice);
      const created = getAllItemsWithDetails().find(i => i.item_id === Number(info.lastInsertRowid));
      return sendJson(res, 201, created);
    }

    const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
    if (itemMatch) {
      const itemId = Number(itemMatch[1]);
      if (method === 'PUT') {
        const body = await parseBody(req);
        const existing = db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบข้อมูลสินค้า' });

        const catId = Number(body.category_id || existing.category_id);
        const itemCode = (body.item_code || existing.item_code).trim();
        const itemName = (body.item_name || existing.item_name).trim();
        const unit = (body.default_unit || existing.default_unit || 'PCS').trim();
        const imageUrl = body.image_url !== undefined ? body.image_url : existing.image_url;
        const picEngineer = body.pic_engineer !== undefined ? body.pic_engineer : existing.pic_engineer;
        const lastPrice = body.last_unit_price !== undefined && body.last_unit_price !== '' && body.last_unit_price !== null
          ? Number(body.last_unit_price)
          : existing.last_unit_price;

        db.prepare(`
          UPDATE items
          SET item_code = ?, category_id = ?, item_name = ?, default_unit = ?, image_url = ?, pic_engineer = ?, last_unit_price = ?
          WHERE item_id = ?
        `).run(itemCode, catId, itemName, unit, imageUrl, picEngineer, lastPrice, itemId);

        const updated = getAllItemsWithDetails().find(i => i.item_id === itemId);
        return sendJson(res, 200, updated);
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM items WHERE item_id = ?').run(itemId);
        return sendJson(res, 200, { deleted: true });
      }
    }

    // ==========================================
    // 6. VENDORS API
    // ==========================================
    if (pathname === '/api/vendors' && method === 'GET') {
      return sendJson(res, 200, getAllVendorsWithTags());
    }

    if (pathname === '/api/vendors' && method === 'POST') {
      const body = await parseBody(req);
      const vendorCode = (body.vendor_code || '').trim() || computeNextVendorCode();
      const vendorName = (body.vendor_name || '').trim();
      if (!vendorName) return sendJson(res, 400, { error: 'กรุณาระบุชื่อบริษัทผู้ขาย' });

      const info = db.prepare(`
        INSERT INTO vendors (vendor_code, vendor_name, tax_id, address, tel, fax, mobile, email, contact_name, default_payment_term, description, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        vendorCode,
        vendorName,
        (body.tax_id || '').trim(),
        (body.address || '').trim(),
        (body.tel || '').trim(),
        (body.fax || '').trim(),
        (body.mobile || '').trim(),
        (body.email || '').trim(),
        (body.contact_name || '').trim(),
        (body.default_payment_term || 'CREDIT 30 DAYS').trim(),
        (body.description || '').trim()
      );
      const vid = Number(info.lastInsertRowid);
      const tags = Array.isArray(body.tags) ? body.tags : [];
      for (const tname of tags) {
        const cleanTag = String(tname).trim();
        if (!cleanTag) continue;
        db.prepare('INSERT OR IGNORE INTO vendor_tags (tag_name) VALUES (?)').run(cleanTag);
        const tagRow = db.prepare('SELECT tag_id FROM vendor_tags WHERE tag_name = ?').get(cleanTag);
        if (tagRow) {
          db.prepare('INSERT OR IGNORE INTO vendor_tag_mappings (vendor_id, tag_id) VALUES (?, ?)').run(vid, tagRow.tag_id);
        }
      }
      const created = getAllVendorsWithTags().find(v => v.vendor_id === vid);
      return sendJson(res, 201, created);
    }

    const vendorMatch = pathname.match(/^\/api\/vendors\/(\d+)$/);
    if (vendorMatch) {
      const vendorId = Number(vendorMatch[1]);
      if (method === 'PUT') {
        const body = await parseBody(req);
        const existing = db.prepare('SELECT * FROM vendors WHERE vendor_id = ?').get(vendorId);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบข้อมูลผู้ขาย' });

        db.prepare(`
          UPDATE vendors
          SET vendor_code = ?, vendor_name = ?, tax_id = ?, address = ?, tel = ?, fax = ?, mobile = ?,
              email = ?, contact_name = ?, default_payment_term = ?, description = ?
          WHERE vendor_id = ?
        `).run(
          (body.vendor_code || existing.vendor_code).trim(),
          (body.vendor_name || existing.vendor_name).trim(),
          body.tax_id !== undefined ? String(body.tax_id).trim() : existing.tax_id,
          body.address !== undefined ? String(body.address).trim() : existing.address,
          body.tel !== undefined ? String(body.tel).trim() : existing.tel,
          body.fax !== undefined ? String(body.fax).trim() : existing.fax,
          body.mobile !== undefined ? String(body.mobile).trim() : existing.mobile,
          body.email !== undefined ? String(body.email).trim() : existing.email,
          body.contact_name !== undefined ? String(body.contact_name).trim() : existing.contact_name,
          body.default_payment_term !== undefined ? String(body.default_payment_term).trim() : existing.default_payment_term,
          body.description !== undefined ? String(body.description).trim() : existing.description,
          vendorId
        );

        if (Array.isArray(body.tags)) {
          db.prepare('DELETE FROM vendor_tag_mappings WHERE vendor_id = ?').run(vendorId);
          for (const tname of body.tags) {
            const cleanTag = String(tname).trim();
            if (!cleanTag) continue;
            db.prepare('INSERT OR IGNORE INTO vendor_tags (tag_name) VALUES (?)').run(cleanTag);
            const tagRow = db.prepare('SELECT tag_id FROM vendor_tags WHERE tag_name = ?').get(cleanTag);
            if (tagRow) {
              db.prepare('INSERT OR IGNORE INTO vendor_tag_mappings (vendor_id, tag_id) VALUES (?, ?)').run(vendorId, tagRow.tag_id);
            }
          }
        }
        const updated = getAllVendorsWithTags().find(v => v.vendor_id === vendorId);
        return sendJson(res, 200, updated);
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM vendors WHERE vendor_id = ?').run(vendorId);
        return sendJson(res, 200, { deleted: true });
      }
    }

    // ==========================================
    // 7. PURCHASE ORDERS API (With Two-Way PR Sync)
    // ==========================================
    if (pathname === '/api/pos' && method === 'GET') {
      const pos = db.prepare(`
        SELECT po.*,
          (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id = po.po_id) AS item_count
        FROM purchase_orders po
        ORDER BY po.po_id DESC
      `).all();

      const allPoItems = db.prepare('SELECT * FROM po_items ORDER BY po_id DESC, line_no ASC').all();
      const itemsByPo = new Map();
      for (const pi of allPoItems) {
        if (!itemsByPo.has(pi.po_id)) itemsByPo.set(pi.po_id, []);
        itemsByPo.get(pi.po_id).push(pi);
      }

      return sendJson(res, 200, pos.map(p => ({
        ...p,
        items: itemsByPo.get(p.po_id) || []
      })));
    }

    if (pathname === '/api/pos' && method === 'POST') {
      const body = await parseBody(req);
      const poNumber = (body.po_number || '').trim() || computeNextPoNumber();
      const poDate = body.po_date || new Date().toISOString().slice(0, 10);
      const vendorId = body.vendor_id ? Number(body.vendor_id) : null;
      const status = body.approval_status || 'PENDING';
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        return sendJson(res, 400, { error: 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ' });
      }

      if (body.update_vendor_master && vendorId) {
        db.prepare(`
          UPDATE vendors
          SET address = ?, tel = ?, fax = ?, contact_name = ?, email = ?, default_payment_term = ?
          WHERE vendor_id = ?
        `).run(
          body.vendor_address_snapshot || '',
          body.vendor_tel_snapshot || '',
          body.vendor_fax_snapshot || '',
          body.vendor_contact_name || '',
          body.vendor_contact_email || '',
          body.payment_term || 'CREDIT 30 DAYS',
          vendorId
        );
      }

      const info = db.prepare(`
        INSERT INTO purchase_orders (
          po_number, po_date, vendor_id, vendor_code_snapshot, vendor_name_snapshot,
          vendor_address_snapshot, vendor_tel_snapshot, vendor_fax_snapshot,
          vendor_contact_name, vendor_contact_email, pr_id, pr_number,
          pr_requester_snapshot, pr_department_snapshot, quotation_ref,
          delivery_location, delivery_contact, delivery_date, payment_term,
          sub_total, special_discount, net_total, vat_rate, vat_amount, grand_total,
          amount_text_th, remarks, approval_status, issued_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        poNumber,
        poDate,
        vendorId,
        body.vendor_code_snapshot || '',
        body.vendor_name_snapshot || '',
        body.vendor_address_snapshot || '',
        body.vendor_tel_snapshot || '',
        body.vendor_fax_snapshot || '',
        body.vendor_contact_name || '',
        body.vendor_contact_email || '',
        body.pr_id ? Number(body.pr_id) : null,
        body.pr_number || '',
        body.pr_requester_snapshot || '',
        body.pr_department_snapshot || '',
        body.quotation_ref || '',
        body.delivery_location || 'โรงงาน ซอย 12',
        body.delivery_contact || 'จัดซื้อ 094-479-2417',
        body.delivery_date || '',
        body.payment_term || 'CREDIT 30 DAYS',
        Number(body.sub_total || 0),
        Number(body.special_discount || 0),
        Number(body.net_total || 0),
        Number(body.vat_rate !== undefined ? body.vat_rate : 7),
        Number(body.vat_amount || 0),
        Number(body.grand_total || 0),
        body.amount_text_th || '',
        body.remarks || '',
        status,
        body.issued_by || 'เจ้าหน้าที่จัดซื้อ'
      );

      const poId = Number(info.lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO po_items (
          po_id, line_no, item_id, item_code_snapshot, item_name_snapshot, item_image_snapshot,
          quantity, unit, unit_price, line_discount, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      items.forEach((it, idx) => {
        insertItem.run(
          poId,
          idx + 1,
          it.item_id ? Number(it.item_id) : null,
          it.item_code_snapshot || '',
          it.item_name_snapshot || '',
          it.item_image_snapshot || '',
          Number(it.quantity || 1),
          it.unit || 'PCS',
          Number(it.unit_price || 0),
          Number(it.line_discount || 0),
          Number(it.line_total || 0)
        );
      });

      // Automatically sync PO No. and actual prices back into linked PR!
      syncPoToPr(poId);

      db.prepare(`
        INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment)
        VALUES (?, ?, 'PURCHASING', ?, ?)
      `).run(
        poId,
        body.issued_by || 'เจ้าหน้าที่จัดซื้อ',
        status === 'DRAFT' ? 'CREATED' : 'SUBMITTED',
        status === 'DRAFT' ? 'บันทึกใบสั่งซื้อฉบับร่าง' : `ยื่นขออนุมัติใบสั่งซื้อ ${poNumber}`
      );

      const createdPo = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(poId);
      const createdItems = db.prepare('SELECT * FROM po_items WHERE po_id = ? ORDER BY line_no ASC').all(poId);
      const createdLogs = db.prepare('SELECT * FROM po_approval_logs WHERE po_id = ? ORDER BY log_id ASC').all(poId);
      return sendJson(res, 201, { ...createdPo, items: createdItems, logs: createdLogs });
    }

    const poDetailMatch = pathname.match(/^\/api\/pos\/(\d+)$/);
    if (poDetailMatch) {
      const poId = Number(poDetailMatch[1]);
      if (method === 'GET') {
        const po = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(poId);
        if (!po) return sendJson(res, 404, { error: 'ไม่พบใบสั่งซื้อ' });
        const items = db.prepare('SELECT * FROM po_items WHERE po_id = ? ORDER BY line_no ASC').all(poId);
        const logs = db.prepare('SELECT * FROM po_approval_logs WHERE po_id = ? ORDER BY log_id ASC').all(poId);
        return sendJson(res, 200, { ...po, items, logs });
      }

      if (method === 'PUT') {
        const body = await parseBody(req);
        const existing = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(poId);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบใบสั่งซื้อ' });

        const vendorId = body.vendor_id ? Number(body.vendor_id) : existing.vendor_id;
        const status = body.approval_status || existing.approval_status;

        if (body.update_vendor_master && vendorId) {
          db.prepare(`
            UPDATE vendors
            SET address = ?, tel = ?, fax = ?, contact_name = ?, email = ?, default_payment_term = ?
            WHERE vendor_id = ?
          `).run(
            body.vendor_address_snapshot || '',
            body.vendor_tel_snapshot || '',
            body.vendor_fax_snapshot || '',
            body.vendor_contact_name || '',
            body.vendor_contact_email || '',
            body.payment_term || 'CREDIT 30 DAYS',
            vendorId
          );
        }

        db.prepare(`
          UPDATE purchase_orders
          SET po_number = ?, po_date = ?, vendor_id = ?, vendor_code_snapshot = ?, vendor_name_snapshot = ?,
              vendor_address_snapshot = ?, vendor_tel_snapshot = ?, vendor_fax_snapshot = ?,
              vendor_contact_name = ?, vendor_contact_email = ?, pr_id = ?, pr_number = ?,
              pr_requester_snapshot = ?, pr_department_snapshot = ?, quotation_ref = ?,
              delivery_location = ?, delivery_contact = ?, delivery_date = ?, payment_term = ?,
              sub_total = ?, special_discount = ?, net_total = ?, vat_rate = ?, vat_amount = ?, grand_total = ?,
              amount_text_th = ?, remarks = ?, approval_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE po_id = ?
        `).run(
          (body.po_number || existing.po_number).trim(),
          body.po_date || existing.po_date,
          vendorId,
          body.vendor_code_snapshot !== undefined ? body.vendor_code_snapshot : existing.vendor_code_snapshot,
          body.vendor_name_snapshot !== undefined ? body.vendor_name_snapshot : existing.vendor_name_snapshot,
          body.vendor_address_snapshot !== undefined ? body.vendor_address_snapshot : existing.vendor_address_snapshot,
          body.vendor_tel_snapshot !== undefined ? body.vendor_tel_snapshot : existing.vendor_tel_snapshot,
          body.vendor_fax_snapshot !== undefined ? body.vendor_fax_snapshot : existing.vendor_fax_snapshot,
          body.vendor_contact_name !== undefined ? body.vendor_contact_name : existing.vendor_contact_name,
          body.vendor_contact_email !== undefined ? body.vendor_contact_email : existing.vendor_contact_email,
          body.pr_id !== undefined ? (body.pr_id ? Number(body.pr_id) : null) : existing.pr_id,
          body.pr_number !== undefined ? body.pr_number : existing.pr_number,
          body.pr_requester_snapshot !== undefined ? body.pr_requester_snapshot : existing.pr_requester_snapshot,
          body.pr_department_snapshot !== undefined ? body.pr_department_snapshot : existing.pr_department_snapshot,
          body.quotation_ref !== undefined ? body.quotation_ref : existing.quotation_ref,
          body.delivery_location !== undefined ? body.delivery_location : existing.delivery_location,
          body.delivery_contact !== undefined ? body.delivery_contact : existing.delivery_contact,
          body.delivery_date !== undefined ? body.delivery_date : existing.delivery_date,
          body.payment_term !== undefined ? body.payment_term : existing.payment_term,
          Number(body.sub_total !== undefined ? body.sub_total : existing.sub_total),
          Number(body.special_discount !== undefined ? body.special_discount : existing.special_discount),
          Number(body.net_total !== undefined ? body.net_total : existing.net_total),
          Number(body.vat_rate !== undefined ? body.vat_rate : existing.vat_rate),
          Number(body.vat_amount !== undefined ? body.vat_amount : existing.vat_amount),
          Number(body.grand_total !== undefined ? body.grand_total : existing.grand_total),
          body.amount_text_th !== undefined ? body.amount_text_th : existing.amount_text_th,
          body.remarks !== undefined ? body.remarks : existing.remarks,
          status,
          poId
        );

        if (Array.isArray(body.items)) {
          db.prepare('DELETE FROM po_items WHERE po_id = ?').run(poId);
          const insertItem = db.prepare(`
            INSERT INTO po_items (
              po_id, line_no, item_id, item_code_snapshot, item_name_snapshot, item_image_snapshot,
              quantity, unit, unit_price, line_discount, line_total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          body.items.forEach((it, idx) => {
            insertItem.run(
              poId,
              idx + 1,
              it.item_id ? Number(it.item_id) : null,
              it.item_code_snapshot || '',
              it.item_name_snapshot || '',
              it.item_image_snapshot || '',
              Number(it.quantity || 1),
              it.unit || 'PCS',
              Number(it.unit_price || 0),
              Number(it.line_discount || 0),
              Number(it.line_total || 0)
            );
          });
        }

        syncPoToPr(poId);

        db.prepare(`
          INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment)
          VALUES (?, ?, 'PURCHASING', 'REVISED', ?)
        `).run(poId, body.issued_by || 'เจ้าหน้าที่จัดซื้อ', 'แก้ไขข้อมูลใบสั่งซื้อและส่งอนุมัติ');

        refreshItemLastPrices();
        const updatedPo = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(poId);
        const updatedItems = db.prepare('SELECT * FROM po_items WHERE po_id = ? ORDER BY line_no ASC').all(poId);
        const updatedLogs = db.prepare('SELECT * FROM po_approval_logs WHERE po_id = ? ORDER BY log_id ASC').all(poId);
        return sendJson(res, 200, { ...updatedPo, items: updatedItems, logs: updatedLogs });
      }

      if (method === 'DELETE') {
        db.prepare('UPDATE purchase_requisitions SET linked_po_id = NULL, linked_po_number = "", status = "OPEN" WHERE linked_po_id = ?').run(poId);
        db.prepare('DELETE FROM purchase_orders WHERE po_id = ?').run(poId);
        refreshItemLastPrices();
        return sendJson(res, 200, { deleted: true });
      }
    }

    const poApproveMatch = pathname.match(/^\/api\/pos\/(\d+)\/(approve|reject)$/);
    if (poApproveMatch && method === 'POST') {
      const poId = Number(poApproveMatch[1]);
      const actionType = poApproveMatch[2];
      const body = await parseBody(req);
      const po = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(poId);
      if (!po) return sendJson(res, 404, { error: 'ไม่พบใบสั่งซื้อ' });

      const settings = db.prepare('SELECT authorized_signer_name, signature_image FROM document_settings WHERE id = 1').get();
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const approverName = body.approver_name || (settings && settings.authorized_signer_name) || 'ผู้มีอำนาจลงนาม';

      if (actionType === 'approve') {
        const sigSnapshot = body.signature_image || (settings && settings.signature_image) || '';
        db.prepare(`
          UPDATE purchase_orders
          SET approval_status = 'APPROVED',
              approved_by = ?,
              approved_at = ?,
              approver_signature_snapshot = ?,
              reject_reason = '',
              updated_at = CURRENT_TIMESTAMP
          WHERE po_id = ?
        `).run(approverName, nowStr, sigSnapshot, poId);

        db.prepare(`
          INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp)
          VALUES (?, ?, 'APPROVER', 'APPROVED', ?, ?)
        `).run(poId, approverName, body.comment || 'ลงนามอนุมัติใบสั่งซื้อเรียบร้อยแล้ว', nowStr);

        syncPoToPr(poId);
        refreshItemLastPrices();
      } else {
        const reason = body.comment || 'ตีกลับเพื่อตรวจสอบราคาหรือรายละเอียดเพิ่มเติม';
        db.prepare(`
          UPDATE purchase_orders
          SET approval_status = 'REJECTED',
              reject_reason = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE po_id = ?
        `).run(reason, poId);

        db.prepare(`
          INSERT INTO po_approval_logs (po_id, actor_name, actor_role, action, comment, action_timestamp)
          VALUES (?, ?, 'APPROVER', 'REJECTED', ?, ?)
        `).run(poId, approverName, reason, nowStr);

        refreshItemLastPrices();
      }

      const updatedPo = db.prepare('SELECT * FROM purchase_orders WHERE po_id = ?').get(poId);
      const updatedItems = db.prepare('SELECT * FROM po_items WHERE po_id = ? ORDER BY line_no ASC').all(poId);
      const updatedLogs = db.prepare('SELECT * FROM po_approval_logs WHERE po_id = ? ORDER BY log_id ASC').all(poId);
      return sendJson(res, 200, { ...updatedPo, items: updatedItems, logs: updatedLogs });
    }

    // ==========================================
    // 8. PRICE HISTORY & DOCUMENT SETTINGS API
    // ==========================================
    if (pathname === '/api/price-history' && method === 'GET') {
      const itemIdParam = urlObj.searchParams.get('item_id');
      let whereClause = `WHERE po.approval_status = 'APPROVED'`;
      const params = [];
      if (itemIdParam) {
        whereClause += ` AND pi.item_id = ?`;
        params.push(Number(itemIdParam));
      }

      const history = db.prepare(`
        SELECT
          pi.po_item_id,
          pi.po_id,
          po.po_number,
          po.po_date,
          po.approved_at,
          po.vendor_id,
          po.vendor_code_snapshot,
          po.vendor_name_snapshot,
          po.payment_term,
          po.quotation_ref,
          pi.item_id,
          pi.item_code_snapshot,
          pi.item_name_snapshot,
          pi.item_image_snapshot,
          pi.quantity,
          pi.unit,
          pi.unit_price,
          pi.line_discount,
          pi.line_total
        FROM po_items pi
        JOIN purchase_orders po ON pi.po_id = po.po_id
        ${whereClause}
        ORDER BY po.po_date ASC, po.po_id ASC
      `).all(...params);

      return sendJson(res, 200, history);
    }

    if (pathname === '/api/settings' && method === 'GET') {
      const settings = db.prepare('SELECT * FROM document_settings WHERE id = 1').get();
      return sendJson(res, 200, settings);
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      const body = await parseBody(req);
      const existing = db.prepare('SELECT * FROM document_settings WHERE id = 1').get();

      db.prepare(`
        UPDATE document_settings
        SET company_logo = ?,
            company_name = ?,
            company_address = ?,
            company_tel = ?,
            company_fax = ?,
            company_tax_id = ?,
            authorized_signer_name = ?,
            signature_image = ?,
            confirm_box_line1 = ?,
            confirm_box_line2 = ?,
            confirm_sign_label = ?,
            confirm_date_label = ?,
            default_remarks = ?,
            effective_date = ?,
            form_code = ?,
            po_number_prefix = ?,
            po_number_separator = ?,
            default_delivery_location = ?,
            default_delivery_contact = ?,
            default_vat_rate = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run(
        body.company_logo !== undefined ? body.company_logo : existing.company_logo,
        body.company_name !== undefined ? body.company_name : existing.company_name,
        body.company_address !== undefined ? body.company_address : existing.company_address,
        body.company_tel !== undefined ? body.company_tel : existing.company_tel,
        body.company_fax !== undefined ? body.company_fax : existing.company_fax,
        body.company_tax_id !== undefined ? body.company_tax_id : existing.company_tax_id,
        body.authorized_signer_name !== undefined ? body.authorized_signer_name : existing.authorized_signer_name,
        body.signature_image !== undefined ? body.signature_image : existing.signature_image,
        body.confirm_box_line1 !== undefined ? body.confirm_box_line1 : existing.confirm_box_line1,
        body.confirm_box_line2 !== undefined ? body.confirm_box_line2 : existing.confirm_box_line2,
        body.confirm_sign_label !== undefined ? body.confirm_sign_label : existing.confirm_sign_label,
        body.confirm_date_label !== undefined ? body.confirm_date_label : existing.confirm_date_label,
        body.default_remarks !== undefined ? body.default_remarks : existing.default_remarks,
        body.effective_date !== undefined ? body.effective_date : existing.effective_date,
        body.form_code !== undefined ? body.form_code : existing.form_code,
        body.po_number_prefix !== undefined ? body.po_number_prefix : existing.po_number_prefix,
        body.po_number_separator !== undefined ? body.po_number_separator : existing.po_number_separator,
        body.default_delivery_location !== undefined ? body.default_delivery_location : existing.default_delivery_location,
        body.default_delivery_contact !== undefined ? body.default_delivery_contact : existing.default_delivery_contact,
        Number(body.default_vat_rate !== undefined ? body.default_vat_rate : existing.default_vat_rate)
      );

      const updated = db.prepare('SELECT * FROM document_settings WHERE id = 1').get();
      return sendJson(res, 200, updated);
    }

    if (pathname === '/api/settings/reset-logo' && method === 'POST') {
      const logoFile = path.join(__dirname, 'extracted_logo.png');
      let logoB64 = '';
      if (fs.existsSync(logoFile)) {
        logoB64 = 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64');
      }
      db.prepare('UPDATE document_settings SET company_logo = ? WHERE id = 1').run(logoB64);
      const updated = db.prepare('SELECT * FROM document_settings WHERE id = 1').get();
      return sendJson(res, 200, updated);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: `API endpoint not found: ${pathname}` });
    }

    // Static Files
    let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }

    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexHtml).pipe(res);
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    await sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
};

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`NES-PO Management Web App running at http://localhost:${PORT}`);
    if (HAS_SUPABASE) {
      console.log(`Supabase Cloud Sync enabled (${SUPABASE_URL})`);
    }
  });
}

module.exports = requestHandler;
