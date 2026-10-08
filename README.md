# 💈 Barber Code — Site de Agendamento Online

> 🌐 **Domínio oficial:** `https://barbercode.app` (ver [Domínio próprio](#-domínio-próprio-barbercodeapp)).

Plataforma web completa (mobile-first, tema dark premium) com duas áreas:

| Área | URL | O que faz |
|---|---|---|
| **Cliente (pública)** | `/` | Vitrine de serviços + agendamento guiado em **5 passos** (serviço → profissional → data/hora → dados → confirmação com WhatsApp e `.ics`) |
| **Barbeiro/Admin (privada)** | `/admin` | Login JWT, **KPIs do dia** (clientes, faturamento estimado, próximo horário), **agenda com filtros e troca de status**, **expediente semanal** e **bloqueios** (folgas/feriados) |

> **Status:** funcional de ponta a ponta, sem build no frontend e sem banco externo (SQLite em arquivo). Pronto para rodar local e evoluir para Postgres/Supabase + notificações automáticas.

---

## 📑 Índice

1. [Stack e porquês](#-stack-e-porquês)
2. [Estrutura de pastas](#-estrutura-de-pastas)
3. [Como funciona (fluxos)](#-como-funciona-fluxos)
4. [Banco de dados (modelagem)](#-banco-de-dados-modelagem)
5. [Referência da API](#-referência-da-api)
6. [Rodando localmente](#-rodando-localmente)
7. [Testando na mão (cURL)](#-testando-na-mão-curl)
8. [Deploy](#-deploy)
9. [Configuração (.env)](#-configuração-env)
10. [Segurança](#-segurança)
11. [Problemas comuns](#-problemas-comuns)
12. [Evoluções sugeridas](#-evoluções-sugeridas)

---

## 🛠️ Stack e porquês

| Camada | Tecnologia | Por que ela |
|---|---|---|
| Frontend | **HTML + CSS + JS puro** (sem framework/build) | Zero compilação: qualquer hospedagem estática serve; fácil de ler e personalizar |
| Estilo | **CSS próprio** (`public/css/styles.css`) | Tema dark dourado mobile-first, sem dependência de CDN |
| Backend | **Node.js + Express** (`src/`) | API JSON simples + serve o próprio frontend (monolito barato de hospedar) |
| Banco | **SQLite** via `better-sqlite3` | Arquivo único, zero-config; consultas síncronas simples; migra fácil p/ Postgres depois |
| Auth | **JWT** (`jsonwebtoken`) + **bcryptjs** | Login sem sessão no servidor; senha só existe como hash |
| Utilidades | `cors`, `dotenv` | CORS p/ frontend separado; config via `.env` |

**Requisitos:** Node.js ≥ 18 (usa `fetch` nativo no backend? não — só no navegador; o backend usa apenas Express).

---

## 📁 Estrutura de pastas

```
PROJETO-TESTE/
├── database/
│   └── schema.sql            # Modelagem: 6 tabelas + índices (TODO comentado no arquivo)
├── src/                      # BACKEND (Node + Express)
│   ├── server.js             # Entrada: dotenv → db → seed → rotas → estáticos → listen
│   ├── db.js                 # Abre/cria barbercode.db e aplica o schema (singleton)
│   ├── seed.js               # Carga inicial idempotente (admin, barbeiros, serviços, Ter–Sáb)
│   ├── lib/
│   │   └── disponibilidade.js# ⭐ Cérebro da grade: calcula horários livres (6 regras)
│   ├── middleware/
│   │   └── auth.js           # Porteiro JWT das rotas /api/admin/*
│   └── routes/
│       ├── auth.js           # POST /api/auth/login
│       ├── public.js         # GET serviços/profissionais/disponibilidade + POST agendar
│       └── admin.js          # Resumo, agenda, status, expediente, bloqueios (tudo c/ JWT)
├── public/                   # FRONTEND (servido como arquivo estático)
│   ├── index.html            # Landing + wizard de 5 passos
│   ├── admin.html            # Login + KPIs + agenda + configurações
│   ├── css/styles.css        # Tema dark premium (variáveis em :root)
│   └── js/
│       ├── booking.js        # Lógica do wizard do cliente
│       └── admin.js          # Lógica do painel (token no localStorage)
├── package.json              # Scripts: start | dev (watch) | seed | init-db
├── package-lock.json          # Versões exatas das dependências
├── .env.example              # Modelo comentado → copiar para .env
├── .gitignore                # node_modules/, *.db, .env fora do git
└── README.md                 # Este arquivo
```

> Todo arquivo-fonte tem **comentários explicativos em português** no topo e nos trechos importantes — abra qualquer um e leia de cima para baixo.

---

## 🔄 Como funciona (fluxos)

### Agendamento do cliente (5 passos)

```
Passo 1: GET /api/servicos ──────► clica no serviço (state.servico)
Passo 2: GET /api/profissionais ─► clica no barbeiro (state.profissional)
Passo 3: GET /api/disponibilidade?data & ids ► clica no horário (state.data/hora)
Passo 4: digita nome + WhatsApp (+e-mail opcional)
Passo 5: POST /api/agendamentos ─► resumo + wa.me pronto + download .ics
```

### Cálculo de horários livres (`horariosVagos`, em `src/lib/disponibilidade.js`)

1. Lê o **expediente** do dia da semana (fechado → lista vazia).
2. Gera candidatos de **30 em 30 min**, exigindo que o serviço **caiba inteiro** antes de fechar.
3. Remove quem cruza o **almoço**, **bloqueios** e **atendimentos existentes** (com duração real via JOIN).
4. No dia de hoje, exige **30 min de antecedência**.
5. Na criação, o horário é **revalidado** + trava `UNIQUE(profissional, data, hora)` contra clique duplo.

### Login do admin

```
POST /api/auth/login {email, senha} ─► bcrypt compara ─► JWT (12h) ─► localStorage
Toda chamada /api/admin/* leva "Authorization: Bearer <token>" ─► authObrigatorio valida
401 (sem/expirado) ─► frontend desloga e volta ao login
```

---

## 🗄️ Banco de dados (modelagem)

Arquivo: `database/schema.sql` (aplicado automaticamente a cada boot via `src/db.js`).

```text
usuarios ─── (login do painel; cliente NÃO tem conta)

servicos ──┐
           ├──► agendamentos ◄── (data+hora, regras de grade)
profissionais ──┘

horarios_funcionamento ──┐ (expediente Ter–Sáb + almoço)
bloqueios ───────────────┘ (folgas/feriados/dia todo ou faixa)
```

| Tabela | Papel | Colunas-chave |
|---|---|---|
| `usuarios` | Login do painel | `email` UNIQUE, `senha_hash` (bcrypt), `papel` |
| `profissionais` | Barbeiros do Passo 2 | `apelido`, `ativo` (oculta sem apagar) |
| `servicos` | Catálogo + Passo 1 | `preco_centavos` (4500 = R$ 45), `duracao_min` (ocupa a grade) |
| `horarios_funcionamento` | 1 linha por dia (0=dom…6=sáb) | `aberto`, `abertura`, `fechamento`, `almoco_inicio/fim` |
| `bloqueios` | Exceções ao expediente | `data` + `hora_inicio/fim` opcionais (vazio = dia todo) |
| `agendamentos` | **Tabela central** | `servico_id`, `profissional_id`, `data`, `hora`, cliente, `status` (`confirmado`\|`concluido`\|`cancelado`), `UNIQUE(profissional_id, data, hora)` |

**Convenções:** dinheiro em **centavos** (inteiro, sem erro de float); datas `'AAAA-MM-DD'` e horas `'HH:MM'` como texto (ordem alfabética = cronológica); índices em `agendamentos(data)` e `(status)` para a agenda ser rápida.

---

## 🔌 Referência da API

Base local: `http://localhost:3000`. Respostas de erro seguem o padrão `{ "erro": "mensagem em pt-BR" }`.

### Públicas (site do cliente)

| Método | Rota | Parâmetros | Resposta |
|---|---|---|---|
| GET | `/api/servicos` | — | `[{id, nome, descricao, preco_centavos, duracao_min, ...}]` (ativos, +barato primeiro) |
| GET | `/api/profissionais` | — | `[{id, nome, apelido, ...}]` (ativos, A–Z) |
| GET | `/api/disponibilidade` | `?data=AAAA-MM-DD&profissional_id=N&servico_id=N` | `{data, horarios: ["09:00", ...]}` |
| POST | `/api/agendamentos` | `{servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, cliente_email?}` | `201` + agendamento com `servico_nome`, `preco_centavos`, `profissional_nome` |
| GET | `/api/config` | — | `{whatsapp: "5511..."}` (do `.env`, seguro expor) |

Erros do POST: `400` (campo/formato), `404` (serviço/profissional inválido ou inativo), `409` (horário ocupado — **vem com `horarios` atualizados**).

### Privadas (painel — header `Authorization: Bearer <token>`)

| Método | Rota | Uso |
|---|---|---|
| POST | `/api/auth/login` | `{email, senha}` → `{token, usuario}` |
| GET | `/api/admin/resumo?data=` | `{total, faturamento_centavos, proximos[5], por_status}` |
| GET | `/api/admin/agendamentos?data=&status=&profissional_id=` | Agenda filtrada (máx. 300) |
| PATCH | `/api/admin/agendamentos/:id` | `{status: confirmado\|concluido\|cancelado}` |
| DELETE | `/api/admin/agendamentos/:id` | Exclusão definitiva |
| GET / PUT | `/api/admin/funcionamento` | Lê / salva `{dias: [...]}` (transação tudo-ou-nada) |
| GET / POST / DELETE | `/api/admin/bloqueios` | `[{data, hora_inicio?, hora_fim?, motivo?}]` |

---

## ▶️ Rodando localmente

```powershell
# 1) Entrar na pasta do projeto
Set-Location -LiteralPath "C:\Users\anton\Downloads\projetos GITHUB ZED\PROJETO-TESTE"

# 2) Instalar dependências (só na primeira vez)
npm install

# 3) Criar seu .env a partir do modelo e ajustar (senha, WhatsApp, segredo JWT)
Copy-Item .env.example .env

# 4) (Opcional) forçar a carga inicial — o `npm start` já faz isso sozinho
npm run seed

# 5) Subir o servidor (http://localhost:3000 e http://localhost:3000/admin)
npm start
# Desenvolvimento com auto-reload: npm run dev
```

**Login do painel (dados do seed):** `admin@barbercode.app` / `admin123` — troque no `.env` antes de expor na internet.

---

## 🧪 Testando na mão (cURL)

```bash
# Catálogo e disponibilidade (terça que vem, barbeiro 1, serviço 1)
curl http://localhost:3000/api/servicos
curl "http://localhost:3000/api/disponibilidade?data=2026-10-13&profissional_id=1&servico_id=1"

# Criar reserva
curl -X POST http://localhost:3000/api/agendamentos -H "Content-Type: application/json" -d "{
  \"servico_id\": 1, \"profissional_id\": 1, \"data\": \"2026-10-13\", \"hora\": \"09:00\",
  \"cliente_nome\": \"João Teste\", \"cliente_telefone\": \"11999999999\" }"

# Login + agenda do dia (troque SEU_TOKEN)
curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{
  \"email\": \"admin@barbercode.app\", \"senha\": \"admin123\" }"
curl "http://localhost:3000/api/admin/resumo?data=2026-10-13" -H "Authorization: Bearer SEU_TOKEN"
```

---

## 🚀 Deploy

### Opção A — Tudo junto no Render (GRÁTIS, recomendado p/ testar)

Custo: **R$ 0** (plano free, sem cartão) e a URL já sai com o nome: `https://barbercode.onrender.com`.

1. Suba este projeto no GitHub (o `render.yaml` da raiz já configura tudo).
2. No [Render](https://render.com) → **New → Blueprint** → conecte o repositório `TESTES111` → **Apply**.
3. Aguarde o build (~2–5 min). Pronto: site em `https://barbercode.onrender.com` e painel em `https://barbercode.onrender.com/admin` (login `admin@barbercode.app` / `admin123`).
4. ⚠️ Limites do grátis (ok para teste): o serviço **dorme** após ~15 min parado (o 1º acesso acorda em ~1 min) e o **banco zera** a cada redeploy/restart (o seed recria tudo). Quando quiser valer pra valer: disco persistente (`DB_PATH=/data/barbercode.db`) ou Postgres (abaixo).

### Teste instantâneo (sem conta e sem deploy)

Para mostrar no celular em 1 minuto, exponha seu PC com um túnel HTTPS grátis:

```powershell
npm start
# em OUTRO terminal:
npx -y localtunnel --port 3000
# → recebe uma URL https://....loca.lt temporária com o site no ar
```

### Opção B — Frontend separado (Vercel/Netlify) + backend no Render

1. Backend no Render (Opção A). Anote a URL, ex.: `https://barbercode.onrender.com`.
2. Publique a pasta `public/` na Vercel/Netlify como site estático.
3. Aponte os `fetch()` de `public/js/*.js` para a URL do backend (hoje usam caminho relativo `/api/...`, que funciona quando tudo está junto).

### Domínio próprio (barbercode.app)

1. Registre o domínio (Registro.br, Cloudflare, Namecheap…).
2. **Frontend na Vercel:** Project → Settings → Domains → Add `barbercode.app` (e `www.barbercode.app`) → ajuste o DNS conforme indicado (registro A ou nameservers). O HTTPS é automático.
3. **Tudo junto no Render:** Service → Settings → Custom Domains → Add `barbercode.app` → crie o registro `CNAME` apontando para o endereço `.onrender.com` do serviço.
4. O HTML já sai com `<link rel="canonical">` + tags `og:*` apontando para `https://barbercode.app/` — se usar outro domínio, atualize essas linhas no `<head>` de `public/index.html`.

### Migrando para Postgres/Supabase (quando crescer)

- Troque `better-sqlite3` por `pg` (ou Prisma), convertendo `db.prepare(...).get/all/run` para queries parametrizadas `$1, $2…`.
- As **rotas não mudam de formato** — só a camada `src/db.js` + SQL do seed.
- Para **tempo real** (agenda atualizando sozinha), avalie Supabase Realtime ou Firebase; o cálculo de `disponibilidade.js` continua válido no servidor.

### Notificações automáticas (WhatsApp / Google Calendar)

- Hoje: link `wa.me` com mensagem pronta (1 clique) + arquivo `.ics` para importar no calendário — **zero custo, zero API key**.
- Automático depois: no `POST /api/agendamentos` (após o INSERT), chame **Twilio / Z-API** (WhatsApp) e/ou crie evento via **Google Calendar API** (OAuth da conta da Barber Code).

---

## ⚙️ Configuração (.env)

| Variável | Obrigatória | Padrão | O que faz |
|---|---|---|---|
| `PORT` | não | `3000` | Porta do servidor |
| `JWT_SECRET` | **sim (produção)** | segredo fraco de dev | Assina os tokens; vazou = login forjável |
| `JWT_EXPIRES_IN` | não | `12h` | Validade do login (`30m`, `12h`, `7d`…) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | não | `admin@barbercode.app` / `admin123` | Conta criada pelo seed |
| `BARBER_WHATSAPP` | não | `""` | DDI+DDD+número p/ o botão de WhatsApp |
| `DB_PATH` | não | `./barbercode.db` | Onde fica o arquivo SQLite |

Gere um segredo forte assim: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 🔒 Segurança

- ✅ Senhas só como **hash bcrypt**; erro de login **genérico** (não revela se o e-mail existe).
- ✅ Rotas admin atrás de **JWT com expiração**; SQL sempre **parametrizado** (sem concatenação → sem SQL injection).
- ⚠️ **Antes de publicar:** `JWT_SECRET` forte, trocar senha do admin, servir via **HTTPS**, considerar rate-limit no `/login` (ex.: `express-rate-limit`) e remover as credenciais de demonstração dos `value=` em `admin.html`.
- ⚠️ `.env` e `*.db` **nunca** entram no git (ver `.gitignore`).

---

## 🩺 Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `Sem horários vagos` todo dia | Dia fechado no expediente (Dom/Seg padrão) ou bloqueio dia-todo | `/admin` → Configurações → confira expediente e bloqueios |
| `Token ausente / Sessão expirada` | Sem login ou JWT expirou / `JWT_SECRET` mudou | Faça login de novo (trocar o secret invalida tokens antigos) |
| `SQLITE_CANTOPEN` / `database is locked` | Pasta sem permissão ou 2 processos no mesmo `.db` | Rode 1 instância; confira permissão de escrita; WAL já está ligado |
| `better-sqlite3` falha no `npm install` | Falta toolchain de compilação | Node 18+ normalmente usa binário pré-compilado; atualize o Node e tente de novo |
| Porta ocupada (`EADDRINUSE`) | Outro `npm start` rodando | Feche o outro terminal ou use `PORT=3001 npm start` |
| Push pede senha e falha | GitHub não aceita senha no HTTPS | Use **Personal Access Token** como senha ou SSH |

---

## 🧭 Evoluções sugeridas

1. Lembretes automáticos (WhatsApp 2h antes) via cron + Z-API/Twilio.
2. Cadastro de clientes + histórico ("João corta a cada 3 semanas").
3. Pagamento Pix na confirmação (QR code + webhook).
4. Múltiplas unidades / comissão por barbeiro.
5. Testes automatizados (`node --test`) para `horariosVagos()` — a regra mais crítica.

---

Feito com 💈 para a Barber Code — dúvidas? Abra os arquivos-fonte: **todos estão comentados em português**, de `src/server.js` a `public/js/admin.js`.
