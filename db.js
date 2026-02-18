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
    throw new Error(
      "DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD must be set"
    );
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
      is_admin BOOLEAN DEFAULT FALSE,
      is_banned BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
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

  const defaultCategories = [
    { name: "Технологии", slug: "technology" },
    { name: "Кино и сериалы", slug: "movies" },
    { name: "Игры", slug: "games" },
    { name: "Общество", slug: "society" },
    { name: "Образование", slug: "education" }
  ];

  for (const category of defaultCategories) {
    await run(
      "INSERT INTO categories (name, slug) VALUES (?, ?) ON CONFLICT (slug) DO NOTHING",
      [category.name, category.slug]
    );
  }
}

module.exports = {
  pool,
  run,
  get,
  all,
  initDb
};
