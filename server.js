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
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) return cb(null, true);
    cb(new Error("Only image and video files are allowed."));
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
  if (type === "error") {
    req.session.flash = { type, message: "Ошибка выполнения операции." };
    return;
  }
  req.session.flash = { type, message: "Операция выполнена." };
}

function isAuthenticated(req, res, next) {
  if (!req.session.user) {
    setFlash(req, "error", "РўСЂРµР±СѓРµС‚СЃСЏ РІС…РѕРґ РІ СЃРёСЃС‚РµРјСѓ.");
    return res.redirect("/login");
  }
  return next();
}

function isAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    setFlash(req, "error", "Р”РѕСЃС‚СѓРї С‚РѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°.");
    return res.redirect("/");
  }
  return next();
}

function normalizeQuestionType(value) {
  if (value === "single" || value === "multi" || value === "scale" || value === "text") return value;
  return "text";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
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
    setFlash(req, "error", "РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕР»СЏ. РџР°СЂРѕР»СЊ РјРёРЅРёРјСѓРј 6 СЃРёРјРІРѕР»РѕРІ.");
    return res.redirect("/register");
  }

  const exists = await get("SELECT id FROM users WHERE email = ? OR username = ?", [email, username]);
  if (exists) {
    setFlash(req, "error", "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ С‚Р°РєРёРј email РёР»Рё username СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚.");
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
  setFlash(req, "success", "Р РµРіРёСЃС‚СЂР°С†РёСЏ СѓСЃРїРµС€РЅР°.");
  req.session.save(() => res.redirect("/surveys"));
});

app.get("/login", (_req, res) => res.render("auth/login"));
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
    setFlash(req, "error", "Р’Р°С€ Р°РєРєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    setFlash(req, "error", "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ.");
    return res.redirect("/login");
  }

  req.session.user = { id: user.id, username: user.username, email: user.email, is_admin: !!user.is_admin };
  setFlash(req, "success", "Р’С…РѕРґ РІС‹РїРѕР»РЅРµРЅ.");
  req.session.save(() => res.redirect("/surveys"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

app.get("/surveys", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const params = [];
  const where = [];
  if (q) {
    where.push("(LOWER(s.title) LIKE LOWER(?) OR LOWER(s.description) LIKE LOWER(?) OR CAST(s.id AS TEXT) = ?)");
    params.push(`%${q}%`, `%${q}%`, q);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const surveys = await all(
    `
    SELECT s.*, u.username,
      (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS responses_count,
      (SELECT COUNT(*) FROM survey_comments cm WHERE cm.survey_id = s.id) AS comments_count
    FROM surveys s
    JOIN users u ON u.id = s.user_id
    ${whereClause}
    ORDER BY s.created_at DESC
    `,
    params
  );

  res.render("surveys/index", { surveys, q });
});

app.get("/surveys/new", isAuthenticated, (_req, res) => {
  res.render("surveys/new");
});

app.post("/surveys", isAuthenticated, upload.any(), async (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 160);
  const description = String(req.body.description || "").trim().slice(0, 4000);
  const endAt = String(req.body.end_at || "");
  const hasDeadline = !!req.body.has_deadline;
  const isAnonymous = !!req.body.is_anonymous;

  const rawQuestionTexts = Array.isArray(req.body.question_texts) ? req.body.question_texts : [req.body.question_texts];
  const rawQuestionTypes = Array.isArray(req.body.question_types) ? req.body.question_types : [req.body.question_types];
  const rawQuestionRequired = Array.isArray(req.body.question_required) ? req.body.question_required : [req.body.question_required];
  const rawQuestionOptions = Array.isArray(req.body.question_options) ? req.body.question_options : [req.body.question_options];
  const rawQuestionNextOrders = Array.isArray(req.body.question_next_orders)
    ? req.body.question_next_orders
    : [req.body.question_next_orders];

  if (!title || !description) {
    setFlash(req, "error", "Р—Р°РїРѕР»РЅРёС‚Рµ РІСЃРµ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ.");
    return res.redirect("/surveys/new");
  }

  let endDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10);
  if (hasDeadline) {
    endDate = new Date(endAt);
  }
  if (hasDeadline && (Number.isNaN(endDate.getTime()) || endDate <= new Date())) {
    setFlash(req, "error", "Р”Р°С‚Р° РѕРєРѕРЅС‡Р°РЅРёСЏ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РІ Р±СѓРґСѓС‰РµРј.");
    return res.redirect("/surveys/new");
  }
  let miscCategory = await get("SELECT id FROM categories WHERE slug = ?", ["misc"]);
  if (!miscCategory) {
    const inserted = await run("INSERT INTO categories (name, slug) VALUES (?, ?) RETURNING id", ["Разное", "misc"]);
    miscCategory = { id: inserted.rows[0].id };
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
      setFlash(req, "error", `РЈ РІРѕРїСЂРѕСЃР° "${questionText}" РЅСѓР¶РЅРѕ РјРёРЅРёРјСѓРј 2 РІР°СЂРёР°РЅС‚Р°.`);
      return res.redirect("/surveys/new");
    }

    questions.push({
      questionText,
      questionType,
      isRequired: rawQuestionRequired[i] === "on" || rawQuestionRequired[i] === "1",
      options: optionsLines,
      nextQuestionOrder: Number(rawQuestionNextOrders[i] || 0) || null
    });
  }

  if (!questions.length) {
    setFlash(req, "error", "Р”РѕР±Р°РІСЊС‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРёРЅ РІРѕРїСЂРѕСЃ.");
    return res.redirect("/surveys/new");
  }

  for (let i = 0; i < questions.length; i += 1) {
    const nextOrder = questions[i].nextQuestionOrder;
    if (!nextOrder) continue;
    if (nextOrder <= i + 1 || nextOrder > questions.length) {
      setFlash(req, "error", "Invalid branching rule.");
      return res.redirect("/surveys/new");
    }
  }

  const allFiles = Array.isArray(req.files) ? req.files : [];
  const coverFile =
    allFiles.find((file) => file.fieldname === "cover" && file.mimetype.startsWith("image/")) ||
    allFiles.find((file) => file.mimetype.startsWith("image/")) ||
    null;

  const mediaFiles = allFiles
    .filter((file) => file.fieldname === "media" || file.fieldname === "media[]")
    .filter((file) => file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/"));

  const createdSurvey = await run(
    `
    INSERT INTO surveys (user_id, category_id, title, description, cover_path, end_at, has_deadline, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
    `,
    [
      req.session.user.id,
      miscCategory.id,
      title,
      description,
      coverFile ? `/uploads/${coverFile.filename}` : null,
      endDate.toISOString(),
      hasDeadline,
      isAnonymous
    ]
  );

  const surveyId = createdSurvey.rows[0].id;

  for (let i = 0; i < mediaFiles.length; i += 1) {
    const file = mediaFiles[i];
    await run(
      "INSERT INTO survey_media (survey_id, media_type, path, sort_order) VALUES (?, ?, ?, ?)",
      [surveyId, file.mimetype.startsWith("video/") ? "video" : "image", `/uploads/${file.filename}`, i]
    );
  }

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const createdQuestion = await run(
      `
      INSERT INTO survey_questions (survey_id, question_text, question_type, is_required, next_question_order, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
      `,
      [surveyId, q.questionText, q.questionType, q.isRequired, q.nextQuestionOrder, i]
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

  setFlash(req, "success", "Submitted.");
  res.redirect(`/surveys/${surveyId}`);
});

app.get("/surveys/:id", async (req, res) => {
  const survey = await get(
    `
    SELECT s.*, u.username
    FROM surveys s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
    `,
    [req.params.id]
  );
  if (!survey) return res.status(404).render("404");

  const media = await all(
    "SELECT * FROM survey_media WHERE survey_id = ? ORDER BY sort_order, id",
    [survey.id]
  );
  survey.images = media.filter((item) => item.media_type === "image");
  survey.videos = media.filter((item) => item.media_type === "video");

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
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;

  res.render("surveys/show", {
    survey,
    questions,
    comments,
    hasResponded,
    questionStats,
    responsesCount: Number(responsesCount.total || 0),
    baseUrl
  });
});

app.get("/surveys/:id/results.csv", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = await get("SELECT id, user_id, title, is_anonymous FROM surveys WHERE id = ?", [surveyId]);
  if (!survey) return res.status(404).render("404");

  const isOwner = req.session.user.id === Number(survey.user_id);
  if (!isOwner && !req.session.user.is_admin) {
    setFlash(req, "error", "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰РµРЅ.");
    return res.redirect(`/surveys/${surveyId}`);
  }

  const questions = await all(
    "SELECT id, question_text, question_type FROM survey_questions WHERE survey_id = ? ORDER BY sort_order, id",
    [surveyId]
  );
  const responses = await all(
    `
    SELECT r.id, r.created_at, u.username
    FROM survey_responses r
    JOIN users u ON u.id = r.user_id
    WHERE r.survey_id = ?
    ORDER BY r.id
    `,
    [surveyId]
  );
  const answers = await all(
    `
    SELECT a.response_id, a.question_id, a.text_value, a.number_value, o.option_text
    FROM survey_answers a
    LEFT JOIN survey_question_options o ON o.id = a.option_id
    WHERE a.response_id = ANY(?::int[])
    ORDER BY a.response_id, a.question_id, a.id
    `,
    [responses.map((r) => r.id).length ? responses.map((r) => r.id) : [0]]
  );

  const answerMap = new Map();
  for (const answer of answers) {
    const key = `${answer.response_id}:${answer.question_id}`;
    if (!answerMap.has(key)) answerMap.set(key, []);
    if (answer.option_text) answerMap.get(key).push(answer.option_text);
    else if (answer.text_value) answerMap.get(key).push(answer.text_value);
    else if (answer.number_value !== null && answer.number_value !== undefined) answerMap.get(key).push(String(answer.number_value));
  }

  const header = ["response_id", "respondent", "submitted_at", ...questions.map((q) => q.question_text)];
  const lines = [header.map(csvEscape).join(",")];

  for (const responseRow of responses) {
    const row = [
      responseRow.id,
      survey.is_anonymous ? "hidden" : responseRow.username,
      responseRow.created_at
    ];
    for (const question of questions) {
      const key = `${responseRow.id}:${question.id}`;
      row.push((answerMap.get(key) || []).join(" | "));
    }
    lines.push(row.map(csvEscape).join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"survey-${surveyId}-results.csv\"`);
  res.send(lines.join("\n"));
});

app.get("/surveys/:id/thanks", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = await get("SELECT id, title FROM surveys WHERE id = ?", [surveyId]);
  if (!survey) return res.status(404).render("404");

  const responseRow = await get("SELECT id, created_at FROM survey_responses WHERE survey_id = ? AND user_id = ?", [
    surveyId,
    req.session.user.id
  ]);
  if (!responseRow) return res.redirect(`/surveys/${surveyId}`);

  res.render("surveys/thanks", { survey, responseRow });
});

app.get("/surveys/:id/analytics", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = await get("SELECT id, user_id, title FROM surveys WHERE id = ?", [surveyId]);
  if (!survey) return res.status(404).render("404");

  const isOwner = req.session.user.id === Number(survey.user_id);
  if (!isOwner && !req.session.user.is_admin) {
    setFlash(req, "error", "Access denied.");
    return res.redirect(`/surveys/${surveyId}`);
  }

  const questions = await all(
    "SELECT id, question_text, question_type FROM survey_questions WHERE survey_id = ? ORDER BY sort_order, id",
    [surveyId]
  );
  const totalResponsesRow = await get("SELECT COUNT(*)::int AS total FROM survey_responses WHERE survey_id = ?", [surveyId]);
  const totalResponses = Number(totalResponsesRow?.total || 0);

  const analytics = [];
  for (const question of questions) {
    if (question.question_type === "single" || question.question_type === "multi") {
      const options = await all(
        `
        SELECT o.id, o.option_text, COUNT(a.id)::int AS votes
        FROM survey_question_options o
        LEFT JOIN survey_answers a ON a.option_id = o.id
        WHERE o.question_id = ?
        GROUP BY o.id, o.option_text
        ORDER BY o.sort_order, o.id
        `,
        [question.id]
      );
      analytics.push({ ...question, options });
      continue;
    }

    if (question.question_type === "scale") {
      const avgRow = await get(
        "SELECT AVG(number_value)::float AS avg_score, COUNT(*)::int AS answers_count FROM survey_answers WHERE question_id = ? AND number_value IS NOT NULL",
        [question.id]
      );
      const bucketsRaw = await all(
        `
        SELECT number_value::int AS score, COUNT(*)::int AS count
        FROM survey_answers
        WHERE question_id = ? AND number_value IS NOT NULL
        GROUP BY number_value
        ORDER BY number_value
        `,
        [question.id]
      );
      const bucketMap = new Map(bucketsRaw.map((r) => [Number(r.score), Number(r.count)]));
      const buckets = [1, 2, 3, 4, 5].map((score) => ({ score, count: bucketMap.get(score) || 0 }));
      analytics.push({
        ...question,
        avg_score: avgRow?.avg_score ? Number(avgRow.avg_score).toFixed(2) : "0.00",
        answers_count: Number(avgRow?.answers_count || 0),
        buckets
      });
      continue;
    }

    const textAnswers = await all(
      `
      SELECT a.text_value, r.created_at, u.username
      FROM survey_answers a
      JOIN survey_responses r ON r.id = a.response_id
      JOIN users u ON u.id = r.user_id
      WHERE a.question_id = ? AND COALESCE(TRIM(a.text_value), '') <> ''
      ORDER BY a.created_at DESC
      LIMIT 20
      `,
      [question.id]
    );
    analytics.push({ ...question, textAnswers });
  }

  res.render("surveys/analytics", { survey, analytics, totalResponses });
});

app.post("/surveys/:id/respond", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = await get("SELECT id, end_at, has_deadline FROM surveys WHERE id = ?", [surveyId]);
  if (!survey) return res.status(404).render("404");

  if (survey.has_deadline && new Date(survey.end_at) <= new Date()) {
    setFlash(req, "error", "РЎСЂРѕРє Р°РЅРєРµС‚РёСЂРѕРІР°РЅРёСЏ РёСЃС‚РµРє.");
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
    setFlash(req, "error", "Р’С‹ СѓР¶Рµ РѕС‚РїСЂР°РІР»СЏР»Рё РѕС‚РІРµС‚С‹ РІ СЌС‚РѕР№ Р°РЅРєРµС‚Рµ.");
    return res.redirect(`/surveys/${surveyId}`);
  }

  const responseId = responseRow.rows[0].id;
  const skippedQuestionIds = new Set();

  const applyBranching = (questionIndex, hasAnswer) => {
    const question = questions[questionIndex];
    if (!hasAnswer || !question.next_question_order) return;
    const targetIndex = Number(question.next_question_order) - 1;
    if (Number.isNaN(targetIndex) || targetIndex <= questionIndex || targetIndex >= questions.length) return;
    for (let idx = questionIndex + 1; idx < targetIndex; idx += 1) {
      skippedQuestionIds.add(questions[idx].id);
    }
  };

  for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
    const question = questions[questionIndex];
    if (skippedQuestionIds.has(question.id)) continue;

    const key = `q_${question.id}`;
    const value = req.body[key];

    if (question.question_type === "text") {
      const textValue = String(value || "").trim();
      if (question.is_required && !textValue) {
        setFlash(req, "error", "Р—Р°РїРѕР»РЅРёС‚Рµ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (textValue) {
        await run("INSERT INTO survey_answers (response_id, question_id, text_value) VALUES (?, ?, ?)", [responseId, question.id, textValue]);
      }
      applyBranching(questionIndex, !!textValue);
      continue;
    }

    if (question.question_type === "scale") {
      const num = Number(value);
      if (question.is_required && !value) {
        setFlash(req, "error", "Р—Р°РїРѕР»РЅРёС‚Рµ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value && (Number.isNaN(num) || num < 1 || num > 5)) {
        setFlash(req, "error", "РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ С€РєР°Р»С‹.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value) {
        await run("INSERT INTO survey_answers (response_id, question_id, number_value) VALUES (?, ?, ?)", [responseId, question.id, num]);
      }
      applyBranching(questionIndex, !!value);
      continue;
    }

    const allowed = new Set(optionsByQuestion[question.id].map((o) => Number(o.id)));
    if (question.question_type === "single") {
      const optionId = Number(value);
      if (question.is_required && !value) {
        setFlash(req, "error", "Р—Р°РїРѕР»РЅРёС‚Рµ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value && !allowed.has(optionId)) {
        setFlash(req, "error", "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РІР°СЂРёР°РЅС‚ РѕС‚РІРµС‚Р°.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      if (value) {
        await run("INSERT INTO survey_answers (response_id, question_id, option_id) VALUES (?, ?, ?)", [responseId, question.id, optionId]);
      }
      applyBranching(questionIndex, !!value);
      continue;
    }

    const rawValues = Array.isArray(value) ? value : value ? [value] : [];
    if (question.is_required && !rawValues.length) {
      setFlash(req, "error", "Р—Р°РїРѕР»РЅРёС‚Рµ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ.");
      return res.redirect(`/surveys/${surveyId}`);
    }
    for (const raw of rawValues) {
      const optionId = Number(raw);
      if (!allowed.has(optionId)) {
        setFlash(req, "error", "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РІР°СЂРёР°РЅС‚ РѕС‚РІРµС‚Р°.");
        return res.redirect(`/surveys/${surveyId}`);
      }
      await run("INSERT INTO survey_answers (response_id, question_id, option_id) VALUES (?, ?, ?)", [responseId, question.id, optionId]);
    }
    applyBranching(questionIndex, rawValues.length > 0);
  }

  setFlash(req, "success", "Submitted.");
  res.redirect(`/surveys/${surveyId}/thanks`);
});

app.post("/surveys/:id/comments", isAuthenticated, async (req, res) => {
  const surveyId = Number(req.params.id);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  if (!body) {
    setFlash(req, "error", "РљРѕРјРјРµРЅС‚Р°СЂРёР№ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј.");
    return res.redirect(`/surveys/${surveyId}`);
  }
  await run("INSERT INTO survey_comments (survey_id, user_id, body) VALUES (?, ?, ?)", [surveyId, req.session.user.id, body]);
  setFlash(req, "success", "Comment added.");
  res.redirect(`/surveys/${surveyId}`);
});

app.post("/reports", isAuthenticated, async (req, res) => {
  const surveyId = req.body.survey_id ? Number(req.body.survey_id) : null;
  const commentId = req.body.comment_id ? Number(req.body.comment_id) : null;
  const reason = String(req.body.reason || "").trim().slice(0, 300);
  if (!reason || (!surveyId && !commentId)) {
    setFlash(req, "error", "РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ Р¶Р°Р»РѕР±Р°.");
    return res.redirect("/surveys");
  }

  await run("INSERT INTO reports (reporter_id, survey_id, comment_id, reason) VALUES (?, ?, ?, ?)", [
    req.session.user.id,
    surveyId,
    commentId,
    reason
  ]);
  setFlash(req, "success", "Р–Р°Р»РѕР±Р° РѕС‚РїСЂР°РІР»РµРЅР°.");
  res.redirect(req.get("Referrer") || "/surveys");
});

app.get("/me", isAuthenticated, (req, res) => res.redirect(`/profile/${req.session.user.id}`));
app.get("/me/responses", isAuthenticated, async (req, res) => {
  const responses = await all(
    `
    SELECT r.created_at, s.id AS survey_id, s.title
    FROM survey_responses r
    JOIN surveys s ON s.id = r.survey_id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
    `,
    [req.session.user.id]
  );
  res.render("responses", { responses });
});

app.get("/me/edit", isAuthenticated, async (req, res) => {
  const user = await get("SELECT id, username, email, bio, avatar_path FROM users WHERE id = ?", [req.session.user.id]);
  res.render("edit-profile", { user });
});

app.post("/me/edit", isAuthenticated, upload.single("avatar"), async (req, res) => {
  const bio = String(req.body.bio || "").trim().slice(0, 500);
  const user = await get("SELECT avatar_path FROM users WHERE id = ?", [req.session.user.id]);
  const avatarPath = req.file ? `/uploads/${req.file.filename}` : user.avatar_path || null;
  await run("UPDATE users SET bio = ?, avatar_path = ? WHERE id = ?", [bio, avatarPath, req.session.user.id]);
  setFlash(req, "success", "РџСЂРѕС„РёР»СЊ РѕР±РЅРѕРІР»РµРЅ.");
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
    setFlash(req, "error", "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ.");
    return res.redirect("/admin");
  }
  if (user.is_admin) {
    setFlash(req, "error", "РќРµР»СЊР·СЏ Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°.");
    return res.redirect("/admin");
  }
  await run("UPDATE users SET is_banned = ? WHERE id = ?", [!user.is_banned, req.params.id]);
  setFlash(req, "success", user.is_banned ? "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЂР°Р·Р±Р°РЅРµРЅ." : "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р·Р°Р±Р°РЅРµРЅ.");
  res.redirect("/admin");
});

app.post("/admin/surveys/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM surveys WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "РђРЅРєРµС‚Р° СѓРґР°Р»РµРЅР°.");
  res.redirect("/admin");
});

app.post("/admin/comments/:id/delete", isAdmin, async (req, res) => {
  await run("DELETE FROM survey_comments WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "РљРѕРјРјРµРЅС‚Р°СЂРёР№ СѓРґР°Р»РµРЅ.");
  res.redirect("/admin");
});

app.post("/admin/reports/:id/resolve", isAdmin, async (req, res) => {
  await run("UPDATE reports SET status = 'resolved' WHERE id = ?", [req.params.id]);
  setFlash(req, "success", "Р–Р°Р»РѕР±Р° РѕР±СЂР°Р±РѕС‚Р°РЅР°.");
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









