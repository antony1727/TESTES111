// Regra central de horários vagos (usada pela área pública e pelo admin).
const db = require('../db');

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function paraHHMM(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function sobrepoe(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

// Gera slots de 30 em 30 min respeitando expediente, almoço, bloqueios e agendamentos.
// Retorna array de 'HH:MM'.
function horariosVagos(data, profissionalId, duracaoMin) {
  const diaSemana = new Date(data + 'T12:00:00').getDay();
  const func = db.prepare('SELECT * FROM horarios_funcionamento WHERE dia_semana = ?').get(diaSemana);
  if (!func || !func.aberto) return [];

  const abre = paraMinutos(func.abertura);
  const fecha = paraMinutos(func.fechamento);
  const almIni = func.almoco_inicio ? paraMinutos(func.almoco_inicio) : null;
  const almFim = func.almoco_fim ? paraMinutos(func.almoco_fim) : null;

  // Ocupações existentes (ignora cancelados) — cada uma com sua duração real.
  const ocupados = db.prepare(`
    SELECT a.hora, s.duracao_min FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    WHERE a.data = ? AND a.profissional_id = ? AND a.status != 'cancelado'
  `).all(data, profissionalId).map((o) => {
    const ini = paraMinutos(o.hora);
    return { ini, fim: ini + o.duracao_min };
  });

  // Bloqueios do dia: registro sem hora = dia todo; com intervalo = faixa.
  const bloqueios = db.prepare('SELECT * FROM bloqueios WHERE data = ?').all(data);
  if (bloqueios.some((b) => !b.hora_inicio)) return [];
  const faixasBloq = bloqueios
    .filter((b) => b.hora_inicio && b.hora_fim)
    .map((b) => ({ ini: paraMinutos(b.hora_inicio), fim: paraMinutos(b.hora_fim) }));

  const hojeStr = new Date().toISOString().slice(0, 10);
  const agoraMin = new Date().getHours() * 60 + new Date().getMinutes();

  const livres = [];
  for (let ini = abre; ini + duracaoMin <= fecha; ini += 30) {
    const fim = ini + duracaoMin;
    if (almIni !== null && sobrepoe(ini, fim, almIni, almFim)) continue; // almoço
    if (faixasBloq.some((f) => sobrepoe(ini, fim, f.ini, f.fim))) continue;
    if (ocupados.some((o) => sobrepoe(ini, fim, o.ini, o.fim))) continue;
    if (data === hojeStr && ini <= agoraMin + 30) continue; // antecedência mínima 30min
    livres.push(paraHHMM(ini));
  }
  return livres;
}

module.exports = { horariosVagos, paraMinutos };
