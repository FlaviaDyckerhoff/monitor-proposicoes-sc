const fs = require('fs');
const nodemailer = require('nodemailer');

const { EMAIL_REMETENTE, EMAIL_SENHA, EMAIL_ALERTA_FALHA = 'flavia@monitorlegislativo.com.br', GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL = 'https://github.com', GITHUB_WORKFLOW, GITHUB_REF_NAME } = process.env;

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tail(path, maxLines = 80) {
  if (!fs.existsSync(path)) return '';
  return fs.readFileSync(path, 'utf8').split(/\r?\n/).slice(-maxLines).join('\n').trim();
}

async function main() {
  if (!EMAIL_REMETENTE || !EMAIL_SENHA || !EMAIL_ALERTA_FALHA) {
    console.error('Sem credenciais/destino para alerta interno.');
    return;
  }
  const monitorLog = tail('monitor.log');
  const estadoErro = tail('estado-error.log', 20);
  const estadoPush = tail('estado-push.log', 40);
  const runUrl = GITHUB_REPOSITORY && GITHUB_RUN_ID ? GITHUB_SERVER_URL + '/' + GITHUB_REPOSITORY + '/actions/runs/' + GITHUB_RUN_ID : '';
  const erroPrincipal = estadoErro || estadoPush || monitorLog || 'Falha no workflow sem log capturado.';
  const html = '<div style="font-family:Arial,sans-serif;max-width:760px;color:#111827">' +
    '<h2 style="color:#b42318;margin-bottom:8px">Alerta interno — Monitor Proposições SC</h2>' +
    '<p><strong>Erro principal:</strong></p><pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:6px">' + escapeHtml(erroPrincipal) + '</pre>' +
    (monitorLog && monitorLog !== erroPrincipal ? '<p><strong>Últimas linhas do monitor:</strong></p><pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:6px">' + escapeHtml(monitorLog) + '</pre>' : '') +
    '<p><strong>Workflow:</strong> ' + escapeHtml(GITHUB_WORKFLOW || '-') + '<br><strong>Branch:</strong> ' + escapeHtml(GITHUB_REF_NAME || '-') + '<br><strong>Run:</strong> ' + (runUrl ? '<a href="' + runUrl + '">' + escapeHtml(runUrl) + '</a>' : '-') + '</p>' +
    '<p style="color:#64748b;font-size:12px">Alerta interno. Não enviado para cliente.</p></div>';
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA } });
  await transporter.sendMail({ from: '"Monitor Legislativo" <' + EMAIL_REMETENTE + '>', to: EMAIL_ALERTA_FALHA, subject: '[ALERTA INTERNO] Monitor Proposições SC — falha', html });
  console.log('Alerta interno enviado para ' + EMAIL_ALERTA_FALHA);
}

main().catch((err) => {
  console.error('Erro ao enviar alerta interno:', err.message);
  process.exit(0);
});
