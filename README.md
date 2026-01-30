# Pensjon Deployment Audit

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

Fyll inn:
```env
DATABASE_URL=postgresql://username:password@localhost:5432/nais_audit
GITHUB_TOKEN=your_github_token
NAIS_GRAPHQL_URL=http://localhost:4242/graphql
```

### 3. Initialiser database

**Med migrations (anbefalt):**
```bash
npm run db:migrate
```

**Eller med legacy init script:**
```bash
npm run db:init
```

> **Tip:** Sjekk migration status med `npm run db:migrate:status`

### 4. Start appen

```bash
npm run dev
```

Åpne [http://localhost:5173](http://localhost:5173)

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

## 🤝 Bidrag

Internt Nav-verktøy. Bidrag velkomne!
