/**
 * lib/disponibilidade.js — O "cérebro" da grade de horários. ⭐
 * ----------------------------------------------------------------------------
 * RESPONSABILIDADE: dado (data + profissional + duração do serviço), devolver
 * a lista de horários LIVRES no formato ['09:00', '09:30', ...].
 *
 * QUEM USA:
 *  • Área pública → GET /api/disponibilidade (Passo 3 do agendamento).
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

/**
 * Calcula os horários vagos.
 * @param {string} data            dia desejado 'YYYY-MM-DD'
 * @param {number} profissionalId  id do barbeiro escolhido
 * @param {number} duracaoMin      duração do serviço em minutos
 * @returns {Promise<string[]>} horários livres 'HH:MM' em ordem crescente
 */
async function horariosVagos(data, profissionalId, duracaoMin) {
  // Descobre o dia da semana (0=dom … 6=sáb). O 'T12:00:00' evita bug de fuso:
  // à meia-noite, o UTC poderia "voltar" um dia e calcular o weekday errado.
  const diaSemana = new Date(data + 'T12:00:00').getDay();

  // REGRA 1 — expediente: sem registro ou dia fechado = agenda vazia.
  const func = await db.get('SELECT * FROM horarios_funcionamento WHERE dia_semana = ?', [diaSemana]);
  if (!func || !Number(func.aberto)) return [];

  // Converte expediente/almoço para minutos, para comparar com aritmética.
  const abre = paraMinutos(func.abertura);
  const fecha = paraMinutos(func.fechamento);
  const almIni = func.almoco_inicio ? paraMinutos(func.almoco_inicio) : null;
  const almFim = func.almoco_fim ? paraMinutos(func.almoco_fim) : null;

  // REGRA 5 (coleta) — agendamentos do dia/profissional, IGNORANDO cancelados.
  // O JOIN traz a duração REAL de cada serviço, pois um combo (50min) ocupa
  // mais grade que um corte (30min), mesmo começando na mesma hora.
  const ocupados = (await db.all(`
    SELECT a.hora, s.duracao_min FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    WHERE a.data = ? AND a.profissional_id = ? AND a.status != 'cancelado'
  `, [data, profissionalId])).map((o) => {
    const ini = paraMinutos(o.hora);
    return { ini, fim: ini + o.duracao_min };
  });

  // REGRA 4 (coleta) — bloqueios do dia (folgas, feriados, pausas).
  // Convenção: registro SEM hora = dia todo bloqueado → retorna [] na hora.
  const bloqueios = await db.all('SELECT * FROM bloqueios WHERE data = ?', [data]);
  if (bloqueios.some((b) => !b.hora_inicio)) return [];
  // Com hora = bloqueio parcial: transforma em faixas numéricas p/ comparar.
  const faixasBloq = bloqueios
    .filter((b) => b.hora_inicio && b.hora_fim)
    .map((b) => ({ ini: paraMinutos(b.hora_inicio), fim: paraMinutos(b.hora_fim) }));

  // REGRA 6 (preparo) — "hoje" em ISO e "agora" em minutos, p/ antecedência.
  const hojeStr = new Date().toISOString().slice(0, 10);
  const agoraMin = new Date().getHours() * 60 + new Date().getMinutes();

  // REGRA 2 — gera candidatos de 30 em 30 min. O serviço precisa CABER:
  // (ini + duração ≤ fechamento), senão o atendimento invadiria o horário fechado.
  const livres = [];
  for (let ini = abre; ini + duracaoMin <= fecha; ini += 30) {
    const fim = ini + duracaoMin;
    // REGRA 3 — cruza o almoço? descarta.
    if (almIni !== null && sobrepoe(ini, fim, almIni, almFim)) continue; // almoço
    // REGRA 4 — cruza bloqueio? descarta.
    if (faixasBloq.some((f) => sobrepoe(ini, fim, f.ini, f.fim))) continue;
    // REGRA 5 — cruza atendimento existente? descarta.
    if (ocupados.some((o) => sobrepoe(ini, fim, o.ini, o.fim))) continue;
    // REGRA 6 — é hoje e começa em menos de 30 min (ou já passou)? descarta.
    if (data === hojeStr && ini <= agoraMin + 30) continue; // antecedência mínima 30min
    livres.push(paraHHMM(ini)); // passou em tudo: está livre! ✅
  }
  return livres;
}

module.exports = { horariosVagos, paraMinutos };
