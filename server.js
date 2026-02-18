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
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "video" && file.mimetype.startsWith("video/")) return cb(null, true);
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Допустимы только изображения или видеофайлы."));
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
    store: new PgSession({ pool, createTableIfMissing: true }),
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
  req.session.flash = { type, message };
}

function isAuthenticated(req, res, next) {
  if (!req.session.user) {
    setFlash(req, "error", "Нужен вход в аккаунт.");
    return res.redirect("/login");
  }
  return next();
}

function isAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    setFlash(req, "error", "Доступ только для администратора.");
    return res.redirect("/");
  }
  return next();
}

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.now = new Date();
  req.session.flash = null;

  try {
    const categories = await all("SELECT * FROM categories ORDER BY sort_order, name");
    const grouped = {};
    for (const category of categories) {
      const group = category.group_name || "Разное";
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(category);
    }
    res.locals.categories = categories;
    res.locals.categoryGroups = grouped;
  } catch (_err) {
    res.locals.categories = [];
    res.locals.categoryGroups = {};
  }

  next();
});

app.get("/", async (req, res) => {
  const categorySlug = String(req.query.category || "").trim();
  const rawQ = String(req.query.q || "").trim();
  const q = rawQ.slice(0, 80);

  const where = [];
  const params = [];

  if (categorySlug) {
    where.push("c.slug = ?");
    params.push(categorySlug);
  }

  if (q) {
    where.push("(LOWER(p.title) LIKE LOWER(?) OR LOWER(p.description) LIKE LOWER(?) OR CAST(p.id AS TEXT) = ?)");
    params.push(`%${q}%`, `%${q}%`, q);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const polls = await all(
    `
    SELECT p.*, u.username, u.avatar_path, c.name AS category_name, c.slug AS category_slug,
      (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS vote_count,
      (SELECT COUNT(*) FROM comments cm WHERE cm.poll_id = p.id) AS comment_count
    FROM polls p
    JOIN users u ON p.user_id = u.id
    JOIN categories c ON p.category_id = c.id
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT 120
  `,
    params
  );

  let favoriteIds = new Set();
  if (req.session.user && polls.length) {
    const ids = polls.map((poll) => poll.id);
    const marks = await all(
      `SELECT poll_id FROM favorites WHERE user_id = ? AND poll_id = ANY(?::int[])`,
      [req.session.user.id, ids]
    );
    favoriteIds = new Set(marks.map((item) => Number(item.poll_id)));
  }

  const pollsWithFlags = polls.map((poll) => ({
    ...poll,
    is_favorite: favoriteIds.has(Number(poll.id))
  }));

  res.render("index", { polls: pollsWithFlags, selectedCategory: categorySlug, q });
});

app.get("/register", (_req, res) => res.render("auth/register"));

app.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim().slice(0, 30);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!username || !email || password.length < 6) {
    setFlash(req, "error", "Проверьте поля. Пароль: минимум 6 символов.");
    return res.redirect("/register");
  }

  const exists = await get("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
  if (exists) {
    setFlash(req, "error", "Пользователь с таким email или username уже существует.");
    return res.redirect("/register");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const adminCount = await get("SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE");
  const makeAdmin = Number(adminCount.count) === 0;

  const result = await run(
    "INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?) RETURNING id",
    [username, email, passwordHash, makeAdmin]
  );

  req.session.user = { id: result.rows[0].id, username, email, is_admin: makeAdmin };
  setFlash(req, "success", "Аккаунт создан.");
  req.session.save(() => res.redirect("/"));
});

app.get("/login", (_req, res) => res.render("auth/login"));

app.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    setFlash(req, "error", "Введите email и пароль.");
    return res.redirect("/login");
  }

  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) {
    setFlash(req, "error", "Неверный email или пароль.");
    return res.redirect("/login");
  }

  if (user.is_banned) {
    setFlash(req, "error", "Ваш аккаунт заблокирован администратором.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    setFlash(req, "error", "Неверный email или пароль.");
    return res.redirect("/login");
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    is_admin: !!user.is_admin
  };
  setFlash(req, "success", "Вход выполнен.");
  req.session.save(() => res.redirect("/"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

app.get("/me", isAuthenticated, (req, res) => res.redirect(`/profile/${req.session.user.id}`));

app.get("/profile/:id", async (req, res) => {
  const profileUser = await get(
    `
    SELECT id, username, email, bio, avatar_path, is_admin, created_at
    FROM users
    WHERE id = ?
  `,
    [req.params.id]
  );
  if (!profileUser) return res.status(404).render("404");

  const polls = await all(
    `
    SELECT p.*,
      (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS vote_count
    FROM polls p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `,
    [profileUser.id]
  );

  const favorites = await all(
    `
    SELECT p.id, p.title, c.slug AS category_slug, c.name AS category_name
    FROM favorites f
    JOIN polls p ON p.id = f.poll_id
    JOIN categories c ON c.id = p.category_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
    LIMIT 30
  `,
    [profileUser.id]
  );

  res.render("profile", { profileUser, polls, favorites });
});

app.get("/me/edit", isAuthenticated, async (req, res) => {
  const user = await get("SELECT id, username, email, bio, avatar_path FROM users WHERE id = ?", [req.session.user.id]);
  res.render("edit-profile", { user });
});

app.post("/me/edit", isAuthenticated, upload.single("avatar"), async (req, res) => {
  const bio = String(req.body.bio || "").trim().slice(0, 500);
  const user = await get("SELECT avatar_path FROM users WHERE id = ?", [req.session.user.id]);
  let avatarPath = user ? user.avatar_path : null;
  if (req.file && req.file.mimetype.startsWith("image/")) avatarPath = `/uploads/${req.file.filename}`;

  await run("UPDATE users SET bio = ?, avatar_path = ? WHERE id = ?", [bio, avatarPath, req.session.user.id]);
  setFlash(req, "success", "Профиль обновлён.");
  res.redirect(`/profile/${req.session.user.id}`);
});

app.get("/polls/new", isAuthenticated, (_req, res) => res.render("poll-new"));

app.post("/polls", isAuthenticated, upload.fields([{ name: "image", maxCount: 1 }, { name: "video", maxCount: 1 }]), async (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 140);
  const description = String(req.body.description || "").trim().slice(0, 15000);
  const categoryId = Number(req.body.category_id);
  const endAt = String(req.body.end_at || "");
  const isAnonymous = !!req.body.is_anonymous;
  let options = req.body.options || [];
  if (!Array.isArray(options)) options = [options];
  options = options.map((item) => String(item || "").trim()).filter(Boolean);

  if (!title || !description || !categoryId || !endAt || options.length < 2) {
    setFlash(req, "error", "Заполните все поля и добавьте минимум 2 варианта ответа.");
    return res.redirect("/polls/new");
  }

  const endDate = new Date(endAt);
  if (Number.isNaN(endDate.getTime()) || endDate <= new Date()) {
    setFlash(req, "error", "Дата окончания должна быть в будущем.");
    return res.redirect("/polls/new");
  }

  const category = await get("SELECT id FROM categories WHERE id = ?", [categoryId]);
  if (!category) {
    setFlash(req, "error", "Категория не найдена.");
    return res.redirect("/polls/new");
  }

  const imageFile = req.files?.image?.[0];
  const videoFile = req.files?.video?.[0];

  const result = await run(
    `
    INSERT INTO polls (user_id, category_id, title, description, image_path, video_path, end_at, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
    [
      req.session.user.id,
      categoryId,
      title,
      description,
      imageFile ? `/uploads/${imageFile.filename}` : null,
      videoFile ? `/uploads/${videoFile.filename}` : null,
      endDate.toISOString(),
      isAnonymous
    ]
  );

  const pollId = result.rows[0].id;
  for (const optionText of options) {
    await run("INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)", [pollId, optionText.slice(0, 255)]);
  }

  setFlash(req, "success", "Опрос опубликован.");
  return res.redirect(`/polls/${pollId}`);
});

app.get("/polls/:id", async (req, res) => {
  const poll = await get(
    `
    SELECT p.*, u.username, u.avatar_path, c.name AS category_name, c.slug AS category_slug
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
    ORDER BY po.id
  `,
    [poll.id]
  );

  const totalVotesRow = await get("SELECT COUNT(*)::int AS total FROM votes WHERE poll_id = ?", [poll.id]);
  const totalVotes = Number(totalVotesRow.total || 0);

  let userVote = null;
  let isFavorite = false;
  if (req.session.user) {
    userVote = await get("SELECT * FROM votes WHERE poll_id = ? AND user_id = ?", [poll.id, req.session.user.id]);
    const favorite = await get("SELECT id FROM favorites WHERE poll_id = ? AND user_id = ?", [poll.id, req.session.user.id]);
    isFavorite = !!favorite;
  }

  const comments = await all(
    `
    SELECT cm.*, u.username, u.avatar_path
    FROM comments cm
    JOIN users u ON u.id = cm.user_id
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
      LIMIT 60
    `,
      [poll.id]
    );
  }

  res.render("poll-show", { poll, options, comments, totalVotes, userVote, voters, isFavorite });
});

app.post("/polls/:id/favorite", isAuthenticated, async (req, res) => {
  const pollId = Number(req.params.id);
  const next = String(req.body.next || req.get("Referrer") || "/");
  const row = await get("SELECT id FROM favorites WHERE poll_id = ? AND user_id = ?", [pollId, req.session.user.id]);

  if (row) {
    await run("DELETE FROM favorites WHERE poll_id = ? AND user_id = ?", [pollId, req.session.user.id]);
    setFlash(req, "success", "Убрано из избранного.");
  } else {
    await run("INSERT INTO favorites (user_id, poll_id) VALUES (?, ?) ON CONFLICT (user_id, poll_id) DO NOTHING", [
      req.session.user.id,
      pollId
    ]);
    setFlash(req, "success", "Добавлено в избранное.");
  }

  res.redirect(next.startsWith("/") ? next : "/");
});

app.post("/polls/:id/vote", isAuthenticated, async (req, res) => {
  const pollId = Number(req.params.id);
  const optionId = Number(req.body.option_id);
  const userId = req.session.user.id;

  const user = await get("SELECT is_banned FROM users WHERE id = ?", [userId]);
  if (!user || user.is_banned) {
    setFlash(req, "error", "Ваш аккаунт заблокирован.");
    return res.redirect(`/polls/${pollId}`);
  }

  const poll = await get("SELECT * FROM polls WHERE id = ?", [pollId]);
  if (!poll) {
    setFlash(req, "error", "Опрос не найден.");
    return res.redirect("/");
  }

  if (new Date(poll.end_at) <= new Date()) {
    setFlash(req, "error", "Время голосования истекло.");
    return res.redirect(`/polls/${pollId}`);
  }

  const option = await get("SELECT id FROM poll_options WHERE id = ? AND poll_id = ?", [optionId, pollId]);
  if (!option) {
    setFlash(req, "error", "Некорректный вариант ответа.");
    return res.redirect(`/polls/${pollId}`);
  }

  try {
    await run("INSERT INTO votes (poll_id, option_id, user_id) VALUES (?, ?, ?)", [pollId, optionId, userId]);
    setFlash(req, "success", "Ваш голос учтён.");
  } catch (_err) {
    setFlash(req, "error", "Повторное голосование запрещено.");
  }

  return res.redirect(`/polls/${pollId}`);
});

app.post("/polls/:id/comments", isAuthenticated, async (req, res) => {
  const pollId = Number(req.params.id);
  const body = String(req.body.body || "").trim().slice(0, 4000);
  if (!body) {
    setFlash(req, "error", "Комментарий не может быть пустым.");
    return res.redirect(`/polls/${pollId}`);
  }

  await run("INSERT INTO comments (poll_id, user_id, body) VALUES (?, ?, ?)", [pollId, req.session.user.id, body]);
  setFlash(req, "success", "Комментарий добавлен.");
  return res.redirect(`/polls/${pollId}`);
});

app.post("/reports", isAuthenticated, async (req, res) => {
  const pollId = req.body.poll_id || null;
  const commentId = req.body.comment_id || null;
  const reason = String(req.body.reason || "").trim().slice(0, 300);

  if (!reason || (!pollId && !commentId)) {
    setFlash(req, "error", "Некорректная жалоба.");
    return res.redirect("/");
  }

  await run("INSERT INTO reports (reporter_id, poll_id, comment_id, reason) VALUES (?, ?, ?, ?)", [
    req.session.user.id,
    pollId,
    commentId,
    reason
  ]);
  setFlash(req, "success", "Жалоба отправлена.");
  return res.redirect(req.get("Referrer") || "/");
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
    FROM polls p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT 40
  `
  );
  const comments = await all(
    `
    SELECT c.id, c.body, c.poll_id, u.username
    FROM comments c
    JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
    LIMIT 40
  `
  );
  res.render("admin", { users, reports, polls, comments });
});

app.post("/admin/users/:id/toggle-ban", isAdmin, async (req, res) => {
  const user = await get("SELECT is_banned, is_admin FROM users WHERE id = ?", [req.params.id]);
  if (!user) {
    setFlash(req, "error", "Пользователь не найден.");
    return res.redirect("/admin");
  }
  if (user.is_admin) {
    setFlash(req, "error", "Нельзя блокировать администратора.");
    return res.redirect("/admin");
  }
  await run("UPDATE users SET is_banned = ? WHERE id = ?", [!user.is_banned, req.params.id]);
  setFlash(req, "success", user.is_banned ? "Пользователь разбанен." : "Пользователь забанен.");
  return res.redirect("/admin");
});

app.post("/admin/polls/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM polls WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Пост удалён.");
  return res.redirect("/admin");
});

app.post("/admin/comments/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM comments WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Комментарий удалён.");
  return res.redirect("/admin");
});

app.post("/admin/reports/:id/resolve", isAdmin, async (req, res) => {
  await run("UPDATE reports SET status = 'resolved' WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Жалоба отмечена как обработанная.");
  return res.redirect("/admin");
});

app.get("/requisites", (_req, res) => res.render("requisites"));

app.use((_req, res) => res.status(404).render("404"));

app.use((err, req, res, _next) => {
  setFlash(req, "error", err.message || "Ошибка сервера.");
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
