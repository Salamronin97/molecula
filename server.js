const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const multer = require("multer");
const methodOverride = require("method-override");
const { pool, run, get, all, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", true);

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("РњРѕР¶РЅРѕ Р·Р°РіСЂСѓР¶Р°С‚СЊ С‚РѕР»СЊРєРѕ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ."));
  }
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

app.use(
  session({
    proxy: true,
    store: new PgSession({
      pool,
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "change_this_secret_in_production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

function setFlash(req, type, message) {
  let normalizedMessage = message;
  if (typeof message === "string" && /[РС][^a-zA-Z0-9]/.test(message)) {
    normalizedMessage = type === "success" ? "Операция выполнена." : "Произошла ошибка. Проверьте введенные данные.";
  }
  req.session.flash = { type, message: normalizedMessage };
}

function isAuthenticated(req, res, next) {
  if (!req.session.user) {
    setFlash(req, "error", "РўСЂРµР±СѓРµС‚СЃСЏ РІС…РѕРґ РІ СЃРёСЃС‚РµРјСѓ.");
    return res.redirect("/login");
  }
  next();
}

function isAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    setFlash(req, "error", "Р”РѕСЃС‚СѓРї С‚РѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°.");
    return res.redirect("/");
  }
  next();
}

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.now = new Date();
  req.session.flash = null;

  try {
    res.locals.categories = await all("SELECT * FROM categories ORDER BY name ASC");
  } catch (_err) {
    res.locals.categories = [];
  }

  next();
});

app.get("/", async (req, res) => {
  const categorySlug = req.query.category || "";
  const params = [];

  let whereClause = "";
  if (categorySlug) {
    whereClause = "WHERE c.slug = ?";
    params.push(categorySlug);
  }

  const polls = await all(
    `
    SELECT p.*, u.username, c.name AS category_name, c.slug AS category_slug,
      (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS vote_count,
      (SELECT COUNT(*) FROM comments cm WHERE cm.poll_id = p.id) AS comment_count
    FROM polls p
    JOIN users u ON p.user_id = u.id
    JOIN categories c ON p.category_id = c.id
    ${whereClause}
    ORDER BY p.created_at DESC
  `,
    params
  );

  res.render("index", { polls, selectedCategory: categorySlug });
});

app.get("/register", (_req, res) => {
  res.render("auth/register");
});

app.post("/register", async (req, res) => {
  const rawUsername = String(req.body.username || "");
  const rawEmail = String(req.body.email || "");
  const password = String(req.body.password || "");
  const username = rawUsername.trim();
  const email = rawEmail.trim().toLowerCase();

  if (!username || !email || !password || password.length < 6) {
    setFlash(req, "error", "РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕР»СЏ: РїР°СЂРѕР»СЊ РјРёРЅРёРјСѓРј 6 СЃРёРјРІРѕР»РѕРІ.");
    return res.redirect("/register");
  }

  const existingUser = await get("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
  if (existingUser) {
    setFlash(req, "error", "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ С‚Р°РєРёРј email РёР»Рё username СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚.");
    return res.redirect("/register");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const adminCount = await get("SELECT COUNT(*) AS count FROM users WHERE is_admin = TRUE");
  const makeAdmin = Number(adminCount.count) === 0;

  const result = await run(
    "INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?) RETURNING id",
    [username, email, passwordHash, makeAdmin]
  );

  req.session.user = {
    id: result.rows[0].id,
    username,
    email,
    is_admin: makeAdmin
  };

  setFlash(req, "success", makeAdmin ? "РђРєРєР°СѓРЅС‚ СЃРѕР·РґР°РЅ. Р’С‹ РЅР°Р·РЅР°С‡РµРЅС‹ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРј." : "РђРєРєР°СѓРЅС‚ СЃРѕР·РґР°РЅ.");
  req.session.save(() => res.redirect("/"));
});

app.get("/login", (_req, res) => {
  res.render("auth/login");
});

app.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    setFlash(req, "error", "Р’РІРµРґРёС‚Рµ email Рё РїР°СЂРѕР»СЊ.");
    return res.redirect("/login");
  }

  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) {
    setFlash(req, "error", "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ.");
    return res.redirect("/login");
  }

  if (user.is_banned) {
    setFlash(req, "error", "Р’Р°С€ Р°РєРєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРј.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    setFlash(req, "error", "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ.");
    return res.redirect("/login");
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    is_admin: !!user.is_admin
  };
  setFlash(req, "success", "Р’С‹ РІРѕС€Р»Рё РІ СЃРёСЃС‚РµРјСѓ.");
  req.session.save(() => res.redirect("/"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

app.get("/me", isAuthenticated, (req, res) => {
  res.redirect(`/profile/${req.session.user.id}`);
});

app.get("/profile/:id", async (req, res) => {
  const user = await get(
    `
    SELECT id, username, email, bio, is_admin, created_at
    FROM users
    WHERE id = ?
  `,
    [req.params.id]
  );
  if (!user) return res.status(404).render("404");

  const polls = await all(
    `
    SELECT p.*,
      (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS vote_count
    FROM polls p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `,
    [user.id]
  );

  res.render("profile", { profileUser: user, polls });
});

app.get("/me/edit", isAuthenticated, async (req, res) => {
  const user = await get("SELECT id, username, email, bio FROM users WHERE id = ?", [req.session.user.id]);
  res.render("edit-profile", { user });
});

app.post("/me/edit", isAuthenticated, async (req, res) => {
  const bio = (req.body.bio || "").trim().slice(0, 500);
  await run("UPDATE users SET bio = ? WHERE id = ?", [bio, req.session.user.id]);
  setFlash(req, "success", "РџСЂРѕС„РёР»СЊ РѕР±РЅРѕРІР»РµРЅ.");
  res.redirect(`/profile/${req.session.user.id}`);
});

app.get("/polls/new", isAuthenticated, (_req, res) => {
  res.render("poll-new");
});

app.post("/polls", isAuthenticated, upload.single("image"), async (req, res) => {
  const { title, description, category_id, end_at, is_anonymous } = req.body;
  let options = req.body.options || [];
  if (!Array.isArray(options)) options = [options];
  options = options.map((item) => item.trim()).filter(Boolean);

  if (!title || !description || !category_id || !end_at || options.length < 2) {
    setFlash(req, "error", "Р—Р°РїРѕР»РЅРёС‚Рµ РїРѕР»СЏ Рё РґРѕР±Р°РІСЊС‚Рµ РјРёРЅРёРјСѓРј 2 РІР°СЂРёР°РЅС‚Р° РѕС‚РІРµС‚Р°.");
    return res.redirect("/polls/new");
  }

  const endDate = new Date(end_at);
  if (Number.isNaN(endDate.getTime()) || endDate <= new Date()) {
    setFlash(req, "error", "Р”Р°С‚Р° РѕРєРѕРЅС‡Р°РЅРёСЏ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РІ Р±СѓРґСѓС‰РµРј.");
    return res.redirect("/polls/new");
  }

  const category = await get("SELECT id FROM categories WHERE id = ?", [category_id]);
  if (!category) {
    setFlash(req, "error", "РљР°С‚РµРіРѕСЂРёСЏ РЅРµ РЅР°Р№РґРµРЅР°.");
    return res.redirect("/polls/new");
  }

  const result = await run(
    `
    INSERT INTO polls (user_id, category_id, title, description, image_path, end_at, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
  `,
    [
      req.session.user.id,
      category_id,
      title.trim(),
      description.trim(),
      req.file ? `/uploads/${req.file.filename}` : null,
      endDate.toISOString(),
      !!is_anonymous
    ]
  );

  const pollId = result.rows[0].id;
  for (const optionText of options) {
    await run("INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)", [pollId, optionText]);
  }

  setFlash(req, "success", "Р“РѕР»РѕСЃРѕРІР°РЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРѕ.");
  res.redirect(`/polls/${pollId}`);
});

app.get("/polls/:id", async (req, res) => {
  const poll = await get(
    `
    SELECT p.*, u.username, c.name AS category_name
    FROM polls p
    JOIN users u ON p.user_id = u.id
    JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `,
    [req.params.id]
  );

  if (!poll) return res.status(404).render("404");

  const options = await all(
    `
    SELECT po.*,
      (SELECT COUNT(*) FROM votes v WHERE v.option_id = po.id) AS vote_count
    FROM poll_options po
    WHERE po.poll_id = ?
  `,
    [poll.id]
  );

  const totalVotesRow = await get("SELECT COUNT(*) AS total FROM votes WHERE poll_id = ?", [poll.id]);
  const totalVotes = totalVotesRow.total;

  let userVote = null;
  if (req.session.user) {
    userVote = await get("SELECT * FROM votes WHERE poll_id = ? AND user_id = ?", [poll.id, req.session.user.id]);
  }

  const comments = await all(
    `
    SELECT cm.*, u.username
    FROM comments cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.poll_id = ?
    ORDER BY cm.created_at DESC
  `,
    [poll.id]
  );

  let voters = [];
  if (!poll.is_anonymous) {
    voters = await all(
      `
      SELECT u.id, u.username, po.option_text
      FROM votes v
      JOIN users u ON u.id = v.user_id
      JOIN poll_options po ON po.id = v.option_id
      WHERE v.poll_id = ?
      ORDER BY v.created_at DESC
      LIMIT 40
    `,
      [poll.id]
    );
  }

  res.render("poll-show", {
    poll,
    options,
    comments,
    totalVotes,
    userVote,
    voters
  });
});

app.post("/polls/:id/vote", isAuthenticated, async (req, res) => {
  const pollId = Number(req.params.id);
  const optionId = Number(req.body.option_id);
  const userId = req.session.user.id;

  const user = await get("SELECT is_banned FROM users WHERE id = ?", [userId]);
  if (!user || user.is_banned) {
    setFlash(req, "error", "Р’Р°С€ Р°РєРєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ.");
    return res.redirect(`/polls/${pollId}`);
  }

  const poll = await get("SELECT * FROM polls WHERE id = ?", [pollId]);
  if (!poll) {
    setFlash(req, "error", "Р“РѕР»РѕСЃРѕРІР°РЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ.");
    return res.redirect("/");
  }

  if (new Date(poll.end_at) <= new Date()) {
    setFlash(req, "error", "Р’СЂРµРјСЏ РіРѕР»РѕСЃРѕРІР°РЅРёСЏ РёСЃС‚РµРєР»Рѕ.");
    return res.redirect(`/polls/${pollId}`);
  }

  const option = await get("SELECT id FROM poll_options WHERE id = ? AND poll_id = ?", [optionId, pollId]);
  if (!option) {
    setFlash(req, "error", "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РІР°СЂРёР°РЅС‚ РѕС‚РІРµС‚Р°.");
    return res.redirect(`/polls/${pollId}`);
  }

  try {
    await run("INSERT INTO votes (poll_id, option_id, user_id) VALUES (?, ?, ?)", [pollId, optionId, userId]);
    setFlash(req, "success", "Р’Р°С€ РіРѕР»РѕСЃ СѓС‡С‚РµРЅ.");
  } catch (_err) {
    setFlash(req, "error", "РџРѕРІС‚РѕСЂРЅРѕРµ РіРѕР»РѕСЃРѕРІР°РЅРёРµ Р·Р°РїСЂРµС‰РµРЅРѕ.");
  }

  res.redirect(`/polls/${pollId}`);
});

app.post("/polls/:id/comments", isAuthenticated, async (req, res) => {
  const pollId = Number(req.params.id);
  const body = (req.body.body || "").trim();
  if (!body) {
    setFlash(req, "error", "РљРѕРјРјРµРЅС‚Р°СЂРёР№ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј.");
    return res.redirect(`/polls/${pollId}`);
  }

  await run("INSERT INTO comments (poll_id, user_id, body) VALUES (?, ?, ?)", [pollId, req.session.user.id, body]);
  setFlash(req, "success", "РљРѕРјРјРµРЅС‚Р°СЂРёР№ РґРѕР±Р°РІР»РµРЅ.");
  res.redirect(`/polls/${pollId}`);
});

app.post("/reports", isAuthenticated, async (req, res) => {
  const { poll_id, comment_id, reason } = req.body;
  if (!reason || (!poll_id && !comment_id)) {
    setFlash(req, "error", "РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ Р¶Р°Р»РѕР±Р°.");
    return res.redirect("/");
  }

  await run(
    "INSERT INTO reports (reporter_id, poll_id, comment_id, reason) VALUES (?, ?, ?, ?)",
    [req.session.user.id, poll_id || null, comment_id || null, reason.trim().slice(0, 300)]
  );
  setFlash(req, "success", "Р–Р°Р»РѕР±Р° РѕС‚РїСЂР°РІР»РµРЅР°.");
  res.redirect(req.get("Referrer") || "/");
});

app.get("/admin", isAdmin, async (_req, res) => {
  const users = await all("SELECT id, username, email, is_banned, is_admin, created_at FROM users ORDER BY id DESC");
  const reports = await all(
    `
    SELECT r.*, u.username AS reporter_name
    FROM reports r
    JOIN users u ON u.id = r.reporter_id
    ORDER BY r.created_at DESC
  `
  );
  const polls = await all(
    `
    SELECT p.id, p.title, u.username
    FROM polls p JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT 20
  `
  );
  const comments = await all(
    `
    SELECT c.id, c.body, c.poll_id, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
    LIMIT 20
  `
  );

  res.render("admin", { users, reports, polls, comments });
});

app.post("/admin/users/:id/toggle-ban", isAdmin, async (req, res) => {
  const user = await get("SELECT is_banned, is_admin FROM users WHERE id = ?", [req.params.id]);
  if (!user) {
    setFlash(req, "error", "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ.");
    return res.redirect("/admin");
  }
  if (user.is_admin) {
    setFlash(req, "error", "РќРµР»СЊР·СЏ Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°.");
    return res.redirect("/admin");
  }
  await run("UPDATE users SET is_banned = ? WHERE id = ?", [user.is_banned ? 0 : 1, req.params.id]);
  setFlash(req, "success", user.is_banned ? "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЂР°Р·Р±Р°РЅРµРЅ." : "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р·Р°Р±Р°РЅРµРЅ.");
  res.redirect("/admin");
});

app.post("/admin/polls/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM polls WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "РџРѕСЃС‚ СѓРґР°Р»РµРЅ.");
  res.redirect("/admin");
});

app.post("/admin/comments/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM comments WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "РљРѕРјРјРµРЅС‚Р°СЂРёР№ СѓРґР°Р»РµРЅ.");
  res.redirect("/admin");
});

app.post("/admin/reports/:id/resolve", isAdmin, async (req, res) => {
  await run("UPDATE reports SET status = 'resolved' WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Р–Р°Р»РѕР±Р° РѕС‚РјРµС‡РµРЅР° РєР°Рє РѕР±СЂР°Р±РѕС‚Р°РЅРЅР°СЏ.");
  res.redirect("/admin");
});

app.get("/requisites", (_req, res) => {
  res.render("requisites");
});

app.use((_req, res) => {
  res.status(404).render("404");
});

app.use((err, req, res, _next) => {
  setFlash(req, "error", err.message || "РћС€РёР±РєР° СЃРµСЂРІРµСЂР°.");
  res.redirect(req.get("Referrer") || "/");
});

async function bootstrap() {
  await initDb();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Molecula running on http://localhost:${PORT}`);
  });
}

bootstrap();

