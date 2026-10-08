/**
 * middleware/auth.js — Porteiro das rotas privadas (/api/admin/*).
 * ----------------------------------------------------------------------------
 * O QUE É JWT: após o login, o servidor entrega ao navegador um "crachá"
 * assinado digitalmente (token). A cada requisição privada, o frontend mostra
 * esse crachá no cabeçalho `Authorization: Bearer <token>`. Aqui verificamos
 * se a assinatura é válida e se o crachá não expirou — SEM consultar o banco
 * (a validação é matemática, usando o JWT_SECRET).
 *
 * FLUXO:
 *  1. Frontend faz login → recebe { token } (ver src/routes/auth.js).
 *  2. Frontend guarda no localStorage e envia no header das próximas chamadas.
 *  3. Este middleware intercepta, valida e anexa `req.usuario` (id/nome/papel).
 *  4. Se válido → `next()` libera a rota. Se não → responde 401.
 */
const jwt = require('jsonwebtoken');

// Segredo da assinatura. EM PRODUÇÃO deve vir do .env (JWT_SECRET) — o valor
// abaixo existe só para desenvolvimento local nunca quebrar.
const SECRET = process.env.JWT_SECRET || 'dev-secret-troque-no-env';

/**
 * Middleware Express (req, res, next).
 * Coloque ANTES das rotas que exigem login: router.use(authObrigatorio).
 */
function authObrigatorio(req, res, next) {
  // O header chega assim: "Bearer eyJhbGciOiJIUzI1NiIs...". Extraímos o token.
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  // Sem crachá = sem entrada (401 Unauthorized).
  if (!token) return res.status(401).json({ erro: 'Token ausente. Faça login.' });

  try {
    // jwt.verify checa assinatura + expiração. Se OK, devolve os dados do login.
    req.usuario = jwt.verify(token, SECRET);
    next(); // tudo certo: entrega para a rota solicitada
  } catch {
    // Assinatura inválida, token adulterado ou expirado.
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

module.exports = { authObrigatorio, SECRET };
