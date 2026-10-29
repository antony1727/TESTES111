/**
 * seed.js — Carga inicial de dados (executada automaticamente no boot).
 * ----------------------------------------------------------------------------
 * RESPONSABILIDADE: deixar o sistema USÁVEL logo após `npm install`, criando:
 *   1. Expediente padrão  (Ter–Sáb 09h–19h, almoço 12h–13h; Dom/Seg fechado)
 *   2. Usuário admin      (login do painel /admin)
 *   3. Profissionais      (2 barbeiros de exemplo)
 *   4. Serviços           (4 itens de exemplo com preço e duração)
 *
 * IDEMPOTÊNCIA (pode rodar N vezes sem duplicar):
 *  • Expediente usa `ON CONFLICT DO NOTHING` (só insere se o dia não existir).
 *  • Admin só é criado se o e-mail ainda não estiver cadastrado.
 *  • Profissionais/serviços só são criados se as tabelas estiverem VAZIAS.
 *    → Ou seja: depois que você personalizar tudo pelo painel, o seed NÃO
 *      apaga nem duplica seus dados.
 *
 * USO MANUAL: `npm run seed` (útil para recomeçar em um banco novo).
 * USO AUTOMÁTICO: `src/server.js` chama `seed()` em todo boot.
 */
require('dotenv').config(); // carrega ADMIN_EMAIL / ADMIN_PASSWORD do .env
const bcrypt = require('bcryptjs'); // gera o hash da senha (nunca salva senha pura)
const db = require('./db'); // conexão compartilhada (já com schema aplicado)

/** Executa toda a carga inicial. Segura para chamar repetidamente. */
async function seed() {
  // ---- 1) EXPEDIENTE PADRÃO ---------------------------------------------
  // dia: 0=domingo … 6=sábado (mesmo padrão do JavaScript Date.getDay()).
  const padrao = [
    { dia: 0, aberto: 0 }, // domingo  → fechado
    { dia: 1, aberto: 0 }, // segunda  → fechado (folga semanal)
    { dia: 2, aberto: 1 }, // terça    → aberto
    { dia: 3, aberto: 1 }, // quarta   → aberto
    { dia: 4, aberto: 1 }, // quinta   → aberto
    { dia: 5, aberto: 1 }, // sexta    → aberto
    { dia: 6, aberto: 1 }, // sábado   → aberto
  ];
  // ON CONFLICT (dia_semana) DO NOTHING = "se o dia já existe, não mexe".
  for (const d of padrao) {
    await db.run(
      `INSERT INTO horarios_funcionamento (dia_semana, aberto, abertura, fechamento, almoco_inicio, almoco_fim)
       VALUES (?, ?, '09:00', '19:00', '12:00', '13:00')
       ON CONFLICT (dia_semana) DO NOTHING`,
      [d.dia, d.aberto]
    );
  }

  // ---- 2) USUÁRIO ADMIN ---------------------------------------------------
  // E-mail/senha vêm do .env (com fallback para os valores de demonstração).
  const email = process.env.ADMIN_EMAIL || 'admin@barbercode.app';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';
  const existe = await db.get('SELECT id FROM usuarios WHERE email = ?', [email]);
  if (!existe) {
    const hash = bcrypt.hashSync(pass, 10); // 10 = "cost factor" (equilíbrio CPU × segurança)
    await db.run('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?,?,?,?)',
      ['Administrador', email, hash, 'admin']);
    console.log(`[seed] admin criado: ${email}`);
  }

  // ---- 3) PROFISSIONAIS DE EXEMPLO ----------------------------------------
  // Só insere se a tabela estiver vazia (para não duplicar a cada boot).
  const nProf = Number((await db.get('SELECT COUNT(*) AS c FROM profissionais')).c);
  if (nProf === 0) {
    await db.run('INSERT INTO profissionais (nome, apelido) VALUES (?,?)', ['Carlos Silva', 'Carlos']);
    await db.run('INSERT INTO profissionais (nome, apelido) VALUES (?,?)', ['Diego Santos', 'Diego']);
  }

  // ---- 4) SERVIÇOS DE EXEMPLO ----------------------------------------------
  // preco em CENTAVOS (4500 = R$ 45,00) e duração em MINUTOS (define a grade).
  const nServ = Number((await db.get('SELECT COUNT(*) AS c FROM servicos')).c);
  if (nServ === 0) {
    const itens = [
      ['Corte de Cabelo', 'Corte moderno com acabamento na navalha.', 4500, 30],
      ['Barba', 'Barba completa com toalha quente.', 3500, 30],
      ['Combo Cabelo + Barba', 'O ritual completo do cavalheiro.', 7000, 50],
      ['Sobrancelha', 'Design e limpeza de sobrancelha.', 1500, 15],
    ];
    for (const it of itens) {
      await db.run('INSERT INTO servicos (nome, descricao, preco_centavos, duracao_min) VALUES (?,?,?,?)', it);
    }
  }

  console.log('[seed] ok');
}

// Se executado direto via `node src/seed.js` (npm run seed), roda na hora.
// Quando importado pelo server.js, NÃO roda sozinho — o server chama seed().
if (require.main === module) {
  (async () => {
    await db.init();
    await seed();
    await db.fechar();
  })().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = seed;
