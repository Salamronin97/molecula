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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Допускаются только изображения."));
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
    setFlash(req, "error", "Требуется вход в систему.");
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

function normalizeQuestionType(value) {
  if (value === "single" || value === "multi" || value === "scale" || value === "text") return value;
  return "text";
}

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.now = new Date();
  req.session.flash = null;

  try {
    res.locals.categories = await all("SELECT * FROM categories ORDER BY name");
  } catch (_err) {
    res.locals.categories = [];
  }
  next();
});

app.get("/", (_req, res) => res.render("home"));

app.get("/polls", (req, res) => {
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(`/surveys${query}`);
});
app.get("/polls/new", (_req, res) => res.redirect("/surveys/new"));
app.get("/polls/:id", (req, res) => res.redirect(`/surveys/${req.params.id}`));

app.get("/register", (_req, res) => res.render("auth/register"));
app.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!username || !email || password.length < 6) {
    setFlash(req, "error", "Проверьте поля. Пароль минимум 6 символов.");
    return res.redirect("/register");
  }

  const exists = await get("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
  if (exists) {
    setFlash(req, "error", "Пользователь с таким email или username уже существует.");
    return res.redirect("/register");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const adminCount = await get("SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE");
  const isFirstAdmin = Number(adminCount.count) === 0;
  const created = await run(
    "INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?) RETURNING id",
    [username, email, passwordHash, isFirstAdmin]
  );

  req.session.user = { id: created.rows[0].id, username, email, is_admin: isFirstAdmin };
  setFlash(req, "success", "Регистрация успешна.");
  req.session.save(() => res.redirect("/surveys"));
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
    setFlash(req, "error", "Ваш аккаунт заблокирован.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    setFlash(req, "error", "Неверный email или пароль.");
    return res.redirect("/login");
  }

  req.session.user = { id: user.id, username: user.username, email: user.email, is_admin: !!user.is_admin };
  setFlash(req, "success", "Вход выполнен.");
  req.session.save(() => res.redirect("/surveys"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

app.get("/surveys", async (req, res) => {
  const categorySlug = String(req.query.category || "").trim();
  const q = String(req.query.q || "").trim();
  const params = [];
  const where = [];

  if (categorySlug) {
    where.push("c.slug = ?");
    params.push(categorySlug);
  }
  if (q) {
    where.push("(LOWER(s.title) LIKE LOWER(?) OR LOWER(s.description) LIKE LOWER(?) OR CAST(s.id AS TEXT) = ?)");
    params.push(`%${q}%`, `%${q}%`, q);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const surveys = await all(
    `
    SELECT s.*, u.username, c.name AS category_name, c.slug AS category_slug,
      (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS responses_count,
      (SELECT COUNT(*) FROM survey_comments cm WHERE cm.survey_id = s.id) AS comments_count
    FROM surveys s
    JOIN users u ON u.id = s.user_id
    JOIN categories c ON c.id = s.category_id
    ${whereClause}
    ORDER BY s.created_at DESC
    `,
    params
  );

  res.render("surveys/index", { surveys, selectedCategory: categorySlug, q });
});

app.get("/surveys/new", isAuthenticated, (_req, res) => {
  res.render("surveys/new");
});

app.post("/surveys", isAuthenticated, upload.single("cover"), async (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 160);
  const description = String(req.body.description || "").trim().slice(0, 4000);
  const categoryId = Number(req.body.category_id);
  const endAt = String(req.body.end_at || "");
  const isAnonymous = !!req.body.is_anonymous;

  const rawQuestionTexts = Array.isArray(req.body.question_texts) ? req.body.question_texts : [req.body.question_texts];
  const rawQuestionTypes = Array.isArray(req.body.question_types) ? req.body.question_types : [req.body.question_types];
  const rawQuestionRequired = Array.isArray(req.body.question_required) ? req.body.question_required : [req.body.question_required];
  const rawQuestionOptions = Array.isArray(req.body.question_options) ? req.body.question_options : [req.body.question_options];

  if (!title || !description || !categoryId || !endAt) {
    setFlash(req, "error", "Заполните все обязательные поля.");
    return res.redirect("/surveys/new");
  }

  const endDate = new Date(endAt);
  if (Number.isNaN(endDate.getTime()) || endDate <= new Date()) {
    setFlash(req, "error", "Дата окончания должна быть в будущем.");
    return res.redirect("/surveys/new");
  }

  const category = await get("SELECT id FROM categories WHERE id = ?", [categoryId]);
  if (!category) {
    setFlash(req, "error", "Категория не найдена.");
    return res.redirect("/surveys/new");
  }

  const questions = [];
  for (let i = 0; i < rawQuestionTexts.length; i += 1) {
    const questionText = String(rawQuestionTexts[i] || "").trim();
    if (!questionText) continue;

    const questionType = normalizeQuestionType(rawQuestionTypes[i]);
    const optionsLines = String(rawQuestionOptions[i] || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if ((questionType === "single" || questionType === "multi") && optionsLines.length < 2) {
      setFlash(req, "error", `У вопроса "${questionText}" нужно минимум 2 варианта.`);
      return res.redirect("/surveys/new");
    }

    questions.push({
      questionText,
      questionType,
      isRequired: rawQuestionRequired[i] === "on" || rawQuestionRequired[i] === "1",
      options: optionsLines
    });
  }

  if (!questions.length) {
    setFlash(req, "error", "Добавьте хотя бы один вопрос.");
    return res.redirect("/surveys/new");
  }

  const createdSurvey = await run(
    `
    INSERT INTO surveys (user_id, category_id, title, description, cover_path, end_at, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
    `,
    [
      req.session.user.id,
      categoryId,
      title,
      description,
      req.file ? `/uploads/${req.file.filename}` : null,
      endDate.toISOString(),
      isAnonymous
    ]
  );

  const surveyId = createdSurvey.rows[0].id;

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const createdQuestion = await run(
      `
      INSERT INTO survey_questions (survey_id, question_text, question_type, is_required, sort_order)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
      `,
      [surveyId, q.questionText, q.questionType, q.isRequired, i]
    );
    const questionId = createdQuestion.rows[0].id;

    for (let j = 0; j < q.options.length; j += 1) {
      await run(
        `
        INSERT INTO survey_question_options (question_id, option_text, sort_order)
        VALUES (?, ?, ?)
        `,
        [questionId, q.options[j], j]
      );
    }
  }

  setFlash(req, "success", "Анкета опубликована.");
  res.redirect(`/surveys/${surveyId}`);
});

app.get("/surveys/:id", async (req, res) => {
  const survey = await get(
    `
    SELECT s.*, u.username, c.name AS category_name
    FROM surveys s
    JOIN users u ON u.id = s.user_id
    JOIN categories c ON c.id = s.category_id
    WHERE s.id = ?
    `,
    [req.params.id]
  );
  if (!survey) return res.status(404).render("404");

  const questions = await all(
    `
    SELECT q.*
    FROM survey_questions q
    WHERE q.survey_id = ?
    ORDER BY q.sort_order, q.id
    `,
    [survey.id]
  );

  for (const question of questions) {
    question.options = await all(
      `
      SELECT o.*
      FROM survey_question_options o
      WHERE o.question_id = ?
      ORDER BY o.sort_order, o.id
      `,
      [question.id]
    );
  }

  let hasResponded = false;
  if (req.session.user) {
    const row = await get("SELECT id FROM survey_responses WHERE survey_id = ? AND user_id = ?", [survey.id, req.session.user.id]);
    hasResponded = !!row;
  }

  const comments = await all(
    `
    SELECT c.*, u.username
    FROM survey_comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.survey_id = ?
    ORDER BY c.created_at DESC
    `,
    [survey.id]
  );

  const questionStats = {};
  for (const question of questions) {
    if (question.question_type === "single" || question.question_type === "multi") {
      questionStats[question.id] = await all(
        `
        SELECT o.id, o.option_text, COUNT(a.id)::int AS vote_count
        FROM survey_question_options o
        LEFT JOIN survey_answers a ON a.option_id = o.id
        WHERE o.question_id = ?
        GROUP BY o.id, o.option_text
        ORDER BY o.sort_order, o.id
        `,
        [question.id]
      );
    }
  }

  const responsesCount = await get("SELECT COUNT(*)::int AS total FROM survey_responses WHERE survey_id = ?", [survey.id]);

  res.render("surveys/show", {
    survey,
    questions,
    comments,
    hasResponded,
    questionStats,
    responsesCount: Number(responsesCount.total || 0)
  });
});

app.post("/surveys/:id/respond", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = await get("SELECT id, end_at FROM surveys WHERE id = ?", [surveyId]);
  if (!survey) return res.status(404).render("404");

  if (new Date(survey.end_at) <= new Date()) {
    setFlash(req, "error", "Срок анкетирования истек.");
    return res.redirect(`/surveys/${surveyId}`);
  }

  const questions = await all("SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order, id", [surveyId]);
  const byId = new Map();
  questions.forEach((q) => byId.set(String(q.id), q));

  const optionsByQuestion = {};
  for (const q of questions) {
    optionsByQuestion[q.id] = await all("SELECT * FROM survey_question_options WHERE question_id = ? ORDER BY sort_order, id", [q.id]);
  }

  let responseRow;
  try {
    responseRow = await run("INSERT INTO survey_responses (survey_id, user_id) VALUES (?, ?) RETURNING id", [surveyId, req.session.user.id]);
  } catch (_err) {
    setFlash(req, "error", "Вы уже отправляли ответы в этой анкете.");
    return res.redirect(`/surveys/${surveyId}`);
  }

  const responseId = responseRow.rows[0].id;
  for (const question of questions) {
    const key = `q_${question.id}`;
    const value = req.body[key];

    if (question.question_type === "text") {
      const textValue = String(value || "").trim();
      if (question.is_required && !textValue) {
        setFlash(req, "error", "Заполните обязательные поля.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (textValue) {
        await run("INSERT INTO survey_answers (response_id, question_id, text_value) VALUES (?, ?, ?)", [responseId, question.id, textValue]);
      }
      continue;
    }

    if (question.question_type === "scale") {
      const num = Number(value);
      if (question.is_required && !value) {
        setFlash(req, "error", "Заполните обязательные поля.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value && (Number.isNaN(num) || num < 1 || num > 5)) {
        setFlash(req, "error", "Некорректное значение шкалы.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value) {
        await run("INSERT INTO survey_answers (response_id, question_id, number_value) VALUES (?, ?, ?)", [responseId, question.id, num]);
      }
      continue;
    }

    const allowed = new Set(optionsByQuestion[question.id].map((o) => Number(o.id)));
    if (question.question_type === "single") {
      const optionId = Number(value);
      if (question.is_required && !value) {
        setFlash(req, "error", "Заполните обязательные поля.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value && !allowed.has(optionId)) {
        setFlash(req, "error", "Некорректный вариант ответа.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value) {
        await run("INSERT INTO survey_answers (response_id, question_id, option_id) VALUES (?, ?, ?)", [responseId, question.id, optionId]);
      }
      continue;
    }

    const rawValues = Array.isArray(value) ? value : value ? [value] : [];
    if (question.is_required && !rawValues.length) {
      setFlash(req, "error", "Заполните обязательные поля.");
      return res.redirect(`/surveys/${surveyId}`);
    }
    for (const raw of rawValues) {
      const optionId = Number(raw);
      if (!allowed.has(optionId)) {
        setFlash(req, "error", "Некорректный вариант ответа.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      await run("INSERT INTO survey_answers (response_id, question_id, option_id) VALUES (?, ?, ?)", [responseId, question.id, optionId]);
    }
  }

  setFlash(req, "success", "Ответы сохранены.");
  res.redirect(`/surveys/${surveyId}`);
});

app.post("/surveys/:id/comments", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  if (!body) {
    setFlash(req, "error", "Комментарий не может быть пустым.");
    return res.redirect(`/surveys/${surveyId}`);
  }
  await run("INSERT INTO survey_comments (survey_id, user_id, body) VALUES (?, ?, ?)", [surveyId, req.session.user.id, body]);
  setFlash(req, "success", "Комментарий добавлен.");
  res.redirect(`/surveys/${surveyId}`);
});

app.post("/reports", isAuthenticated, async (req, res) => {
  const surveyId = req.body.survey_id ? Number(req.body.survey_id) : null;
  const commentId = req.body.comment_id ? Number(req.body.comment_id) : null;
  const reason = String(req.body.reason || "").trim().slice(0, 300);
  if (!reason || (!surveyId && !commentId)) {
    setFlash(req, "error", "Некорректная жалоба.");
    return res.redirect("/surveys");
  }

  await run("INSERT INTO reports (reporter_id, survey_id, comment_id, reason) VALUES (?, ?, ?, ?)", [
    req.session.user.id,
    surveyId,
    commentId,
    reason
  ]);
  setFlash(req, "success", "Жалоба отправлена.");
  res.redirect(req.get("Referrer") || "/surveys");
});

app.get("/me", isAuthenticated, (req, res) => res.redirect(`/profile/${req.session.user.id}`));
app.get("/me/edit", isAuthenticated, async (req, res) => {
  const user = await get("SELECT id, username, email, bio, avatar_path FROM users WHERE id = ?", [req.session.user.id]);
  res.render("edit-profile", { user });
});

app.post("/me/edit", isAuthenticated, upload.single("avatar"), async (req, res) => {
  const bio = String(req.body.bio || "").trim().slice(0, 500);
  const user = await get("SELECT avatar_path FROM users WHERE id = ?", [req.session.user.id]);
  const avatarPath = req.file ? `/uploads/${req.file.filename}` : user.avatar_path || null;
  await run("UPDATE users SET bio = ?, avatar_path = ? WHERE id = ?", [bio, avatarPath, req.session.user.id]);
  setFlash(req, "success", "Профиль обновлен.");
  res.redirect(`/profile/${req.session.user.id}`);
});

app.get("/profile/:id", async (req, res) => {
  const profileUser = await get(
    "SELECT id, username, email, bio, avatar_path, is_admin, created_at FROM users WHERE id = ?",
    [req.params.id]
  );
  if (!profileUser) return res.status(404).render("404");

  const surveys = await all(
    `
    SELECT s.*, (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS responses_count
    FROM surveys s
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    `,
    [profileUser.id]
  );

  res.render("profile", { profileUser, surveys });
});

app.get("/admin", isAdmin, async (_req, res) => {
  const users = await all("SELECT id, username, email, is_banned, is_admin, created_at FROM users ORDER BY id DESC");
  const surveys = await all("SELECT s.id, s.title, s.end_at, u.username FROM surveys s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 50");
  const comments = await all("SELECT c.id, c.body, c.survey_id, u.username FROM survey_comments c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC LIMIT 50");
  const reports = await all(
    `
    SELECT r.*, u.username AS reporter_name
    FROM reports r
    JOIN users u ON u.id = r.reporter_id
    ORDER BY r.created_at DESC
    LIMIT 80
    `
  );
  res.render("admin", { users, surveys, comments, reports });
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
  res.redirect("/admin");
});

app.post("/admin/surveys/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM surveys WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Анкета удалена.");
  res.redirect("/admin");
});

app.post("/admin/comments/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM survey_comments WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Комментарий удален.");
  res.redirect("/admin");
});

app.post("/admin/reports/:id/resolve", isAdmin, async (req, res) => {
  await run("UPDATE reports SET status = 'resolved' WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Жалоба обработана.");
  res.redirect("/admin");
});

app.get("/requisites", (_req, res) => res.render("requisites"));

app.use((_req, res) => {
  res.status(404).render("404");
});

app.use((err, req, res, _next) => {
  setFlash(req, "error", err.message || "Ошибка сервера.");
  res.redirect(req.get("Referrer") || "/surveys");
});

async function bootstrap() {
  await initDb();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Molecula v2 running on http://localhost:${PORT}`);
  });
}

bootstrap();
