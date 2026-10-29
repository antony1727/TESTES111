/**
 * lib/disponibilidade.js — O "cérebro" da grade de horários. ⭐
 * ----------------------------------------------------------------------------
 * RESPONSABILIDADE: dado (data + profissional + duração do serviço), devolver
 * a lista de horários LIVRES no formato ['09:00', '09:30', ...].
 *
 * QUEM USA:
 *  • Área pública → GET /api/disponibilidade (dia escolhido).
 *  • Área pública → GET /api/disponibilidade-semana (7 dias de uma vez —
 *    é o que pinta a semana no Passo 3 mostrando "lotado" ou "fechado").
 *  • Criação de reserva → POST /api/agendamentos (revalida antes de salvar,
 *    para impedir que 2 pessoas peguem o mesmo horário ao mesmo tempo).
 *
 * REGRAS APLICADAS (nesta ordem):
 *  1. EXPEDIENTE — dia fechado (aberto=0) ou inexistente → zero horários.
 *  2. GRADE — gera candidatos de 30 em 30 min, do abre ao fecha, garantindo
 *     que o serviço caiba INTEIRO antes do fechamento (ini + duração ≤ fecha).
 *  3. ALMOÇO — candidatos que cruzam a pausa são descartados.
 *  4. BLOQUEIOS — faixas bloqueadas (ou dia todo) descartam candidatos.
 *  5. OCUPADOS — agendamentos não-cancelados, cada um com sua DURAÇÃO REAL
 *     (buscada via JOIN com serviços), descartam candidatos sobrepostos.
 *  6. ANTECEDÊNCIA — no dia de hoje, exige 30 min de folga (evita reservar
 *     horário que já passou ou que começa já-já).
 *
 * DETALHE MATEMÁTICO: tudo é convertido para MINUTOS desde 00:00
 * (ex.: 09:30 = 570). Comparar números é mais simples e evita bugs de string.
 * A sobreposição usa o teste clássico de intervalos: A∩B ≠ ∅ ⟺
 * aIni < bFim && bIni < aFim.
 */
const db = require('../db'); // conexão compartilhada com o banco

/** Converte 'HH:MM' → minutos. Ex.: paraMinutos('09:30') === 570. */
function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Converte minutos → 'HH:MM'. Ex.: paraHHMM(570) === '09:30'. */
function paraHHMM(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

/**
 * Testa se dois intervalos [aIni,aFim) e [bIni,bFim) se sobrepõem.
 * Fronteiras exatas NÃO contam como choque (terminar 10:00 e começar 10:00 OK).
 */
function sobrepoe(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

/** 'YYYY-MM-DD' de hoje (fuso local) — usado na regra de antecedência. */
function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Cálculo PURO (sem banco): recebe o expediente do dia, os atendimentos já
 * existentes e os bloqueios; devolve os horários livres.
 *
 * @param {string} data          'YYYY-MM-DD'
 * @param {object} func          linha de horarios_funcionamento (ou undefined)
 * @param {Array}  ocupados      [{hora:'HH:MM', duracao_min:N}, ...]
 * @param {Array}  bloqueios     linhas de bloqueios do dia
 * @param {number} duracaoMin    duração do serviço escolhido
 * @returns {string[]} horários livres 'HH:MM' em ordem crescente
 */
function calcularHorarios(data, func, ocupados, bloqueios, duracaoMin) {
  // REGRA 1 — expediente: sem registro ou dia fechado = agenda vazia.
  if (!func || !Number(func.aberto)) return [];

  // Converte expediente/almoço para minutos, para comparar com aritmética.
  const abre = paraMinutos(func.abertura);
  const fecha = paraMinutos(func.fechamento);
  const almIni = func.almoco_inicio ? paraMinutos(func.almoco_inicio) : null;
  const almFim = func.almoco_fim ? paraMinutos(func.almoco_fim) : null;

  // REGRA 5 (preparo) — cada atendimento vira uma faixa [início, fim).
  // Combo de 50min ocupa mais grade que um corte de 30min.
  const faixasOcupadas = ocupados.map((o) => {
    const ini = paraMinutos(o.hora);
    return { ini, fim: ini + Number(o.duracao_min) };
  });

  // REGRA 4 (preparo) — registro SEM hora = dia todo bloqueado → nenhum horário.
  if (bloqueios.some((b) => !b.hora_inicio)) return [];
  // Com hora = bloqueio parcial: transforma em faixas numéricas p/ comparar.
  const faixasBloq = bloqueios
    .filter((b) => b.hora_inicio && b.hora_fim)
    .map((b) => ({ ini: paraMinutos(b.hora_inicio), fim: paraMinutos(b.hora_fim) }));

  // REGRA 6 (preparo) — "hoje" e "agora" em minutos, p/ antecedência.
  const hojeStr = hojeISO();
  const agora = new Date();
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();

  // REGRA 2 — gera candidatos de 30 em 30 min. O serviço precisa CABER:
  // (ini + duração ≤ fechamento), senão o atendimento invadiria o horário fechado.
  const livres = [];
  for (let ini = abre; ini + duracaoMin <= fecha; ini += 30) {
    const fim = ini + duracaoMin;
    // REGRA 3 — cruza o almoço? descarta.
    if (almIni !== null && sobrepoe(ini, fim, almIni, almFim)) continue;
    // REGRA 4 — cruza bloqueio? descarta.
    if (faixasBloq.some((f) => sobrepoe(ini, fim, f.ini, f.fim))) continue;
    // REGRA 5 — cruza atendimento existente? descarta.
    if (faixasOcupadas.some((o) => sobrepoe(ini, fim, o.ini, o.fim))) continue;
    // REGRA 6 — é hoje e começa em menos de 30 min (ou já passou)? descarta.
    if (data === hojeStr && ini <= agoraMin + 30) continue; // antecedência mínima 30min
    livres.push(paraHHMM(ini)); // passou em tudo: está livre! ✅
  }
  return livres;
}

/** Descobre o dia da semana (0=dom … 6=sáb) sem bug de fuso horário. */
function diaSemanaDe(data) {
  return new Date(data + 'T12:00:00').getDay();
}

/**
 * Horários vagos de UM dia (3 consultas ao banco).
 * @param {string} data            dia desejado 'YYYY-MM-DD'
 * @param {number} profissionalId  id do barbeiro escolhido
 * @param {number} duracaoMin      duração do serviço em minutos
 * @returns {Promise<string[]>} horários livres 'HH:MM'
 */
async function horariosVagos(data, profissionalId, duracaoMin) {
  const [func, ocupados, bloqueios] = await Promise.all([
    db.get('SELECT * FROM horarios_funcionamento WHERE dia_semana = ?', [diaSemanaDe(data)]),
    db.all(`
      SELECT a.hora, s.duracao_min FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      WHERE a.data = ? AND a.profissional_id = ? AND a.status != 'cancelado'
    `, [data, profissionalId]),
    db.all('SELECT * FROM bloqueios WHERE data = ?', [data]),
  ]);
  return calcularHorarios(data, func, ocupados, bloqueios, duracaoMin);
}

/** Soma dias a uma data ISO (ex.: somarDias('2026-11-02', 3) → '2026-11-05'). */
function somarDias(data, n) {
  const d = new Date(data + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Horários vagos de 7 DIAS SEGUIDOS a partir de `dataInicio` (só 3 consultas
 * ao banco, independente de quantos dias). É o que alimenta a semana do site.
 *
 * @returns {Promise<Array<{data,dia_semana,aberto,total,horarios}>>}
 *   total === 0 → dia sem vaga (fechado, lotado ou bloqueado): o frontend
 *   mostra o dia como indisponível.
 */
async function horariosVagosSemana(dataInicio, profissionalId, duracaoMin) {
  const datas = Array.from({ length: 7 }, (_, i) => somarDias(dataInicio, i));
  const primeira = datas[0];
  const ultima = datas[6];

  const [funcionamento, agendamentos, bloqueios] = await Promise.all([
    db.all('SELECT * FROM horarios_funcionamento'),
    db.all(`
      SELECT a.data, a.hora, s.duracao_min FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      WHERE a.data BETWEEN ? AND ? AND a.profissional_id = ? AND a.status != 'cancelado'
    `, [primeira, ultima, profissionalId]),
    db.all('SELECT * FROM bloqueios WHERE data BETWEEN ? AND ?', [primeira, ultima]),
  ]);

  return datas.map((data) => {
    const diaSemana = diaSemanaDe(data);
    const func = funcionamento.find((f) => Number(f.dia_semana) === diaSemana);
    const horarios = calcularHorarios(
      data,
      func,
      agendamentos.filter((a) => a.data === data),
      bloqueios.filter((b) => b.data === data),
      duracaoMin
    );
    return {
      data,
      dia_semana: diaSemana,
      aberto: !!(func && Number(func.aberto)),
      total: horarios.length,
      horarios, // já vai junto: o clique no dia não precisa de outra requisição
    };
  });
}

module.exports = { horariosVagos, horariosVagosSemana, paraMinutos, somarDias };
