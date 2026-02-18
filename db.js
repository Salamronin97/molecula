const { Pool } = require("pg");

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  const useSsl = process.env.NODE_ENV === "production";

  if (connectionString) {
    return {
      connectionString: connectionString.trim(),
      ssl: useSsl ? { rejectUnauthorized: false } : false
    };
  }

  const host = process.env.PGHOST;
  const port = Number(process.env.PGPORT || 5432);
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = String(process.env.PGPASSWORD || "");

  if (!host || !database || !user) {
    throw new Error("DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD must be set");
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  };
}

const pool = new Pool(buildPoolConfig());

function toPgSql(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => {
    idx += 1;
    return `$${idx}`;
  });
}

async function run(sql, params = []) {
  return pool.query(toPgSql(sql), params);
}

async function get(sql, params = []) {
  const result = await pool.query(toPgSql(sql), params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await pool.query(toPgSql(sql), params);
  return result.rows;
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar_path TEXT,
      is_admin BOOLEAN DEFAULT FALSE,
      is_banned BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      group_name TEXT DEFAULT 'Разное',
      sort_order INTEGER DEFAULT 0,
      is_enabled BOOLEAN DEFAULT TRUE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS polls (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      image_path TEXT,
      video_path TEXT,
      end_at TIMESTAMPTZ NOT NULL,
      is_anonymous BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id SERIAL PRIMARY KEY,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      option_text TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (poll_id, user_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
      comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, poll_id)
    )
  `);

  await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT");
  await run("ALTER TABLE polls ADD COLUMN IF NOT EXISTS video_path TEXT");
  await run("ALTER TABLE categories ADD COLUMN IF NOT EXISTS group_name TEXT DEFAULT 'Разное'");
  await run("ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0");
  await run("ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE");

  const defaultCategories = [
    { group: "Разное", slug: "soc", name: "/soc/ - общение", order: 3 },
    { group: "Политика", slug: "int", name: "/int/ - international", order: 11 },
    { group: "Политика", slug: "po", name: "/po/ - политика", order: 12 },
    { group: "Политика", slug: "news", name: "/news/ - новости", order: 13 },
    { group: "Тематика", slug: "au", name: "/au/ - автомобили и транспорт", order: 20 },
    { group: "Тематика", slug: "bi", name: "/bi/ - велосипеды", order: 21 },
    { group: "Тематика", slug: "biz", name: "/biz/ - бизнес", order: 22 },
    { group: "Тематика", slug: "bo", name: "/bo/ - книги", order: 23 },
    { group: "Тематика", slug: "cc", name: "/cc/ - комиксы и мультфильмы", order: 24 },
    { group: "Тематика", slug: "c", name: "/c/ - криптовалюты", order: 25 },
    { group: "Тематика", slug: "em", name: "/em/ - другие страны и туризм", order: 26 },
    { group: "Тематика", slug: "fa", name: "/fa/ - мода и стиль", order: 27 },
    { group: "Тематика", slug: "fiz", name: "/fiz/ - физкультура", order: 28 },
    { group: "Тематика", slug: "fl", name: "/fl/ - иностранные языки", order: 29 },
    { group: "Тематика", slug: "ftb", name: "/ftb/ - футбол", order: 30 },
    { group: "Тематика", slug: "hh", name: "/hh/ - hip-hop", order: 31 },
    { group: "Тематика", slug: "hi", name: "/hi/ - история", order: 32 },
    { group: "Тематика", slug: "me", name: "/me/ - медицина", order: 33 },
    { group: "Тематика", slug: "mg", name: "/mg/ - магия", order: 34 },
    { group: "Тематика", slug: "mo", name: "/mo/ - мотоциклы", order: 36 },
    { group: "Тематика", slug: "mov", name: "/mov/ - фильмы", order: 37 },
    { group: "Тематика", slug: "mu", name: "/mu/ - музыка", order: 38 },
    { group: "Тематика", slug: "ne", name: "/ne/ - животные и природа", order: 39 },
    { group: "Тематика", slug: "psy", name: "/psy/ - психология", order: 40 },
    { group: "Тематика", slug: "re", name: "/re/ - религия", order: 41 },
    { group: "Тематика", slug: "sci", name: "/sci/ - наука", order: 42 },
    { group: "Тематика", slug: "sf", name: "/sf/ - научная фантастика", order: 43 },
    { group: "Тематика", slug: "sn", name: "/sn/ - паранормальные явления", order: 44 },
    { group: "Тематика", slug: "sp", name: "/sp/ - спорт", order: 45 },
    { group: "Тематика", slug: "spc", name: "/spc/ - космос и астрономия", order: 46 },
    { group: "Тематика", slug: "tv", name: "/tv/ - тв и кино", order: 47 },
    { group: "Тематика", slug: "un", name: "/un/ - образование", order: 48 },
    { group: "Тематика", slug: "w", name: "/w/ - оружие", order: 49 },
    { group: "Тематика", slug: "wm", name: "/wm/ - военная техника", order: 51 },
    { group: "Творчество", slug: "de", name: "/de/ - дизайн", order: 60 },
    { group: "Творчество", slug: "di", name: "/di/ - столовая", order: 61 },
    { group: "Творчество", slug: "diy", name: "/diy/ - хобби", order: 62 },
    { group: "Творчество", slug: "izd", name: "/izd/ - графомания", order: 63 },
    { group: "Творчество", slug: "mus", name: "/mus/ - музыканты", order: 64 },
    { group: "Творчество", slug: "pa", name: "/pa/ - живопись", order: 65 },
    { group: "Творчество", slug: "p", name: "/p/ - фото", order: 66 },
    { group: "Творчество", slug: "wrk", name: "/wrk/ - работа и карьера", order: 67 },
    { group: "Творчество", slug: "trv", name: "/trv/ - путешествия", order: 68 },
    { group: "Техника и софт", slug: "ai", name: "/ai/ - искусственный интеллект", order: 80 },
    { group: "Техника и софт", slug: "gd", name: "/gd/ - gamedev", order: 81 },
    { group: "Техника и софт", slug: "hw", name: "/hw/ - компьютерное железо", order: 82 },
    { group: "Техника и софт", slug: "mobi", name: "/mobi/ - мобильные устройства и приложения", order: 83 },
    { group: "Техника и софт", slug: "pr", name: "/pr/ - программирование", order: 84 },
    { group: "Техника и софт", slug: "ra", name: "/ra/ - радиотехника", order: 85 },
    { group: "Техника и софт", slug: "s", name: "/s/ - программы", order: 86 },
    { group: "Техника и софт", slug: "t", name: "/t/ - техника", order: 87 },
    { group: "Игры", slug: "bg", name: "/bg/ - настольные игры", order: 100 },
    { group: "Игры", slug: "cg", name: "/cg/ - консоли", order: 101 },
    { group: "Игры", slug: "gacha", name: "/gacha/ - гача-игры", order: 103 },
    { group: "Игры", slug: "v", name: "/v/ - video games", order: 107 },
    { group: "Игры", slug: "vg", name: "/vg/ - video games general", order: 108 },
    { group: "Игры", slug: "wr", name: "/wr/ - текстовые авторские рпг", order: 109 },
    { group: "Японская культура", slug: "a", name: "/a/ - аниме", order: 120 },
    { group: "Японская культура", slug: "fd", name: "/fd/ - фэндом", order: 121 },
    { group: "Японская культура", slug: "ja", name: "/ja/ - японская культура", order: 122 },
    { group: "Японская культура", slug: "ma", name: "/ma/ - манга", order: 123 }
  ];

  for (const category of defaultCategories) {
    await run(
      `
      INSERT INTO categories (name, slug, group_name, sort_order, is_enabled)
      VALUES (?, ?, ?, ?, TRUE)
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        group_name = EXCLUDED.group_name,
        sort_order = EXCLUDED.sort_order,
        is_enabled = TRUE
      `,
      [category.name, category.slug, category.group, category.order]
    );
  }

  const blockedSlugs = [
    "b",
    "o",
    "media",
    "api",
    "rf",
    "r",
    "muz",
    "ai-new",
    "neurofap",
    "hry",
    "wh",
    "wp",
    "zog",
    "mlp",
    "web",
    "es",
    "gsg",
    "vn",
    "vnj",
    "tes",
    "fur",
    "gg",
    "vape",
    "h",
    "ho",
    "hc",
    "e",
    "fet",
    "sex",
    "fag"
  ];

  await run("UPDATE categories SET is_enabled = FALSE WHERE slug = ANY(?::text[])", [blockedSlugs]);
}

module.exports = {
  pool,
  run,
  get,
  all,
  initDb
};
