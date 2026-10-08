/**
 * admin.js — LÓGICA DO PAINEL DO BARBEIRO (/admin).
 * ----------------------------------------------------------------------------
 * MAPA DO ARQUIVO:
 *  1. Utilidades .......... $(), BRL(), DIAS, token()
 *  2. api() ............... fetch com JWT automático + logout em 401
 *  3. Login/Sair .......... btnLogin grava o token; btnSair apaga
 *  4. boot() .............. esconde login, mostra painel, liga filtros/botões
 *  5. carregarTudo() ...... KPIs (resumo) + tabela da agenda (filtros)
 *  6. mudaStatus() ........ botões ✓ concluir / ✕ cancelar
 *  7. Expediente .......... carregarFunc() + salvarFunc() (PUT semanal)
 *  8. Bloqueios ........... carregarBloq() + criarBloqueio() (folgas/faixas)
 *
 * AUTENTICAÇÃO: o JWT fica em localStorage ('bb_token'). Toda chamada privada
 * leva `Authorization: Bearer <token>` (montado em api()). Se o backend
 * responder 401 (ausente/expirado), deslogamos e voltamos à tela de login.
 */

// Atalho p/ document.querySelector.
const $ = (s) => document.querySelector(s);
/** centavos → "R$ 70,00" (mesmo padrão do site público). */
const BRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Índice 0–6 (dia_semana do banco/JS) → nome em português. */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** Lê o "crachá" de acesso salvo no navegador (null se nunca logou). */
const token = () => localStorage.getItem('bb_token');

/**
 * fetch() do painel: injeta Content-Type JSON + Authorization automaticamente.
 * 401 → sessão inválida: apaga tudo e recarrega p/ a tela de login.
 * Outros erros → lança Error com a mensagem { erro } do backend.
 */
async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}), ...opts.headers },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Sessão expirada. Faça login.'); }
  if (!r.ok) throw new Error(data.erro || 'Falha na requisição.');
  return data;
}

/** Sai do painel: apaga o token e recarrega (volta à tela de login). */
function logout() { localStorage.removeItem('bb_token'); location.reload(); }

// ---- LOGIN ------------------------------------------------------------------
// Lê e-mail/senha, chama POST /api/auth/login e guarda o token. Erro de
// credenciais aparece na caixa #loginErro sem sair da tela.
$('#btnLogin').onclick = async () => {
  const box = $('#loginErro'); box.hidden = true;
  try {
    const r = await api('/api/auth/login', { method: 'POST',
      body: JSON.stringify({ email: $('#loginEmail').value, senha: $('#loginSenha').value }) });
    localStorage.setItem('bb_token', r.token);
    boot(); // token OK → abre o painel
  } catch (e) { box.hidden = false; box.textContent = e.message; }
};
$('#btnSair').onclick = logout;

/**
 * boot() — "abertura" do painel (roda no load e logo após o login):
 * se NÃO há token, para aqui (tela de login continua visível). Se há:
 * troca as telas, pré-seleciona hoje no filtro, escreve a data por extenso
 * e liga todos os controles (filtros recarregam; botões salvam).
 */
async function boot() {
  if (!token()) return; // sem token = fica no login
  $('#telaLogin').hidden = true; $('#painel').hidden = false; $('#btnSair').hidden = false;
  $('#filtroData').value = new Date().toISOString().slice(0, 10); // hoje pré-selecionado
  $('#hojeLbl').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  $('#btnRecarregar').onclick = carregarTudo;
  $('#filtroData').onchange = carregarTudo; // trocou o dia → atualiza KPIs + tabela
  $('#filtroStatus').onchange = carregarTudo; // trocou o status → refiltra tabela
  $('#btnSalvarFunc').onclick = salvarFunc;
  $('#btnBloquear').onclick = criarBloqueio;
  await carregarTudo();
}

/**
 * carregarTudo() — atualiza as 4 regiões do painel:
 *  1. KPIs via GET /api/admin/resumo (total, R$ estimado, próximo horário);
 *  2. Tabela via GET /api/admin/agendamentos (respeitando filtros de dia/status),
 *     com botões por linha (✓ conclui, ✕ cancela, excluir com confirmação);
 *  3. Expediente semanal; 4. Lista de bloqueios.
 */
async function carregarTudo() {
  // --- 1) KPIs do dia selecionado ---
  const data = $('#filtroData').value;
  const resumo = await api(`/api/admin/resumo?data=${data}`);
  $('#kpiTotal').textContent = resumo.total;
  $('#kpiFat').textContent = BRL(resumo.faturamento_centavos);
  // Próximo: "14:30 · João" (primeiro nome p/ caber no card) ou "—" se vazio.
  $('#kpiProx').textContent = resumo.proximos[0] ? `${resumo.proximos[0].hora} · ${resumo.proximos[0].cliente_nome.split(' ')[0]}` : '—';

  // --- 2) Tabela da agenda (com filtro de status opcional) ---
  const st = $('#filtroStatus').value;
  const lista = await api(`/api/admin/agendamentos?data=${data}${st ? '&status=' + st : ''}`);
  $('#corpoAgenda').innerHTML = lista.map((a) => `
    <tr><td><b>${a.hora}</b></td>
      <td>${a.cliente_nome}<br><span class="meta">${a.cliente_telefone}</span></td>
      <td>${a.servico_nome}<br><span class="meta">${BRL(a.preco_centavos)}</span></td>
      <td>${a.profissional_nome}</td>
      <td><span class="badge b-${a.status}">${a.status}</span></td>
      <td><div class="linha">
        ${a.status !== 'concluido' ? `<button class="btn small" data-ok="${a.id}">✓</button>` : ''}
        ${a.status === 'confirmado' ? `<button class="btn small" data-canc="${a.id}">✕</button>` : ''}
        <button class="btn small ghost" data-del="${a.id}">excluir</button>
      </div></td></tr>`).join('') || '<tr><td colspan="6" class="meta">Nenhum agendamento.</td></tr>';

  // Liga os botões recém-criados (precisa ser APÓS o innerHTML acima).
  document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => mudaStatus(b.dataset.ok, 'concluido'));
  document.querySelectorAll('[data-canc]').forEach((b) => b.onclick = () => mudaStatus(b.dataset.canc, 'cancelado'));
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Excluir este agendamento?')) return; // trava contra clique acidental
    await api(`/api/admin/agendamentos/${b.dataset.del}`, { method: 'DELETE' });
    carregarTudo(); // recarrega p/ refletir a exclusão
  });

  // --- 3) e 4) Expediente + bloqueios (seções de configuração) ---
  await carregarFunc(); await carregarBloq();
}

/** Troca o status de um agendamento (✓→concluido, ✕→cancelado) e recarrega. */
async function mudaStatus(id, status) {
  await api(`/api/admin/agendamentos/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  carregarTudo();
}

// ---- EXPEDIENTE SEMANAL ------------------------------------------------------
// Cada linha (.dia) = um dia da semana, identificada por data-dia="0..6" e com
// campos data-f="aberto|abertura|fechamento|almoco" (almoco = "12:00-13:00").

/** Lê GET /api/admin/funcionamento e desenha as 7 linhas editáveis. */
async function carregarFunc() {
  const dias = await api('/api/admin/funcionamento');
  $('#gradeFunc').innerHTML = dias.map((d) => `
    <div class="dia" data-dia="${d.dia_semana}">
      <b>${DIAS[d.dia_semana]}</b>
      <label><input type="checkbox" data-f="aberto" ${d.aberto ? 'checked' : ''} style="width:auto"> aberto</label>
      <input type="time" data-f="abertura" value="${d.abertura}" />
      <input type="time" data-f="fechamento" value="${d.fechamento}" />
      <input type="text" data-f="almoco" value="${d.almoco_inicio || ''}-${d.almoco_fim || ''}" placeholder="12:00-13:00 (almoço)" />
    </div>`).join('');
}

/**
 * salvarFunc() — lê as 7 linhas da tela, converte p/ o formato da API
 * (almoço "12:00-13:00" → dois campos; vazio → null = sem pausa) e envia
 * via PUT /api/admin/funcionamento. Vale na HORA para novos agendamentos.
 */
async function salvarFunc() {
  const dias = [...document.querySelectorAll('#gradeFunc .dia')].map((el) => {
    const g = (f) => el.querySelector(`[data-f="${f}"]`).value;
    const alm = (g('almoco') || '').split('-'); // "12:00-13:00" → ["12:00","13:00"]
    return {
      dia_semana: Number(el.dataset.dia),
      aberto: el.querySelector('[data-f="aberto"]').checked ? 1 : 0,
      abertura: g('abertura') || '09:00', fechamento: g('fechamento') || '19:00',
      almoco_inicio: (alm[0] || '').trim() || null, almoco_fim: (alm[1] || '').trim() || null,
    };
  });
  await api('/api/admin/funcionamento', { method: 'PUT', body: JSON.stringify({ dias }) });
  alert('Expediente salvo!');
}

// ---- BLOQUEIOS (folgas, feriados, pausas pontuais) ----------------------------

/** Lista bloqueios (GET) com botão "liberar" (DELETE) em cada um. */
async function carregarBloq() {
  const lista = await api('/api/admin/bloqueios');
  $('#listaBloq').innerHTML = lista.map((b) =>
    `<div>📅 ${b.data} ${b.hora_inicio ? `${b.hora_inicio}–${b.hora_fim}` : '(dia todo)'} — ${b.motivo || 'sem motivo'} <button class="btn small ghost" data-unlock="${b.id}">liberar</button></div>`
  ).join('') || 'Nenhum bloqueio.';
  document.querySelectorAll('[data-unlock]').forEach((x) => x.onclick = async () => {
    await api(`/api/admin/bloqueios/${x.dataset.unlock}`, { method: 'DELETE' }); carregarBloq();
  });
}

/**
 * criarBloqueio() — valida a data e envia POST /api/admin/bloqueios.
 * Horários vazios = DIA TODO. Com horários = só a FAIXA. Limpa o motivo e
 * recarrega a lista. O efeito na grade do cliente é imediato.
 */
async function criarBloqueio() {
  const data = $('#bloqData').value;
  if (!data) return alert('Escolha a data.');
  await api('/api/admin/bloqueios', { method: 'POST', body: JSON.stringify({
    data, hora_inicio: $('#bloqIni').value || null, hora_fim: $('#bloqFim').value || null, motivo: $('#bloqMotivo').value,
  })});
  $('#bloqMotivo').value = ''; carregarBloq();
}

// Arranque: se já existe token válido, abre o painel direto; senão, login.
boot();
