/**
 * db.js — Camada de acesso ao banco (PostgreSQL).
 * ----------------------------------------------------------------------------
 * POR QUE POSTGRES? O SQLite em disco não serve no plano grátis do Render:
 * o disco é temporário e os agendamentos se perderiam a cada restart/deploy.
 * Um Postgres hospedado (Neon, grátis) guarda os dados de verdade.
 *
 * DOIS MODOS, MESMO CÓDIGO:
 *  • PRODUÇÃO — define a variável DATABASE_URL (string do Neon). Usa o driver
 *    `pg` com um pool de conexões.
 *  • DESENVOLVIMENTO/TESTE — sem DATABASE_URL, usa o PGlite: PostgreSQL real
 *    compilado para WebAssembly, rodando dentro do Node e gravando em
 *    `.data/pglite`. Assim você testa sem instalar Postgres nenhum.
 *
 * API EXPORTADA (tudo async, placeholders `?` — a conversão p/ `$1` é feita aqui):
 *  • init()                 → aplica o schema (idempotente)
 *  • all(sql, params)       → array de linhas
 *  • get(sql, params)       → primeira linha (ou undefined)
 *  • run(sql, params)       → { changes } (linhas afetadas)
 *  • transaction(async (q) => …) → tudo-ou-nada; `q` é a consulta na transação
 *  • fechar()               → encerra a conexão (usado em testes)
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config(); // carrega DATABASE_URL/PGLITE_DIR do .env

const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');
const DATABASE_URL = process.env.DATABASE_URL || '';

let modo;   // 'pg' (produção) | 'pglite' (local)
let pool;   // pool do driver pg
let pglite; // instância local do PGlite
let iniciado = false;

if (DATABASE_URL) {
  // ---------- PRODUÇÃO: Postgres hospedado (Neon/Supabase/Render) ----------
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5, // poucas conexões bastam para uma barbearia
    idleTimeoutMillis: 30000,
    // Neon/Supabase exigem TLS. A própria URL normalmente já traz sslmode=require.
    ssl: /sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  });
  modo = 'pg';
} else {
  // ---------- LOCAL: PGlite (Postgres em WASM, sem instalar nada) ----------
  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', '.data', 'pglite');
  fs.mkdirSync(dir, { recursive: true }); // garante que a pasta exista antes de abrir
  pglite = new PGlite(dir);
  modo = 'pglite';
}

/** Troca `?` por `$1, $2, …` (sintaxe de parâmetros do Postgres). */
function paraPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

/** Executa uma consulta e devolve { rows, rowCount } nos dois modos. */
async function consultar(sql, params = []) {
  const text = paraPostgres(sql);
  if (modo === 'pg') {
    const r = await pool.query(text, params);
    return { rows: r.rows, rowCount: r.rowCount };
  }
  const r = await pglite.query(text, params);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
}

/**
 * Aplica o schema. Todo CREATE usa IF NOT EXISTS, então rodar a cada boot é
 * seguro e NÃO apaga dados existentes.
 */
async function init() {
  if (iniciado) return;
  // Trava de segurança: em produção NÃO aceitamos PGlite (disco temporário no
  // Render apagaria os agendamentos). Sem DATABASE_URL, falha alto e claro.
  if (process.env.NODE_ENV === 'production' && modo !== 'pg') {
    throw new Error('[db] DATABASE_URL não configurada. Em produção use um Postgres (Neon grátis).');
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  if (modo === 'pg') await pool.query(schema); // multi-statement aceito pelo pg
  else await pglite.exec(schema);              // PGlite tem exec() multi-statement
  iniciado = true;
  console.log(`[db] pronto (${modo}${modo === 'pglite' ? ', local' : ', remoto'})`);
}

/** Todas as linhas de uma consulta. */
async function all(sql, params = []) {
  return (await consultar(sql, params)).rows;
}

/** Primeira linha (ou undefined se não houver resultado). */
async function get(sql, params = []) {
  return (await consultar(sql, params)).rows[0];
}

/** Executa uma escrita e devolve quantas linhas mudaram. */
async function run(sql, params = []) {
  return { changes: (await consultar(sql, params)).rowCount };
}

/**
 * Roda várias escritas em uma transação (tudo-ou-nada).
 * Uso:  await transaction(async (q) => { await q(sqlA, [1]); await q(sqlB, [2]); });
 */
async function transaction(fn) {
  if (modo === 'pg') {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const q = async (sql, params = []) => {
        const r = await cliente.query(paraPostgres(sql), params);
        return { rows: r.rows, rowCount: r.rowCount };
      };
      const resultado = await fn(q);
      await cliente.query('COMMIT');
      return resultado;
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }

  // PGlite: a instância é única, então BEGIN/COMMIT funcionam direto.
  await pglite.query('BEGIN');
  try {
    const q = async (sql, params = []) => {
      const r = await pglite.query(paraPostgres(sql), params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    };
    const resultado = await fn(q);
    await pglite.query('COMMIT');
    return resultado;
  } catch (erro) {
    await pglite.query('ROLLBACK');
    throw erro;
  }
}

/** Fecha a conexão (útil em scripts/testes). */
async function fechar() {
  if (modo === 'pg') await pool.end();
  else await pglite.close();
}

module.exports = { init, all, get, run, transaction, fechar, modo };
