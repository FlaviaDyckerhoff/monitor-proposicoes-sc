const fs = require('fs');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const BASE_URL = 'https://portalelegis.alesc.sc.gov.br';
const MAX_PAGINAS = 20; // Limite de segurança: nunca busca mais que isso por portal por execução

// Monitora os dois portais: processo legislativo (PL, PLC, PEC...) e atividade parlamentar (REQ, MOC, IND...)
const PORTAIS = [
  {
    nome: 'Processo Legislativo',
    path: '/proposicoes/processo-legislativo',
  },
  {
    nome: 'Atividade Parlamentar',
    path: '/proposicoes/atividade-parlamentar',
  },
];

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

async function buscarPaginaHtml(portal, ano, pagina) {
  const url = `${BASE_URL}${portal.path}?ano=${ano}&inicio=${ano}-01-01&fim=${ano}-12-31&arquivados=1&page=${pagina}`;
  console.log(`   🌐 Página ${pagina}: ${url}`);

  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'Mozilla/5.0 (compatible; monitor-alesc/1.0)',
    },
  });

  if (!response.ok) {
    console.error(`   ❌ Erro HTTP ${response.status}`);
    return null;
  }

  return await response.text();
}

function parsearProposicoes(html, nomePortal) {
  const $ = cheerio.load(html);
  const proposicoes = [];

  $('.card.card-alesc').each((_, card) => {
    const $card = $(card);

    // Título e hash: <a href="/proposicoes/K9JW0">PLC/0007/2026</a>
    const $titulo = $card.find('h4.card-title a');
    const href = $titulo.attr('href') || '';
    const hash = href.replace('/proposicoes/', '').trim();
    const titulo = $titulo.text().trim();

    if (!hash || !titulo) return;

    // Extrai tipo, numero e ano do título
    // Formatos: PL./0195/2026, PLC/0007/2026, OF./0004/2026, RQS/0287/2026
    const matchTitulo = titulo.match(/^([^/]+?)\/(\d+)\/(\d{4})$/);
    const tipo = matchTitulo ? matchTitulo[1].replace(/\.$/, '').trim() : titulo;
    const numero = matchTitulo ? matchTitulo[2] : '';
    const ano = matchTitulo ? matchTitulo[3] : '';

    const ementa = $card.find('p.fst-italic').text().trim().substring(0, 250);

    let entrada = '';
    let autoria = '';
    let situacao = '';

    $card.find('.row').each((_, row) => {
      const $row = $(row);
      const label = $row.find('.fw-bold').first().text().trim().toLowerCase();
      const valor = $row.find('.col-lg-10').text().trim().replace(/\s+/g, ' ');
      if (label.includes('entrada')) entrada = valor;
      if (label.includes('autoria')) autoria = valor;
      if (label.includes('situa')) situacao = valor;
    });

    proposicoes.push({
      id: hash,
      titulo,
      tipo,
      numero,
      ano,
      ementa,
      entrada,
      autoria,
      situacao,
      url: `${BASE_URL}/proposicoes/${hash}`,
      portal: nomePortal,
    });
  });

  return proposicoes;
}

// Itera páginas até não encontrar nenhum hash novo em uma página inteira.
// Isso garante que nenhuma proposição seja perdida mesmo em dias de alta atividade.
async function buscarTodasNovas(portal, ano, idsVistos) {
  const novas = [];
  let pagina = 1;

  console.log(`\n🔍 Buscando ${portal.nome}...`);

  while (pagina <= MAX_PAGINAS) {
    const html = await buscarPaginaHtml(portal, ano, pagina);

    if (!html) break;

    const proposicoesDaPagina = parsearProposicoes(html, portal.nome);

    if (proposicoesDaPagina.length === 0) {
      console.log(`   → Página ${pagina} vazia. Fim da busca.`);
      break;
    }

    const novasDaPagina = proposicoesDaPagina.filter(p => !idsVistos.has(p.id));
    console.log(`   → Página ${pagina}: ${proposicoesDaPagina.length} proposições, ${novasDaPagina.length} novas`);

    novas.push(...novasDaPagina);

    // Se nenhuma proposição desta página é nova, todas as anteriores também já foram vistas
    // (o portal ordena por data desc, mais recentes primeiro)
    if (novasDaPagina.length === 0) {
      console.log(`   → Nenhuma novidade nesta página. Parando.`);
      break;
    }

    // Se a página retornou menos de 10 itens, chegamos na última página
    if (proposicoesDaPagina.length < 10) {
      console.log(`   → Última página alcançada.`);
      break;
    }

    pagina++;
  }

  if (pagina > MAX_PAGINAS) {
    console.warn(`   ⚠️ Limite de ${MAX_PAGINAS} páginas atingido em ${portal.nome}. Verifique se o estado.json está correto.`);
  }

  console.log(`   ✅ Total de novas em ${portal.nome}: ${novas.length}`);
  return novas;
}

async function enviarEmail(novas) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  // Agrupa por tipo
  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort().map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f0f7;font-weight:bold;color:#2c3e6b;font-size:13px;border-top:2px solid #2c3e6b">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px;white-space:nowrap">${p.titulo || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autoria || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.entrada || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap"><a href="${p.url}" style="color:#2c3e6b">Ver</a></td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto">
      <h2 style="color:#2c3e6b;border-bottom:2px solid #2c3e6b;padding-bottom:8px">
        🏛️ ALESC — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#2c3e6b;color:white">
            <th style="padding:10px;text-align:left">Proposição</th>
            <th style="padding:10px;text-align:left">Autoria</th>
            <th style="padding:10px;text-align:left">Entrada</th>
            <th style="padding:10px;text-align:left">Ementa</th>
            <th style="padding:10px;text-align:left">Link</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://portalelegis.alesc.sc.gov.br">portalelegis.alesc.sc.gov.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor ALESC" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ ALESC: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`\n✅ Email enviado com ${novas.length} proposições novas.`);
}

(async () => {
  console.log('🚀 Iniciando monitor ALESC (SC)...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas);

  const ano = new Date().getFullYear();
  const todasNovas = [];

  for (const portal of PORTAIS) {
    const novasDoPortal = await buscarTodasNovas(portal, ano, idsVistos);
    todasNovas.push(...novasDoPortal);
  }

  console.log(`\n📊 Total de novas: ${todasNovas.length}`);

  if (todasNovas.length > 0) {
    // Ordena por tipo alfabético, depois por número decrescente dentro de cada tipo
    todasNovas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });

    await enviarEmail(todasNovas);

    todasNovas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
