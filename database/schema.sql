-- ============================================================
-- Barbearia — Modelagem do banco (SQLite)
-- Tabelas: usuarios, profissionais, servicos,
--          horarios_funcionamento, bloqueios, agendamentos
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'barbeiro'
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profissionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  apelido TEXT,
  foto_url TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT DEFAULT '',
  preco_centavos INTEGER NOT NULL,   -- ex: 4500 = R$ 45,00
  duracao_min INTEGER NOT NULL,      -- ex: 30, 50
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Um registro por dia da semana: 0=domingo ... 6=sábado
CREATE TABLE IF NOT EXISTS horarios_funcionamento (
  dia_semana INTEGER PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),
  aberto INTEGER NOT NULL DEFAULT 1,
  abertura TEXT NOT NULL DEFAULT '09:00',  -- HH:MM
  fechamento TEXT NOT NULL DEFAULT '19:00',
  almoco_inicio TEXT DEFAULT '12:00',      -- pode ser NULL
  almoco_fim TEXT DEFAULT '13:00'
);

CREATE TABLE IF NOT EXISTS bloqueios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,            -- 'YYYY-MM-DD' (dia todo) ...
  hora_inicio TEXT,              -- ... ou intervalo 'HH:MM'
  hora_fim TEXT,                 -- ... até 'HH:MM'
  motivo TEXT DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  servico_id INTEGER NOT NULL REFERENCES servicos(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  data TEXT NOT NULL,            -- 'YYYY-MM-DD'
  hora TEXT NOT NULL,            -- 'HH:MM' (início)
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  cliente_email TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmado',
  -- confirmado | concluido | cancelado
  observacao TEXT DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profissional_id, data, hora) -- evita choque de horário
);

CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(data);
CREATE INDEX IF NOT EXISTS idx_ag_status ON agendamentos(status);
