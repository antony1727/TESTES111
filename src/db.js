/**
 * db.js — Camada de acesso ao banco de dados.
 * ----------------------------------------------------------------------------
 * RESPONSABILIDADE: abrir (ou criar) o arquivo SQLite e garantir que todas
 * as tabelas existam, aplicando o schema de `database/schema.sql`.
 *
 * COMO FUNCIONA:
 *  1. `better-sqlite3` abre o arquivo `barbercode.db` na raiz do projeto.
 *     Se o arquivo não existir, ele é CRIADO vazio automaticamente.
 *  2. Lemos o `schema.sql` e executamos com `db.exec()`. Como todo
 *     CREATE usa `IF NOT EXISTS`, rodar de novo é SEGURO (idempotente):
 *     tabelas já criadas são simplesmente ignoradas.
 *  3. Exportamos a instância `db` (singleton): todos os arquivos que fazem
 *     `require('./db')` compartilham a MESMA conexão. O better-sqlite3 é
 *     síncrono, então não há callbacks/promises aqui — `db.prepare().get()`
 *     retorna o resultado direto.
 *
 * CONFIGURAÇÃO:
 *  • DB_PATH pode ser sobrescrito pela variável de ambiente DB_PATH
 *    (útil em deploy com disco persistente).
 *  • `journal_mode = WAL` = modo de escrita mais rápido e seguro contra
 *    travamentos quando há leituras e escritas ao mesmo tempo.
 *  • `foreign_keys = ON` = o SQLite passa a respeitar os REFERENCES
 *    declarados no schema (por padrão ele ignoraria).
 */
const fs = require('fs'); // para ler o arquivo schema.sql do disco
const path = require('path'); // para montar caminhos que funcionam em qualquer SO
const Database = require('better-sqlite3'); // driver SQLite síncrono e rápido

// Caminho do arquivo do banco. Ex.: .../PROJETO-TESTE/barbercode.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'barbercode.db');
// Caminho do script SQL com todas as tabelas.
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

// Abre (ou cria) o banco. A partir daqui a conexão fica aberta até o node sair.
const db = new Database(DB_PATH);
// WAL = melhor desempenho e menos "database is locked" sob concorrência leve.
db.pragma('journal_mode = WAL');
// Liga a checagem de chaves estrangeiras (REFERENCES do schema).
db.pragma('foreign_keys = ON');

// Lê o schema.sql como texto e executa todas as instruções de uma vez.
// Idempotente: pode rodar a cada boot sem duplicar nada.
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Exporta a conexão única para o resto do backend usar.
module.exports = db;
