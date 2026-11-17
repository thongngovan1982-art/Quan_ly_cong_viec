/*
 * Team Tracker — máy chủ đăng nhập + dữ liệu dùng chung cho cả team.
 * Không cần cài thư viện: chỉ cần Node.js 18+ rồi chạy `node server.js`.
 *
 * Biến môi trường (tùy chọn):
 *   PORT=3000              cổng chạy web
 *   MAX_USERS=20           số tài khoản tối đa (không tính tài khoản bị khóa)
 *   ADMIN_PASSWORD=...     mật khẩu admin lần đầu (nếu bỏ trống sẽ tự sinh và in ra màn hình)
 *   COOKIE_SECURE=1        bật khi chạy sau HTTPS (khuyến nghị khi đưa lên mạng)
 *   TZ_APP=Asia/Ho_Chi_Minh múi giờ dùng để tính "hôm nay", trễ hạn
 *   SESSION_HOURS=12       thời gian giữ đăng nhập
 *   FRAME_ANCESTORS='self' cho phép nhúng trang (VD: 'self' https://congty.sharepoint.com)
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 3000;
const MAX_USERS = +process.env.MAX_USERS || 20;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC = path.join(__dirname, "public");
const SECURE_COOKIE = process.env.COOKIE_SECURE === "1";
const SESSION_MS = (+process.env.SESSION_HOURS || 12) * 3600e3;
const TZ = process.env.TZ_APP || "Asia/Ho_Chi_Minh";
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS || "'self'";
const POINTS = { done: 20, late: 10, spinCost: 20 };
const DEFAULT_REWARDS = [
  { id: "thanks", icon: "💌", name: "Thanks note", cost: 20 },
  { id: "sugarcane", icon: "🥤", name: "Nước mía", cost: 30 },
  { id: "coffee", icon: "☕", name: "Cà phê", cost: 40 },
  { id: "cake", icon: "🍰", name: "Bánh ngọt", cost: 50 },
  { id: "milktea", icon: "🧋", name: "Trà sữa", cost: 60 }
];

/* ============ LƯU TRỮ (file JSON, ghi an toàn) ============ */
fs.mkdirSync(DATA_DIR, { recursive: true });
function emptyDb() {
  return { users: [], tasks: [], bonus: [], redeem: [], spins: [], sessions: {}, audit: [],
    settings: { title: "Kế hoạch Phòng Nhân sự", rewards: DEFAULT_REWARDS } };
}
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { db = emptyDb(); }
for (const k of Object.keys(emptyDb())) if (db[k] === undefined) db[k] = emptyDb()[k];
function save() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
const uid = (p) => p + crypto.randomBytes(6).toString("hex");
const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function audit(user, action, detail) {
  db.audit.push({ t: new Date().toISOString(), by: user ? user.username : "-", action, detail });
  if (db.audit.length > 3000) db.audit = db.audit.slice(-3000);
}

/* ============ MẬT KHẨU ============ */
function hashPw(pw, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") };
}
function checkPw(pw, u) {
  const h = crypto.scryptSync(String(pw), u.salt, 64);
  const ref = Buffer.from(u.hash, "hex");
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
function genPw() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const b = crypto.randomBytes(10);
  for (const x of b) s += A[x % A.length];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + crypto.randomInt(10, 99);
}
const pwProblem = (pw) => (typeof pw !== "string" || pw.length < 8) ? "Mật khẩu cần ít nhất 8 ký tự"
  : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? "Mật khẩu cần có cả chữ và số" : pw.length > 128 ? "Mật khẩu quá dài" : null;

/* tạo admin đầu tiên */
if (!db.users.length) {
  const pw = process.env.ADMIN_PASSWORD || genPw();
  db.users.push({ id: uid("u"), username: "admin", name: "Quản trị viên", title: "Admin", avatar: "🛡️",
    role: "admin", active: true, inTeam: false, mustChange: true, createdAt: new Date().toISOString(), ...hashPw(pw) });
  save();
  console.log("\n==============================================");
  console.log(" Tài khoản quản trị đầu tiên đã được tạo:");
  console.log("   Tên đăng nhập : admin");
  console.log("   Mật khẩu tạm  : " + pw);
  console.log(" Đăng nhập xong sẽ được yêu cầu đổi mật khẩu.");
  console.log("==============================================\n");
}

/* ============ PHIÊN ĐĂNG NHẬP ============ */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function cookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || "").split(";")) {
    const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, value, maxAgeSec) {
  res.setHeader("Set-Cookie", `tt_sid=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${SECURE_COOKIE ? "; Secure" : ""}`);
}
function currentUser(req) {
  const tok = cookies(req).tt_sid; if (!tok) return null;
  const s = db.sessions[sha(tok)]; if (!s) return null;
  if (s.exp < Date.now()) { delete db.sessions[sha(tok)]; return null; }
  const u = db.users.find((x) => x.id === s.uid);
  return u && u.active ? u : null;
}
function dropSessionsOf(userId) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.uid === userId) delete db.sessions[k];
}
setInterval(() => { const now = Date.now(); let c = false;
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) { delete db.sessions[k]; c = true; }
  if (c) save(); }, 3600e3).unref();

/* chống dò mật khẩu: 5 lần sai → khóa 15 phút theo (IP + tên đăng nhập) */
const fails = new Map();
const failKey = (req, u) => (req.socket.remoteAddress || "") + "|" + String(u || "").toLowerCase();

/* ============ HTTP TIỆN ÍCH ============ */
function headers(res, type) {
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors ${FRAME_ANCESTORS}; base-uri 'none'; form-action 'self'`);
}
function send(res, code, obj) { headers(res, "application/json; charset=utf-8"); res.statusCode = code; res.end(JSON.stringify(obj)); }
function page(res, file) {
  headers(res, "text/html; charset=utf-8");
  fs.createReadStream(path.join(PUBLIC, file)).on("error", () => { res.statusCode = 404; res.end("Không tìm thấy"); }).pipe(res);
}
function redirect(res, to) { res.statusCode = 302; res.setHeader("Location", to); res.end(); }
function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > 100e3) { reject(Object.assign(new Error("too big"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("bad json"), { code: 400 })); } });
    req.on("error", reject);
  });
}
const str = (v, max = 120) => String(v ?? "").trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, title: u.title, avatar: u.avatar, role: u.role,
  active: u.active, inTeam: u.inTeam !== false, mustChange: !!u.mustChange, createdAt: u.createdAt, lastLogin: u.lastLogin || null });
const activeCount = () => db.users.filter((u) => u.active).length;

/* ============ ĐIỂM ============ */
function isLate(t, today) { return t.status === "done" ? !!(t.doneDate && t.doneDate > t.due) : t.due < today; }
function balance(memberId) {
  const today = todayISO();
  const earn = db.tasks.filter((t) => t.owner === memberId)
    .reduce((s, t) => s + (t.status === "done" ? POINTS.done : 0) - (isLate(t, today) ? POINTS.late : 0), 0);
  const bonus = db.bonus.filter((b) => b.member === memberId).reduce((s, b) => s + b.pts, 0);
  const used = db.redeem.filter((r) => r.member === memberId).reduce((s, r) => s + r.cost, 0)
    + db.spins.filter((x) => x.member === memberId).length * POINTS.spinCost;
  return earn + bonus - used;
}

/* ============ ĐỊNH TUYẾN ============ */
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname, m = req.method;
  const me = currentUser(req);

  /* ---- trang ---- */
  if (m === "GET" && p === "/login") return page(res, "login.html");
  if (m === "GET" && (p === "/" || p === "/index.html")) {
    if (!me) return redirect(res, "/login");
    if (me.mustChange) return redirect(res, "/login?change=1");
    return page(res, "app.html");
  }
  if (m === "GET" && p === "/favicon.ico") { res.statusCode = 204; return res.end(); }
  if (!p.startsWith("/api/")) { res.statusCode = 404; return res.end("Không tìm thấy"); }

  /* ---- chống CSRF: mọi yêu cầu thay đổi phải có header riêng ---- */
  if (m !== "GET" && req.headers["x-requested-with"] !== "team-tracker") return send(res, 403, { error: "Yêu cầu không hợp lệ" });

  /* ---- đăng nhập ---- */
  if (m === "POST" && p === "/api/login") {
    const b = await body(req); const key = failKey(req, b.username); const f = fails.get(key);
    if (f && f.until > Date.now()) return send(res, 429, { error: `Sai quá nhiều lần. Thử lại sau ${Math.ceil((f.until - Date.now()) / 60000)} phút.` });
    const u = db.users.find((x) => x.username.toLowerCase() === str(b.username, 40).toLowerCase());
    const ok = u && checkPw(b.password || "", u);
    if (!ok || !u.active) {
      const n = (f && f.until > Date.now() ? 0 : (f ? f.n : 0)) + 1;
      fails.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60e3 : 0 });
      if (u && ok && !u.active) return send(res, 403, { error: "Tài khoản đã bị khóa. Liên hệ quản trị viên." });
      return send(res, 401, { error: "Sai tên đăng nhập hoặc mật khẩu" + (n >= 3 && n < 5 ? ` (còn ${5 - n} lần thử)` : "") });
    }
    fails.delete(key);
    const tok = crypto.randomBytes(32).toString("hex");
    db.sessions[sha(tok)] = { uid: u.id, exp: Date.now() + SESSION_MS };
    u.lastLogin = new Date().toISOString(); audit(u, "login", ""); save();
    setCookie(res, tok, SESSION_MS / 1000);
    return send(res, 200, { ok: true, mustChange: !!u.mustChange, name: u.name });
  }
  if (m === "POST" && p === "/api/logout") {
    const tok = cookies(req).tt_sid; if (tok) { delete db.sessions[sha(tok)]; save(); }
    setCookie(res, "", 0); return send(res, 200, { ok: true });
  }

  /* ---- từ đây trở đi phải đăng nhập ---- */
  if (!me) return send(res, 401, { error: "Phiên đăng nhập đã hết, vui lòng đăng nhập lại" });

  if (m === "GET" && p === "/api/me") return send(res, 200, publicUser(me));
  if (m === "POST" && p === "/api/password") {
    const b = await body(req);
    if (!checkPw(b.current || "", me)) return send(res, 400, { error: "Mật khẩu hiện tại chưa đúng" });
    const prob = pwProblem(b.next); if (prob) return send(res, 400, { error: prob });
    if (b.next === b.current) return send(res, 400, { error: "Mật khẩu mới phải khác mật khẩu cũ" });
    Object.assign(me, hashPw(b.next), { mustChange: false });
    const tok = cookies(req).tt_sid;
    for (const [k, s] of Object.entries(db.sessions)) if (s.uid === me.id && k !== sha(tok)) delete db.sessions[k];
    audit(me, "change-password", ""); save();
    return send(res, 200, { ok: true });
  }
  if (me.mustChange) return send(res, 403, { error: "Vui lòng đổi mật khẩu trước", mustChange: true });

  const isAdmin = me.role === "admin";
  const adminOnly = () => send(res, 403, { error: "Chỉ quản trị viên được làm việc này" });

  /* ---- dữ liệu chung ---- */
  if (m === "GET" && p === "/api/state") {
    const spent = {};
    for (const x of db.spins) spent[x.member] = (spent[x.member] || 0) + POINTS.spinCost;
    return send(res, 200, {
      me: publicUser(me), today: todayISO(), points: POINTS, settings: db.settings,
      members: db.users.filter((u) => u.active && u.inTeam !== false).map((u) => ({ id: u.id, name: u.name, role: u.title, avatar: u.avatar })),
      tasks: db.tasks, bonus: db.bonus, redeem: db.redeem, spent
    });
  }

  /* ---- công việc ---- */
  const canTouch = (t) => isAdmin || t.owner === me.id;
  if (m === "POST" && p === "/api/tasks") {
    const b = await body(req);
    const t = { id: uid("t"), title: str(b.title), owner: str(b.owner, 40), priority: ["high", "medium", "low"].includes(b.priority) ? b.priority : "medium",
      start: isDate(b.start) ? b.start : todayISO(), due: b.due, status: b.status === "doing" ? "doing" : "todo", progress: b.status === "doing" ? 10 : 0,
      kpi: str(b.kpi), output: str(b.output), createdBy: me.id, createdAt: todayISO() };
    if (!t.title) return send(res, 400, { error: "Thiếu tên công việc" });
    if (!isDate(t.due) || t.due < t.start) return send(res, 400, { error: "Hạn hoàn thành không hợp lệ" });
    if (!db.users.some((u) => u.id === t.owner && u.active)) return send(res, 400, { error: "Người phụ trách không hợp lệ" });
    if (!isAdmin && t.owner !== me.id) return send(res, 403, { error: "Bạn chỉ thêm được việc cho chính mình" });
    db.tasks.push(t); audit(me, "task-add", t.title); save();
    return send(res, 200, t);
  }
  let mm;
  if ((mm = p.match(/^\/api\/tasks\/([\w-]+)$/))) {
    const t = db.tasks.find((x) => x.id === mm[1]);
    if (!t) return send(res, 404, { error: "Không tìm thấy công việc" });
    if (!canTouch(t)) return send(res, 403, { error: "Bạn chỉ cập nhật được việc của mình" });
    if (m === "PATCH") {
      const b = await body(req);
      if (b.status !== undefined) { if (!["todo", "doing", "done"].includes(b.status)) return send(res, 400, { error: "Trạng thái không hợp lệ" }); t.status = b.status; }
      if (b.progress !== undefined) t.progress = Math.max(0, Math.min(100, Math.round(+b.progress || 0)));
      if (t.status === "done") { t.progress = 100; t.doneDate = t.doneDate || todayISO(); } else t.doneDate = null;
      if (isAdmin) {
        if (b.title !== undefined && str(b.title)) t.title = str(b.title);
        if (b.due !== undefined && isDate(b.due)) t.due = b.due;
        if (b.kpi !== undefined) t.kpi = str(b.kpi);
      }
      audit(me, "task-update", `${t.title} → ${t.status} ${t.progress}%`); save();
      return send(res, 200, t);
    }
    if (m === "DELETE") {
      if (!isAdmin && t.createdBy !== me.id) return send(res, 403, { error: "Chỉ người tạo hoặc quản trị viên được xóa" });
      db.tasks = db.tasks.filter((x) => x !== t); audit(me, "task-delete", t.title); save();
      return send(res, 200, { ok: true });
    }
  }

  /* ---- thưởng điểm (admin) ---- */
  if (m === "POST" && p === "/api/bonus") {
    if (!isAdmin) return adminOnly();
    const b = await body(req); const pts = Math.round(+b.pts);
    if (!(pts >= 1 && pts <= 500)) return send(res, 400, { error: "Điểm thưởng từ 1 đến 500" });
    if (!str(b.reason)) return send(res, 400, { error: "Cần ghi lý do khen" });
    if (!db.users.some((u) => u.id === b.member)) return send(res, 400, { error: "Nhân viên không hợp lệ" });
    const x = { id: uid("b"), member: b.member, pts, reason: str(b.reason), date: todayISO(), by: me.id };
    db.bonus.push(x); audit(me, "bonus", `${b.member} +${pts}`); save();
    return send(res, 200, x);
  }
  if ((mm = p.match(/^\/api\/bonus\/([\w-]+)$/)) && m === "DELETE") {
    if (!isAdmin) return adminOnly();
    db.bonus = db.bonus.filter((x) => x.id !== mm[1]); audit(me, "bonus-revoke", mm[1]); save();
    return send(res, 200, { ok: true });
  }

  /* ---- đổi quà ---- */
  if (m === "POST" && p === "/api/redeem") {
    const b = await body(req); const member = isAdmin && b.member ? b.member : me.id;
    const r = (db.settings.rewards || []).find((x) => x.id === b.rewardId);
    if (!r) return send(res, 400, { error: "Quà không hợp lệ" });
    if (balance(member) < r.cost) return send(res, 400, { error: "Chưa đủ điểm để đổi quà này" });
    const x = { id: uid("r"), member, rid: r.id, name: r.name, icon: r.icon, cost: r.cost, date: todayISO(), given: false };
    db.redeem.push(x); audit(me, "redeem", `${member} ${r.name}`); save();
    return send(res, 200, x);
  }
  if ((mm = p.match(/^\/api\/redeem\/([\w-]+)$/)) && m === "PATCH") {
    const x = db.redeem.find((r) => r.id === mm[1]); if (!x) return send(res, 404, { error: "Không tìm thấy" });
    const b = await body(req);
    if (b.action === "give") { if (!isAdmin) return adminOnly(); x.given = true; x.givenDate = todayISO(); }
    else if (b.action === "cancel") {
      if (!isAdmin && (x.member !== me.id || x.given)) return send(res, 403, { error: "Không thể hủy" });
      db.redeem = db.redeem.filter((r) => r !== x);
    } else return send(res, 400, { error: "Thao tác không hợp lệ" });
    audit(me, "redeem-" + b.action, x.name); save();
    return send(res, 200, { ok: true });
  }

  /* ---- quay may mắn ---- */
  if (m === "POST" && p === "/api/spin") {
    const b = await body(req); const member = isAdmin && b.member ? b.member : me.id;
    if (!isAdmin && b.member && b.member !== me.id) return send(res, 403, { error: "Bạn chỉ quay bằng điểm của mình" });
    if (balance(member) < POINTS.spinCost) return send(res, 400, { error: "Chưa đủ điểm để quay" });
    db.spins.push({ id: uid("s"), member, date: todayISO() }); save();
    return send(res, 200, { ok: true });
  }

  /* ---- cài đặt (admin) ---- */
  if (m === "PATCH" && p === "/api/settings") {
    if (!isAdmin) return adminOnly();
    const b = await body(req);
    if (b.title !== undefined && str(b.title)) db.settings.title = str(b.title);
    if (Array.isArray(b.rewards)) db.settings.rewards = b.rewards.slice(0, 20).map((r) => ({ id: str(r.id, 30) || uid("w"), icon: str(r.icon, 8), name: str(r.name, 40), cost: Math.max(1, Math.round(+r.cost || 1)) }));
    audit(me, "settings", ""); save();
    return send(res, 200, db.settings);
  }

  /* ---- quản lý người dùng (admin) ---- */
  if (p === "/api/users" || p.startsWith("/api/users/")) {
    if (!isAdmin) return adminOnly();
    if (m === "GET" && p === "/api/users") return send(res, 200, { max: MAX_USERS, active: activeCount(), users: db.users.map(publicUser) });
    if (m === "POST" && p === "/api/users") {
      const b = await body(req);
      const username = str(b.username, 40).toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) return send(res, 400, { error: "Tên đăng nhập 3–40 ký tự: chữ thường không dấu, số, dấu . _ -" });
      if (db.users.some((u) => u.username === username)) return send(res, 400, { error: "Tên đăng nhập đã tồn tại" });
      if (activeCount() >= MAX_USERS) return send(res, 400, { error: `Đã đủ ${MAX_USERS} tài khoản đang hoạt động. Hãy khóa bớt tài khoản không dùng.` });
      if (!str(b.name)) return send(res, 400, { error: "Cần nhập họ tên" });
      const pw = genPw();
      const u = { id: uid("u"), username, name: str(b.name, 60), title: str(b.title, 60), avatar: str(b.avatar, 8) || "🙂",
        role: b.role === "admin" ? "admin" : "member", active: true, inTeam: b.inTeam !== false, mustChange: true, createdAt: new Date().toISOString(), ...hashPw(pw) };
      db.users.push(u); audit(me, "user-create", username); save();
      return send(res, 200, { user: publicUser(u), tempPassword: pw });
    }
    if ((mm = p.match(/^\/api\/users\/([\w-]+)$/))) {
      const u = db.users.find((x) => x.id === mm[1]); if (!u) return send(res, 404, { error: "Không tìm thấy người dùng" });
      if (m === "PATCH") {
        const b = await body(req); let tempPassword;
        if (u.id === me.id && (b.active === false || b.role === "member")) return send(res, 400, { error: "Không thể tự khóa hoặc tự hạ quyền của chính mình" });
        if (b.active === true && !u.active && activeCount() >= MAX_USERS) return send(res, 400, { error: `Đã đủ ${MAX_USERS} tài khoản đang hoạt động` });
        if (b.name !== undefined && str(b.name)) u.name = str(b.name, 60);
        if (b.title !== undefined) u.title = str(b.title, 60);
        if (b.avatar !== undefined) u.avatar = str(b.avatar, 8) || "🙂";
        if (b.role !== undefined) u.role = b.role === "admin" ? "admin" : "member";
        if (b.inTeam !== undefined) u.inTeam = !!b.inTeam;
        if (b.active !== undefined) { u.active = !!b.active; if (!u.active) dropSessionsOf(u.id); }
        if (b.resetPassword) { tempPassword = genPw(); Object.assign(u, hashPw(tempPassword), { mustChange: true }); dropSessionsOf(u.id); }
        audit(me, "user-update", u.username + (b.resetPassword ? " (reset mật khẩu)" : "")); save();
        return send(res, 200, { user: publicUser(u), tempPassword });
      }
      if (m === "DELETE") {
        if (u.id === me.id) return send(res, 400, { error: "Không thể tự xóa chính mình" });
        if (db.tasks.some((t) => t.owner === u.id)) return send(res, 400, { error: "Người này còn công việc trong kế hoạch. Hãy khóa tài khoản thay vì xóa, để giữ lịch sử." });
        db.users = db.users.filter((x) => x !== u); dropSessionsOf(u.id); audit(me, "user-delete", u.username); save();
        return send(res, 200, { ok: true });
      }
    }
  }
  if (m === "GET" && p === "/api/audit") {
    if (!isAdmin) return adminOnly();
    return send(res, 200, db.audit.slice(-300).reverse());
  }
  return send(res, 404, { error: "Không tìm thấy" });
}

http.createServer(async (req, res) => {
  try { await route(req, res); }
  catch (e) {
    if (e.code === 413 || e.code === 400) return send(res, e.code, { error: e.code === 413 ? "Dữ liệu quá lớn" : "Dữ liệu không hợp lệ" });
    console.error(e); send(res, 500, { error: "Lỗi máy chủ" });
  }
}).listen(PORT, () => console.log(`Team Tracker đang chạy tại http://localhost:${PORT}  (tối đa ${MAX_USERS} tài khoản)`));
