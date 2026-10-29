-- ============================================================================
-- BARBER CODE — Modelagem do banco de dados (PostgreSQL)
-- ============================================================================
-- COMO LER ESTE ARQUIVO:
--   • Cada CREATE TABLE representa uma entidade do negócio.
--   • Os comentários acima de cada coluna explicam o formato esperado.
--   • Relacionamentos (chaves estrangeiras):
--
--       usuarios ─── (login do painel, sem vínculo direto com as demais)
--
--       servicos ──┐
--                  ├──► agendamentos ◄──┐
--       profissionais ──┘                │
--                                        │ (lógico, via data+hora)
--       horarios_funcionamento ───────────┤
--       bloqueios ────────────────────────┘
--
--   • "agendamentos" é a tabela central: cada linha = 1 horário reservado.
--   • Preços são guardados em CENTAVOS (inteiro) para evitar erro de
--     arredondamento de ponto flutuante. Ex.: 4500 = R$ 45,00.
--   • Datas usam TEXTO no formato ISO 'YYYY-MM-DD' e horas 'HH:MM'
--     (padrão que ordena alfabeticamente = ordena cronologicamente).
--   • Tudo usa IF NOT EXISTS: rodar a cada boot é seguro e não apaga dados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABELA: usuarios
-- Quem pode entrar no painel admin (/admin). O cliente NÃO precisa de conta:
-- ele agenda informando só nome + telefone.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,                -- identificador único (gerado sozinho)
  nome TEXT NOT NULL,                   -- nome de exibição ("Administrador")
  email TEXT NOT NULL UNIQUE,           -- login; UNIQUE impede 2 contas iguais
  senha_hash TEXT NOT NULL,             -- NUNCA a senha pura: hash bcrypt (ver src/seed.js)
  papel TEXT NOT NULL DEFAULT 'admin',  -- 'admin' (tudo) | 'barbeiro' (futuro: visão limitada)
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now() -- carimbo de criação (UTC)
);

-- ----------------------------------------------------------------------------
-- TABELA: profissionais
-- Os barbeiros que aparecem no Passo 2 do agendamento. Cada agendamento
-- pertence a UM profissional, e a agenda é controlada por profissional
-- (dois barbeiros podem atender no mesmo horário, sem conflito).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profissionais (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,              -- nome completo (exibido no painel)
  apelido TEXT,                    -- nome curto (exibido para o cliente escolher)
  foto_url TEXT,                   -- opcional: caminho/URL da foto (evolução futura)
  ativo INTEGER NOT NULL DEFAULT 1, -- 1 = aparece no site | 0 = oculto (sem apagar histórico)
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TABELA: servicos
-- Catálogo exibido na landing page e no Passo 1. A "duracao_min" é essencial:
-- é ela que diz quanto tempo cada agendamento ocupa na grade de horários.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,              -- ex.: "Combo Cabelo + Barba"
  descricao TEXT DEFAULT '',       -- texto curto de venda exibido no card
  preco_centavos INTEGER NOT NULL, -- ex.: 7000 = R$ 70,00 (ver BRL() no frontend)
  duracao_min INTEGER NOT NULL,    -- ex.: 30, 50 — bloqueia esse tempo na agenda
  ativo INTEGER NOT NULL DEFAULT 1,-- 1 = à venda | 0 = pausado (mantém histórico)
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TABELA: horarios_funcionamento
-- Expediente semanal. Existe EXATAMENTE 1 linha por dia da semana:
--   0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado.
-- O painel admin edita esses valores (PUT /api/admin/funcionamento) e o
-- cálculo de horários vagos (src/lib/disponibilidade.js) lê daqui.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horarios_funcionamento (
  dia_semana INTEGER PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),
  aberto INTEGER NOT NULL DEFAULT 1,         -- 1 = atende | 0 = fechado
  abertura TEXT NOT NULL DEFAULT '09:00',    -- hora que começa a atender (HH:MM)
  fechamento TEXT NOT NULL DEFAULT '19:00',  -- hora do ÚLTIMO término possível
  almoco_inicio TEXT DEFAULT '12:00',        -- início da pausa; NULL = sem pausa
  almoco_fim TEXT DEFAULT '13:00'            -- fim da pausa;    NULL = sem pausa
);

-- ----------------------------------------------------------------------------
-- TABELA: bloqueios
-- Exceções ao expediente: folgas, feriados, férias ou pausas pontuais.
-- Dois formatos:
--   1) DIA TODO: preencha só "data" (hora_inicio/hora_fim = NULL).
--   2) FAIXA: preencha "data" + "hora_inicio" + "hora_fim" (ex.: 14:00–16:00).
-- Criados pelo painel admin (POST /api/admin/bloqueios).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloqueios (
  id SERIAL PRIMARY KEY,
  data TEXT NOT NULL,     -- dia bloqueado, formato 'YYYY-MM-DD'
  hora_inicio TEXT,       -- NULL = dia todo; senão início da faixa 'HH:MM'
  hora_fim TEXT,          -- NULL = dia todo; senão fim da faixa 'HH:MM'
  motivo TEXT DEFAULT '', -- ex.: "Feriado", "Férias do Carlos"
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TABELA: agendamentos (a tabela central do sistema)
-- Cada linha = um cliente ocupando um horário de um profissional.
-- Regra antichoque em 2 camadas:
--   1) UNIQUE(profissional_id, data, hora) — o banco REJEITA 2 reservas
--      exatamente iguais (proteção contra clique duplo / condição de corrida).
--   2) Verificação de SOBREPOSIÇÃO em src/lib/disponibilidade.js — impede
--      reservas que se cruzam (ex.: combo de 50min às 10:30 bloqueia 11:00).
-- Status possíveis: 'confirmado' (aguardando) | 'concluido' (atendido, entra
-- no faturamento) | 'cancelado' (ignorado na grade e no faturamento).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agendamentos (
  id SERIAL PRIMARY KEY,
  servico_id INTEGER NOT NULL REFERENCES servicos(id),           -- o que será feito
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id), -- quem vai atender
  data TEXT NOT NULL,              -- dia do atendimento 'YYYY-MM-DD'
  hora TEXT NOT NULL,              -- hora de INÍCIO 'HH:MM'
  cliente_nome TEXT NOT NULL,      -- informado no Passo 4 (sem cadastro)
  cliente_telefone TEXT NOT NULL,  -- WhatsApp para confirmação/contato
  cliente_email TEXT DEFAULT '',   -- opcional
  status TEXT NOT NULL DEFAULT 'confirmado', -- confirmado | concluido | cancelado
  observacao TEXT DEFAULT '',      -- notas internas (alergia, preferência...)
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profissional_id, data, hora) -- camada 1 do antichoque (ver acima)
);

-- ----------------------------------------------------------------------------
-- ÍNDICES: aceleram as consultas mais frequentes do painel e da grade.
--   idx_ag_data   → "mostre a agenda do dia X" (WHERE data = ?)
--   idx_ag_status → "filtre por confirmado/concluído/cancelado"
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(data);
CREATE INDEX IF NOT EXISTS idx_ag_status ON agendamentos(status);
