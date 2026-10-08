// Seed inicial: admin, profissionais, serviços e horário Ter–Sáb 09h–19h.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

function seed() {
  // 1) Horário de funcionamento padrão (Ter a Sáb aberto, Dom/Seg fechado)
  const padrao = [
    { dia: 0, aberto: 0 }, // domingo
    { dia: 1, aberto: 0 }, // segunda
    { dia: 2, aberto: 1 },
    { dia: 3, aberto: 1 },
    { dia: 4, aberto: 1 },
    { dia: 5, aberto: 1 },
    { dia: 6, aberto: 1 },
  ];
  const up = db.prepare(`
    INSERT INTO horarios_funcionamento (dia_semana, aberto, abertura, fechamento, almoco_inicio, almoco_fim)
    VALUES (@dia_semana, @aberto, '09:00', '19:00', '12:00', '13:00')
    ON CONFLICT(dia_semana) DO NOTHING
  `);
  for (const d of padrao) up.run({ dia_semana: d.dia, aberto: d.aberto });

  // 2) Usuário admin
  const email = process.env.ADMIN_EMAIL || 'admin@barbearia.com';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';
  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (!existe) {
    const hash = bcrypt.hashSync(pass, 10);
    db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?,?,?,?)')
      .run('Administrador', email, hash, 'admin');
    console.log(`[seed] admin criado: ${email}`);
  }

  // 3) Profissionais
  const nProf = db.prepare('SELECT COUNT(*) c FROM profissionais').get().c;
  if (nProf === 0) {
    const ins = db.prepare('INSERT INTO profissionais (nome, apelido) VALUES (?,?)');
    ins.run('Carlos Silva', 'Carlos');
    ins.run('Diego Santos', 'Diego');
  }

  // 4) Serviços
  const nServ = db.prepare('SELECT COUNT(*) c FROM servicos').get().c;
  if (nServ === 0) {
    const ins = db.prepare(
      'INSERT INTO servicos (nome, descricao, preco_centavos, duracao_min) VALUES (?,?,?,?)'
    );
    ins.run('Corte de Cabelo', 'Corte moderno com acabamento na navalha.', 4500, 30);
    ins.run('Barba', 'Barba completa com toalha quente.', 3500, 30);
    ins.run('Combo Cabelo + Barba', 'O ritual completo do cavalheiro.', 7000, 50);
    ins.run('Sobrancelha', 'Design e limpeza de sobrancelha.', 1500, 15);
  }

  console.log('[seed] ok');
}

if (require.main === module) seed();
module.exports = seed;
