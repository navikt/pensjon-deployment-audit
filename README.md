# Pensjon Deployment Audit

En applikasjon for å sammenstille deployments på Nav sin Nais-plattform med endringer fra GitHub. Målet er å verifisere at alle deployments har hatt "to sett av øyne" (four-eyes principle).

## Funksjoner

- 🔍 Søk etter repositories under navikt på GitHub
- 📊 Hent deployments fra Nais GraphQL API
- ✅ Automatisk verifisering av four-eyes principle for PRs
- 💬 Legg til kommentarer og Slack-lenker for direct pushes
- 🎯 Koble deployments til tertialmål (tight-loose-tight)
- 📈 Oversikt over deployment-statistikk

## Teknisk Stack

- **Framework**: React Router 7 med SSR
- **TypeScript**: For type-sikkerhet
- **Database**: PostgreSQL
- **UI**: Nav Aksel designsystem v8
- **APIs**: 
  - Nais GraphQL API
  - GitHub REST API (via Octokit)

## Oppsett

### 1. Klon og installer dependencies

\`\`\`bash
npm install
\`\`\`

### 2. Konfigurer environment variables

Kopier \`.env.example\` til \`.env\` og fyll inn verdiene:

\`\`\`bash
cp .env.example .env
\`\`\`

Redigerer \`.env\`:
\`\`\`env
DATABASE_URL=postgresql://username:password@localhost:5432/nais_audit
GITHUB_TOKEN=your_github_personal_access_token
NAIS_GRAPHQL_URL=http://localhost:4242/graphql
\`\`\`

#### GitHub Token
1. Gå til GitHub Settings → Developer settings → Personal access tokens
2. Generer et nytt token med \`repo\` scope
3. Lim inn tokenet i \`.env\`

### 3. Sett opp database

#### Installer PostgreSQL

**macOS (med Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Docker (alternativ):**
```bash
docker run --name nais-audit-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nais_audit \
  -p 5432:5432 \
  -d postgres:16
```

#### Opprett database

**Hvis du bruker lokal PostgreSQL:**
```bash
createdb nais_audit
```

**Hvis du bruker Docker:**
Databasen er allerede opprettet.

#### Oppdater DATABASE_URL i .env

```env
# For lokal PostgreSQL (macOS/Linux)
DATABASE_URL=postgresql://$(whoami)@localhost:5432/nais_audit

# For Docker
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nais_audit

# Med passord
DATABASE_URL=postgresql://username:password@localhost:5432/nais_audit
```

#### Kjør database migrations

```bash
npm run db:init
```

Du skal se:
```
Initializing database...
✓ Database schema created successfully
Database initialization complete
```


### 4. Start utviklingsserver

\`\`\`bash
npm run dev
\`\`\`

Appen kjører nå på http://localhost:5173

## Bruk

### 1. Legg til et repository
- Gå til "Søk etter repo"
- Søk etter et repository under navikt org
- Klikk "Legg til" og fyll inn Nais team slug og miljø

### 2. Synkroniser deployments
- Gå til repository-siden
- Klikk "Synkroniser deployments"
- Appen henter deployments fra Nais og verifiserer four-eyes med GitHub

### 3. Se deployments
- Se alle deployments med status
- Filtrer på de som mangler four-eyes
- Legg til kommentarer og Slack-lenker

### 4. Tertialtavler (kommende)
- Opprett tertialtavler for teams
- Definer mål
- Koble deployments til mål

## Utvikling

### Type-sjekk
\`\`\`bash
npm run typecheck
\`\`\`

### Bygg for produksjon
\`\`\`bash
npm run build
npm run start
\`\`\`

## Arkitektur

\`\`\`
app/
├── db/                  # Database models og queries
│   ├── connection.ts    # PostgreSQL connection pool
│   ├── schema.sql       # Database schema
│   ├── repositories.ts  # Repository CRUD
│   ├── deployments.ts   # Deployment CRUD
│   ├── comments.ts      # Comment CRUD
│   └── tertial.ts       # Tertial board CRUD
├── lib/                 # API clients og business logic
│   ├── github.ts        # GitHub API client
│   ├── nais.ts          # Nais GraphQL client
│   └── sync.ts          # Deployment sync logic
└── routes/              # React Router routes
    ├── layout.tsx       # Main layout med header
    ├── home.tsx         # Dashboard
    ├── repos.tsx        # Repository liste
    ├── repos.search.tsx # Repository søk
    └── repos.$id.tsx    # Repository detaljer
\`\`\`

## Four-Eyes Verifisering

Applikasjonen verifiserer "to sett av øyne" på følgende måte:

### For Pull Requests
1. Hent PR for commit via GitHub API
2. Hent alle reviews for PR
3. Hent alle commits i PR
4. Sjekk at det finnes minst én APPROVED review
5. Verifiser at approval kom **etter** siste commit i PR

### For Direct Pushes
- Markeres som \`direct_push\`
- Brukere kan legge til Slack-lenke som bevis på review

## Miljøvariabler

| Variabel | Beskrivelse | Eksempel |
|----------|-------------|----------|
| \`DATABASE_URL\` | PostgreSQL connection string | \`postgresql://localhost:5432/nais_audit\` |
| \`GITHUB_TOKEN\` | GitHub Personal Access Token | \`ghp_...\` |
| \`NAIS_GRAPHQL_URL\` | Nais GraphQL API URL | \`http://localhost:4242\` |

## Lisens

ISC

## Code Quality

Prosjektet bruker **Biome** for linting og formatering, og **Lefthook** for Git hooks.

### Biome

Biome er en rask linter og formatter for JavaScript/TypeScript.

```bash
# Sjekk for feil
npm run lint

# Fiks automatisk
npm run lint:fix

# Formater kode
npm run format
```

### Lefthook

Lefthook kjører automatisk linting og typecheck ved commits og pushes.

**Git hooks:**
- **pre-commit**: Lint og typecheck på endrede filer
- **pre-push**: Lint og typecheck på hele prosjektet
- **commit-msg**: Validerer commit-melding format

**Commit-melding format:**
```
type(scope?): subject

Eksempler:
feat: legg til søkefunksjonalitet
fix(api): rett opp null-sjekk i deployment sync
docs: oppdater README
```

Tillatte typer: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

### Installere hooks

Hooks installeres automatisk ved `npm install`, men kan også installeres manuelt:

```bash
npx lefthook install
```

### Kjøre uten hooks

For å committe uten å kjøre hooks (ikke anbefalt):

```bash
git commit --no-verify
```


## Troubleshooting

### Database

**Problem: "Connection refused" eller "Connection timeout"**
```bash
# Sjekk at PostgreSQL kjører
brew services list  # macOS
systemctl status postgresql  # Linux

# Start PostgreSQL
brew services start postgresql@16  # macOS
sudo systemctl start postgresql  # Linux

# Hvis Docker
docker ps  # Sjekk at containeren kjører
docker start nais-audit-db
```

**Problem: "database nais_audit does not exist"**
```bash
createdb nais_audit
```

**Problem: "authentication failed"**
- Sjekk at DATABASE_URL stemmer med din PostgreSQL-konfigurasjon
- På macOS uten passord: `postgresql://$(whoami)@localhost:5432/nais_audit`
- Med Docker: `postgresql://postgres:postgres@localhost:5432/nais_audit`

**Koble til database manuelt:**
```bash
psql nais_audit

# Se tabeller
\dt

# Se en tabell
\d repositories

# Avslutt
\q
```

### GitHub API

**Problem: "Kunne ikke søke i GitHub"**
- Sjekk at GITHUB_TOKEN er satt i `.env`
- Verifiser at tokenet har `repo` scope
- Test tokenet: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`

### Nais GraphQL

**Problem: "Kunne ikke hente deployments"**
- Sjekk at NAIS_GRAPHQL_URL er riktig (default: http://localhost:4242)
- Verifiser at du har tilgang til Nais GraphQL API

### Testing Nais GraphQL API

**Sjekk at API-et er tilgjengelig:**
```bash
curl -X POST http://localhost:4242/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'
```

Du skal få et JSON-svar, ikke HTML.

**Hvis du får HTML tilbake:**
- URL-en er feil - du peker på playground i stedet for endpoint
- Riktig endpoint er typisk `/graphql` eller `/query`
- Sjekk dokumentasjonen til ditt Nais API

**Eksempel-query for å teste:**
```graphql
query($team: Slug!, $appsFirst: Int!, $depsFirst: Int!) {
  team(slug: $team) {
    applications(first: $appsFirst) {
      nodes {
        name
      }
    }
  }
}
```

Med variabler:
```json
{
  "team": "pensjon-q2",
  "appsFirst": 10,
  "depsFirst": 10
}
```
