# 🏛️ Monitor Proposições SC — ALESC

Monitora automaticamente o portal e-Legis da Assembleia Legislativa de Santa Catarina e envia email quando há proposições novas. Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

---

## Como funciona

1. O GitHub Actions roda o script nos horários configurados
2. O script faz GET na página de listagem do portal e-Legis (HTML puro, Apache, sem API JSON)
3. Parseia o HTML com cheerio para extrair as proposições
4. Monitora **dois portais**:
   - `/proposicoes/processo-legislativo` — PL, PLC, PEC, PDL, etc.
   - `/proposicoes/atividade-parlamentar` — Requerimentos, Moções, Indicações, etc.
5. Para cada portal, **itera as páginas** (10 proposições por página) até encontrar uma página em que todos os hashes já foram vistos — garantindo que nenhuma proposição seja perdida mesmo em dias de alta atividade
6. Compara com o `estado.json` salvo no repositório
7. Se há proposições novas → envia email organizado por tipo
8. Salva o estado atualizado no repositório

---

## Lógica de paginação

O portal lista as proposições em ordem decrescente de data (mais recentes primeiro), 10 por página. O monitor funciona assim:

```
Página 1 → 3 novas de 10 → continua
Página 2 → 10 novas de 10 → continua
Página 3 → 0 novas de 10 → para ✓
```

Quando uma página inteira não tem nenhum hash novo, significa que todas as páginas seguintes também já foram vistas — o script para ali. Há um limite de segurança de 20 páginas por portal por execução para evitar loops infinitos em caso de reset do estado.

---

## Diferença técnica em relação ao monitor do PR

O monitor do PR usa a **API REST JSON** da ALEP. A ALESC não tem API pública de proposições — o portal e-Legis (`portalelegis.alesc.sc.gov.br`) é Server-Side Rendering em PHP/Apache que retorna HTML diretamente. Por isso este monitor usa **cheerio** para parsear o HTML, sem Playwright, sem headless — execução típica em ~5 a 15 segundos dependendo do número de páginas novas.

---

## Estrutura do repositório

```
monitor-proposicoes-sc/
├── monitor.js                      # Script principal
├── package.json                    # Dependências (nodemailer + cheerio)
├── estado.json                     # Estado salvo automaticamente pelo workflow
├── README.md                       # Este arquivo
└── .github/
    └── workflows/
        └── monitor.yml             # Workflow do GitHub Actions
```

---

## Setup — Passo a Passo

### PARTE 1 — Preparar o Gmail

**1.1** Acesse [myaccount.google.com/security](https://myaccount.google.com/security)

**1.2** Certifique-se de que a **Verificação em duas etapas** está ativa.

**1.3** Procure por **"Senhas de app"** e clique.

**1.4** Digite um nome (ex: `monitor-alesc`) e clique em **Criar**.

**1.5** Copie a senha de **16 letras** gerada — ela só aparece uma vez.

> Se já usa o mesmo Gmail para o monitor do PR, pode reutilizar a mesma senha de app.

---

### PARTE 2 — Criar o repositório no GitHub

**2.1** Acesse [github.com](https://github.com) → **+ → New repository**

**2.2** Preencha:
- **Repository name:** `monitor-proposicoes-sc`
- **Visibility:** Private

**2.3** Clique em **Create repository**

---

### PARTE 3 — Fazer upload dos arquivos

**3.1** Na página do repositório, clique em **"uploading an existing file"**

**3.2** Faça upload de:
```
monitor.js
package.json
README.md
```
Clique em **Commit changes**.

**3.3** Crie o workflow: clique em **Add file → Create new file**, digite:
```
.github/workflows/monitor.yml
```
Cole o conteúdo do arquivo `monitor.yml`. Clique em **Commit changes**.

---

### PARTE 4 — Configurar os Secrets

**4.1** No repositório: **Settings → Secrets and variables → Actions**

**4.2** Clique em **New repository secret** e crie os 3 secrets:

| Name | Valor |
|------|-------|
| `EMAIL_REMETENTE` | seu Gmail (ex: seuemail@gmail.com) |
| `EMAIL_SENHA` | a senha de 16 letras do App Password (sem espaços) |
| `EMAIL_DESTINO` | email onde quer receber os alertas |

---

### PARTE 5 — Testar

**5.1** Vá em **Actions → Monitor Proposições SC → Run workflow → Run workflow**

**5.2** Aguarde ~30 segundos (o primeiro run vai percorrer várias páginas). Verde = funcionou.

**5.3** O **primeiro run** envia email com todas as proposições de 2026 ainda não vistas e salva o estado. A partir do segundo run, só envia se houver novidades — e varre quantas páginas forem necessárias.

---

## Email recebido

O email chega organizado por tipo, com link direto para cada proposição:

```
🏛️ ALESC — 5 nova(s) proposição(ões)

OF — 1 proposição(ões)
  OF./0004/2026 | Tribunal de Contas do Estado | 30/03/2026 | Encaminha links...

PL — 3 proposição(ões)
  PL./0195/2026 | Governador do Estado         | 30/03/2026 | Autoriza a doação...
  PL./0194/2026 | Governador do Estado         | 30/03/2026 | Altera os Anexos I...
  PL./0192/2026 | Dep. Julio Garcia            | 30/03/2026 | Reconhece o Município...

PLC — 1 proposição(ões)
  PLC/0007/2026 | MESA                         | 31/03/2026 | Altera a Resolução nº 001...
```

---

## Portais monitorados

| Portal | URL | Tipos de proposição |
|--------|-----|---------------------|
| Processo Legislativo | `/proposicoes/processo-legislativo` | PL, PLC, PEC, PDL, OF, etc. |
| Atividade Parlamentar | `/proposicoes/atividade-parlamentar` | RQS, MOC, IND, etc. |

Para monitorar apenas um portal, comente o outro no array `PORTAIS` dentro do `monitor.js`.

---

## Horários de execução

| Horário BRT | Cron UTC |
|-------------|----------|
| 08:00       | 0 11 * * * |
| 12:00       | 0 15 * * * |
| 17:00       | 0 20 * * * |
| 21:00       | 0 0 * * *  |

---

## Resetar o estado

1. No repositório, clique em `estado.json` → lápis
2. Substitua o conteúdo por:
```json
{"proposicoes_vistas":[],"ultima_execucao":""}
```
3. Commit → rode o workflow manualmente

> ⚠️ Após um reset, o primeiro run vai percorrer todas as páginas do ano atual (pode demorar ~1-2 minutos e gerar um email grande).

---

## Scraping

```
Portal:       https://portalelegis.alesc.sc.gov.br
Método:       GET (HTML, sem autenticação, Apache 2.4 / PHP)
Parser:       cheerio (seletor: .card.card-alesc)
Paginação:    ?page=N (10 itens/página, para quando página sem novidades)
Limite:       20 páginas por portal por execução (segurança)
```

---

## Problemas comuns

**Não aparece "Senhas de app" no Google**
→ Ative a verificação em duas etapas primeiro.

**Erro "Authentication failed" no log**
→ Verifique se `EMAIL_SENHA` foi colado sem espaços.

**Log mostra "0 proposições encontradas"**
→ O portal pode estar fora do ar. Acesse `https://portalelegis.alesc.sc.gov.br/proposicoes/processo-legislativo` no browser para confirmar.

**Log mostra "Limite de 20 páginas atingido"**
→ Isso acontece normalmente apenas no primeiro run após um reset do estado. Se acontecer repetidamente, algo está errado com o `estado.json`.

**Rodou mas não veio email**
→ Se foi o primeiro run após um reset, verifique a caixa de spam.
