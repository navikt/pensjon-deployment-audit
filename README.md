# Deployment Audit

En applikasjon for å overvåke deployments på Nav sin Nais-plattform og verifisere at alle har hatt "to sett av øyne" (four-eyes principle).

## ✨ Funksjoner

- 🔍 **Application Discovery**: Søk etter Nais teams og finn tilgjengelige applikasjoner
- 📦 **Deployment Tracking**: Automatisk synkronisering av deployments fra Nais
- ✅ **Four-Eyes Verification**: Automatisk sjekk av PR-godkjenninger
- 🚨 **Repository Alerts**: Varsler hvis deployment kommer fra uventet repository (sikkerhet!)
- 💬 **Kommentarer**: Legg til Slack-lenker for direct pushes
- 🎯 **Tertialtavler**: Koble deployments til tertialmål (tight-loose-tight)
- 📈 **Statistikk**: Oversikt over deployment-status

## 🏗️ Arkitektur

Appen bruker en applikasjon-sentrisk tilnærming hvor Team + Environment + Application er primær entitet. Hver applikasjon har et forventet repository (approved) og et detektert repository (faktisk). Hvis disse ikke matcher, opprettes automatisk et sikkerhetsfvarsel.

## Teknisk Stack

- **Framework**: React Router 7 med SSR
- **TypeScript**: For type-sikkerhet
- **Database**: PostgreSQL
- **UI**: Nav Aksel designsystem v8
- **APIs**: Nais GraphQL API og GitHub REST API

## 🚀 Oppsett

### 1. Installer dependencies

```bash
npm install
```

### 2. Konfigurer environment

Kopier `.env.example` til `.env`:

```bash
cp .env.example .env
```

Fyll inn (velg enten GitHub App eller PAT):

**GitHub App (anbefalt):**
```env
DATABASE_URL=postgresql://username:password@localhost:5432/deployment_audit
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<base64-encoded-private-key>
GITHUB_APP_INSTALLATION_ID=12345678
NAIS_GRAPHQL_URL=http://localhost:4242/graphql
```

**Personal Access Token (fallback):**
```env
DATABASE_URL=postgresql://username:password@localhost:5432/deployment_audit
GITHUB_TOKEN=your_github_token
NAIS_GRAPHQL_URL=http://localhost:4242/graphql
```

> **Tips:** For å base64-encode private key: `base64 -i private-key.pem | tr -d '\n'`

### 3. Initialiser database

**Med migrations (anbefalt):**
```bash
npm run db:migrate
```

**Eller med legacy init script (dropper alle tabeller først):**
```bash
npm run db:init
```

### 4. Start appen

**Lokalt (med auto-migrations):**
```bash
npm run dev
```

Åpne [http://localhost:5173](http://localhost:5173)

## 🐳 Docker

Applikasjonen bruker distroless Node.js 24 image for produksjon:

```bash
docker build -t deployment-audit .
docker run -e DATABASE_URL=... -e GITHUB_APP_ID=... -e GITHUB_APP_PRIVATE_KEY=... -e GITHUB_APP_INSTALLATION_ID=... -p 3000:3000 deployment-audit
```

Database migrations kjøres automatisk ved oppstart.

## 📖 Bruk

### Grunnleggende arbeidsflyt

1. **Oppdag applikasjoner**: 
   - Gå til "Oppdag applikasjoner"
   - Søk etter team (f.eks. "pensjon-q2")
   - Velg hvilke apps som skal overvåkes

2. **Hent deployments fra Nais**:
   - Gå til "Overvåkede applikasjoner"
   - Klikk "Hent" for å synkronisere fra Nais (ingen GitHub-kall)
   - Deployments lagres med status "pending"

3. **Verifiser four-eyes med GitHub**:
   - Gå til "Verifiser deployments" 
   - Kjør batch-verifisering (bruker GitHub rate limit)
   - Max 50-100 deployments per batch anbefales

4. **Håndter varsler**: 
   - Se repository-mismatch varsler
   - Løs varsler med notater

### To-stegs synkronisering

Applikasjonen deler opp Nais og GitHub-kall for å unngå rate limits:

**Steg 1: Hent fra Nais** (ingen rate limit)
- Henter alle deployments fra Nais GraphQL API
- Lagrer til database med status "pending"
- Detekterer repository fra deployment-data
- Oppretter varsel hvis repository-mismatch

**Steg 2: Verifiser med GitHub** (bruker rate limit)
- Verifiserer PR-godkjenninger
- Henter full PR-metadata:
  - PR creator, reviewers (med godkjenningsstatus), og merger
  - PR tittel, beskrivelse, labels
  - Stats: commits, filer endret, linjer lagt til/fjernet
  - CI/CD status (checks passed/failed)
  - Draft status og base branch
- Oppdaterer four-eyes status
- Kan kjøres senere/i batch
- 3-4 GitHub requests per deployment

Dette gir fleksibilitet til å:
- Hente alle deployments raskt
- Verifisere i batch når rate limit tillater
- Re-kjøre verifisering uten ny Nais-henting

### PR-informasjon

Når en deployment blir verifisert mot GitHub, lagres omfattende PR-metadata i `github_pr_data` (JSONB):

**Oversikt:**
- PR tittel, beskrivelse, labels
- Opprettet og merget tidspunkt
- Base branch og base SHA
- Draft-status

**Personer:**
- **Creator**: Hvem som opprettet PR-en
- **Reviewers**: Alle som har reviewet, med:
  - State: APPROVED ✅, CHANGES_REQUESTED 🔴, eller COMMENTED 💬
  - Tidspunkt for review
- **Merger**: Hvem som merget PR-en

**Stats:**
- Antall commits
- Antall filer endret
- Linjer lagt til (+)
- Linjer fjernet (-)

**CI/CD:**
- Checks status (passed/failed/skipped)
- Detaljert liste over alle checks som ble kjørt:
  - Check navn (med lenke til GitHub)
  - Status: success ✓, failure ✗, skipped/cancelled ⊝, in_progress ⏳
  - Conclusion og completion tidspunkt
  - Visuell indikator med ikoner og farger

**Unreviewed Commits Detection:**
- Når en PR merges, sjekkes det om det ble merget inn commits fra main som ikke har godkjenning
- Sammenligner PR base commit med main's head commit ved merge-tidspunktet
- Håndterer race conditions når flere PRs merges på kort tid
- For hver commit som ikke er del av PR-en:
  - Sjekker om commit har en godkjent PR
  - Flagges med status `approved_pr_with_unreviewed` hvis ureviewed commits finnes
  - Viser detaljert liste med hvilke commits som mangler godkjenning
  - Inkluderer info om author, melding og årsak

Dette gjør det enkelt å se hele reviewprosessen og CI/CD-status for hvert deployment direkte i applikasjonen, samt fange opp situasjoner der ikke-godkjent kode smugles inn sammen med godkjente PRs.

## 🧪 Testing

```bash
# Test API
npm run test:nais-discovery -- pensjon-q2
npm run test:nais-fetch -- pensjon-q2 dev-fss pensjon-pen-q2

# Type-sjekk
npm run typecheck

# Lint
npm run lint

# Database migrations
npm run db:migrate              # Run pending migrations  
npm run db:migrate:create my-migration  # Create new migration
npm run db:migrate:down         # Rollback last migration
```

## 📚 Database Schema

Database schema is managed with migrations in `app/db/migrations/`. See [Migration README](app/db/migrations/README.md) for details.

**Tables:**
- **monitored_applications**: Overvåkede apps (team + env + app)
- **deployments**: Deployment-info med four-eyes status
- **repository_alerts**: Sikkerhetsvarsler ved repo-mismatch
- **deployment_comments**: Kommentarer, Slack-lenker, og manuelle godkjenninger
- **tertial_boards/goals**: Tertialmål

## 📋 Verifiseringslogikk

For detaljert dokumentasjon av hvordan fire-øyne-prinsippet verifiseres, se [docs/verification.md](docs/verification.md). Dokumentet dekker:

- Beslutningsflyt med flytdiagram
- Alle mulige verifikasjonsresultater og hva de betyr
- PR-verifisering i detalj (reviews, tidspunkt, base branch merge)
- Implisitt godkjenning (moduser og regler)
- Kodereferanser for sporbarhet

## 🤝 Bidrag

Internt Nav-verktøy. Bidrag velkomne!

## 📋 Installasjonsguide for produksjon

### GitHub App

Applikasjonen trenger lesetilgang til repositories på GitHub for å hente PR-metadata og godkjenninger.

#### 1. Opprett GitHub App

1. Gå til **github.com** → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. Fyll inn:
   - **GitHub App name**: `deployment-audit` (eller tilsvarende)
   - **Homepage URL**: URL til applikasjonen
   - **Webhook**: Deaktiver (appen bruker polling, ikke webhooks)

#### 2. Sett tilganger (Permissions)

Under **Repository permissions**, gi **Read-only** tilgang til:

| Tilgang | Brukes til |
|---------|-----------|
| **Contents** | Lese commits og sammenligne brancher |
| **Metadata** | Lese repository-info (alltid påkrevd) |
| **Pull requests** | Lese PR-metadata, reviews og godkjenninger |
| **Checks** | Lese CI/CD-status for commits |

Ingen andre tilganger er nødvendig. Appen skriver aldri til GitHub.

#### 3. Installer appen

1. Gå til **Install App** i GitHub App-innstillingene
2. Velg organisasjonen (f.eks. `navikt`)
3. Velg **Only select repositories** og legg til repositories som skal overvåkes
4. Noter **Installation ID** fra URL-en etter installasjon (`/installations/<id>`)

#### 4. Generer private key

1. Gå til **General** → **Private keys** → **Generate a private key**
2. Last ned `.pem`-filen
3. Base64-encode: `base64 -i private-key.pem | tr -d '\n'`

#### 5. Konfigurer environment-variabler

```env
GITHUB_APP_ID=<App ID fra GitHub App-innstillingene>
GITHUB_APP_PRIVATE_KEY=<base64-encoded private key>
GITHUB_APP_INSTALLATION_ID=<Installation ID>
```

> **Alternativ**: For enklere oppsett (men lavere rate limit) kan et Personal Access Token brukes med `GITHUB_TOKEN` i stedet.

---

### Slack App

Slack-integrasjonen bruker Socket Mode, som betyr at appen kobler seg til Slack via WebSocket i stedet for å eksponere webhook-endepunkter.

#### 1. Opprett Slack App

1. Gå til [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Gi appen et navn og velg workspace

#### 2. Aktiver Socket Mode

1. Gå til **Settings** → **Socket Mode** → aktiver
2. Opprett et **App-Level Token** med scope `connections:write`
3. Noter tokenet (starter med `xapp-`)

#### 3. Sett OAuth Scopes

Under **OAuth & Permissions** → **Bot Token Scopes**, legg til:

| Scope | Brukes til |
|-------|-----------|
| `chat:write` | Sende deployment-varsler til kanaler |
| `chat:write.public` | Sende til kanaler uten å være invitert |

#### 4. Aktiver Events

Under **Event Subscriptions** → aktiver og legg til:

| Event | Brukes til |
|-------|-----------|
| `app_home_opened` | Vise Home Tab med oversikt og statistikk |

#### 5. Aktiver Interactivity

Under **Interactivity & Shortcuts** → aktiver interactivity. Ingen Request URL trengs da appen bruker Socket Mode.

#### 6. Installer i workspace

1. Gå til **Install App** → **Install to Workspace**
2. Godkjenn tilgangene
3. Noter **Bot User OAuth Token** (starter med `xoxb-`)

#### 7. Konfigurer environment-variabler

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C01234567  # Valgfri: standard-kanal for varsler
```

> **Tips**: Kanal-ID finner du ved å høyreklikke på kanalen i Slack → **View channel details** → kopier ID nederst.

---

### Nais API

Applikasjonen henter deployment-data fra Nais sitt GraphQL API med polling hvert 5. minutt.

```env
NAIS_GRAPHQL_URL=https://console.nav.cloud.nais.io/graphql
NAIS_API_KEY=<API-nøkkel for Nais>
```

> **Produksjon**: Kontakt Nais-teamet for å få utstedt en `NAIS_API_KEY` for tilgang til GraphQL-APIet.

> **Lokal utvikling**: Bruk `nais alpha api proxy` for å få tilgang til Nais-APIet lokalt. Proxyen kjører på `http://localhost:4242` og håndterer autentisering automatisk.

---

### Nais-hemmeligheter

På Nais legges GitHub- og Slack-variabler i en Kubernetes secret som refereres fra `nais.yaml`:

```yaml
envFrom:
  - secret: nais-deployment-audit
```

Secreten må inneholde: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `NAIS_API_KEY`, og eventuelt `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` og `SLACK_CHANNEL_ID`.
