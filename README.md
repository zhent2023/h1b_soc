# h1b_soc

**Occupational matching and prevailing wage research for H-1B workflows.**

h1b_soc connects job duties, academic coursework, O*NET occupational information, and OFLC wage data in one research application. It helps immigration practitioners and developers explore occupational classifications, compare wages by location, and inspect the educational evidence behind a suggested occupational match.

The project includes a Next.js interface, API routes, data ingestion scripts, and reusable matching modules. Features depend on the active datasets, configured providers, and feature flags.

[Repository](https://github.com/zhent2023/h1b_soc) · [Issues](https://github.com/zhent2023/h1b_soc/issues) · [MIT License](LICENSE)

## What it does

- **Occupational research:** Search O*NET occupations and SOC codes, review occupational duties, and retrieve occupations that are semantically similar to a job description.
- **Wage research:** Resolve a work location, look up OFLC prevailing wages at Levels 1 through 4, and compare a proposed hourly or annual salary with the available wage levels.
- **Educational evidence:** Extract courses from academic transcripts, review the extracted records, map courses to occupational skills, knowledge, and abilities, and inspect supporting courses.
- **Combined matching:** Combine job duties with educational evidence from one or more transcripts to explore relevant occupations.
- **Traceable data:** Keep dataset versions associated with wage, occupation, geography, and embedding records.
- **Maintainer tooling:** Use administrative scripts, audit logs, caching, rate limits, and automated tests to maintain the application.

Results support research and professional review. Matching scores are heuristic signals, not calibrated probabilities or determinations of H-1B eligibility. Course extraction and inferred skills should be reviewed before use.

## Technology

| Component | Implementation |
| --- | --- |
| Application | Next.js 14 App Router, React 18, TypeScript |
| Database | PostgreSQL, Prisma, pgvector |
| Embeddings | Gemini, an OpenAI-compatible adapter, or a deterministic test stub |
| Transcript extraction | PDF text extraction with Gemini parsing and OCR support |
| File storage | Local disk or Vercel Blob |
| Cache and rate limiting | Redis when configured, with in-memory behavior where supported |
| Tests | Vitest, Playwright, and acceptance scripts |
| CI | GitHub Actions |

See [package.json](package.json) for the exact dependency and script configuration.

## Local development with demo data

This setup uses a fresh local database, fabricated fixture wages, stub geocoding, and stub embeddings. It does not require a model API key for the basic wage-lookup demo. Semantic matching and transcript skill matching require the additional setup below.

### 1. Install prerequisites and dependencies

Use Node.js 20, the version configured in the current CI workflow, pnpm 9.12.3, and Docker Compose v2 with support for `--wait`. PostgreSQL must support pgvector; the included Compose file supplies PostgreSQL 16 with that extension available.

~~~bash
git clone https://github.com/zhent2023/h1b_soc.git
cd h1b_soc
pnpm install --frozen-lockfile
cp .env.example .env
~~~

### 2. Configure the local demo

Edit the corresponding entries in `.env`:

~~~dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lca_tool
ACCESS_MODE=invite
GEOCODER_PROVIDER=stub
EMBEDDING_PROVIDER=stub
EMBEDDING_MODEL=stub
EMBEDDING_API_KEY=
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=./.local/transcripts
FEATURE_SOC_RECOMMENDER=false
NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER=false
FEATURE_SKILL_MATCHING=false
FEATURE_MATCH_FUSION=false
NEXT_PUBLIC_FEATURE_SKILL_MATCHING=false
~~~

The template contains settings for real providers and hosted storage. The overrides above make the initial demo use local storage and test providers.

### 3. Start the database and application

~~~bash
docker compose up -d --wait db
pnpm db:migrate
pnpm db:seed
pnpm dev
~~~

Open [http://localhost:3000](http://localhost:3000) and sign in with the seeded development account:

| Field | Demo value |
| --- | --- |
| Email | `demo@example.com` |
| Password | `demo-password` |

Try SOC `15-1252` with a seeded location such as Littleton, MA or Austin, TX.

**Use the seed command only with a disposable development database.** It creates fixture data, can relabel existing active datasets, and can overwrite selected records. The seeded wages are examples, not official wage results. The seed does not install the complete O*NET database, occupational embeddings, or the skills catalog.

The Compose file runs infrastructure only. Run the Next.js application separately with `pnpm dev`; the repository's current Dockerfile does not define an application image.

### Optional Redis

~~~bash
docker compose --profile redis up -d redis
~~~

Set:

~~~dotenv
REDIS_URL=redis://localhost:26379
~~~

The default host port is `26379`. The database host port defaults to `5432` and can be changed with `DB_PORT`.

## Load real occupational and wage data

Use a separate database for real datasets. Set `DATABASE_URL` to that database, apply migrations, and do not populate it with the demo seed. Set `GEOCODER_PROVIDER=census` for real address lookups and keep `ACCESS_MODE=invite`. Create an account using the `admin:add-user` command in Main configuration before signing in; the demo account exists only in the seeded database.

The ingestion scripts can download supported upstream archives or accept local file paths. They record dataset versions and can activate imported versions.

Before running standalone scripts, make the relevant `.env` values available in the shell. Next.js and Prisma CLI load their environment files, but standalone `tsx` scripts read `process.env`; do not assume they load every setting automatically. Export database and provider settings explicitly, or use your environment manager.

The following uses `2025-2026`, the repository's example wage year:

~~~bash
pnpm ingest:all --wageYear 2025-2026 --activate
pnpm admin:datasets:list
~~~

Choose the wage year required for your research and update `DEFAULT_WAGE_YEAR` to match. The example year is not a statement that it is the latest available release.

Local source files can be supplied when needed:

~~~bash
pnpm ingest:all \
  --wageYear 2025-2026 \
  --oflcZipPath /absolute/path/to/oflc.zip \
  --onetZipPath /absolute/path/to/onet-text.zip \
  --countyZipPath /absolute/path/to/counties.zip \
  --cityCountyCsvPath /absolute/path/to/us-cities.csv \
  --activate
~~~

This command imports the base wage, occupation, and geographic datasets. It does not compute occupational embeddings or prepare the transcript skills pipeline.

| Data | Use | Implementation |
| --- | --- | --- |
| OFLC wage files | Wage levels by wage year, area, occupation, and ACWIA setting | [ingest_oflc.ts](scripts/ingest/ingest_oflc.ts) |
| O*NET text database | Occupations, duties, and related occupational content | [ingest_onet.ts](scripts/ingest/ingest_onet.ts) |
| County and geographic files | Geographic resolution and wage-area matching | [ingest_cbsa.ts](scripts/ingest/ingest_cbsa.ts) |
| City and county mapping | Additional location matching | [ingest_city_county.ts](scripts/ingest/ingest_city_county.ts) |
| O*NET skills, knowledge, and abilities | Course evidence and occupational skill requirements | [ingest_onet_ska.ts](scripts/ingest/ingest_onet_ska.ts) and [ingest_onet_ska_requirements.ts](scripts/ingest/ingest_onet_ska_requirements.ts) |

The default city/county mapping uses a third-party source selected in [city_county.ts](scripts/ingest/sources/city_county.ts). The geographic importer can use a county Gazetteer; that input does not itself guarantee a complete county-to-CBSA crosswalk.

Automatic downloads depend on upstream file formats and page layouts. Review import results, active versions, and data-quality flags before relying on a dataset.

## Enable semantic occupational matching

### Configure an embedding provider

The current schema and embedding code expect **3,072-dimensional vectors**.

For OpenAI embeddings:

~~~dotenv
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_API_URL=https://api.openai.com/v1/embeddings
EMBEDDING_API_KEY=your-openai-api-key
~~~

The adapter uses `EMBEDDING_API_KEY`, rather than `OPENAI_API_KEY`. OpenAI documents a default output size of 3,072 for `text-embedding-3-large`; see the [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).

For the Gemini embedding provider configured in the repository:

~~~dotenv
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_API_URL=https://generativelanguage.googleapis.com/v1beta
EMBEDDING_API_KEY=your-gemini-api-key
~~~

Confirm that your account can use the selected provider and model. When switching providers, update the model, key, and API URL together. Rebuild the applicable embeddings and skills catalog when changing models; matching vectors must use the same embedding space.

Stub embeddings are intended for development and tests. They do not provide meaningful semantic recommendations.

### Build the occupation embeddings

After importing and activating O*NET occupation data, run:

~~~bash
pnpm exec tsx scripts/admin/compute_onet_embeddings.ts
~~~

The script supports batching and resuming. It activates a generated embedding version after its configured coverage threshold is reached. The default 95% threshold measures embedding coverage, not matching accuracy.

Enable both flags and restart the application:

~~~dotenv
FEATURE_SOC_RECOMMENDER=true
NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER=true
~~~

## Enable transcript skills and combined matching

### Configure access, storage, and parsing

Keep `ACCESS_MODE=invite` and use a signed-in user. Transcript endpoints require a session; the current public access mode bypasses session recognition in the shared access helper.

Use `STORAGE_PROVIDER=local` for local development or `STORAGE_PROVIDER=vercel_blob` with a `BLOB_READ_WRITE_TOKEN` for hosted blob storage.

The current transcript parser and OCR provider use Gemini. Their model settings are:

- `TRANSCRIPT_PARSER_MODEL`
- `TRANSCRIPT_OCR_MODEL`
- `TRANSCRIPT_PARSER_FALLBACK_MODEL`
- `TRANSCRIPT_OCR_FALLBACK_MODEL`

Select models available to your account. Names in `.env.example` are repository defaults, not a guarantee of current provider availability.

**Current credential limitation:** The Gemini transcript providers also read `EMBEDDING_API_KEY`. A single configuration cannot currently supply separate OpenAI embedding and Gemini transcript credentials. The OpenAI embedding adapter does not add OpenAI transcript extraction. Running that mixed provider configuration requires separating the credentials in code.

### Prepare the skills catalog and requirements

Extract the same O*NET Text database release used for the base occupation data into `ONET_DATA_DIR`, which defaults to `./data/onet`. The loader accepts files directly in that directory or in one child directory.

Required files include:

- `Content Model Reference.txt`
- `Skills.txt`
- `Knowledge.txt`
- `Abilities.txt`

With the database and embedding provider settings exported to the shell:

~~~bash
pnpm ingest:onet-ska --label YOUR_ONET_VERSION_LABEL
~~~

Use the printed dataset version ID in both following commands:

~~~bash
pnpm ingest:onet-ska-reqs --datasetVersionId YOUR_DATASET_VERSION_ID
pnpm admin:datasets:activate --dataset onet_ska --versionId YOUR_DATASET_VERSION_ID
~~~

Replace the uppercase placeholders with the actual label and returned ID. The first command creates an inactive skills dataset and computes its embeddings. The requirements import and explicit activation are both required.

Enable the feature flags:

~~~dotenv
FEATURE_SKILL_MATCHING=true
NEXT_PUBLIC_FEATURE_SKILL_MATCHING=true
FEATURE_MATCH_FUSION=true
~~~

Restart the application after changing the active skills dataset to clear the in-process caches. Sign in, upload a transcript, review the extracted courses, and compute skill evidence before using the skills or combined matching results.

### Transcript retention

The default upload limit is 10 MiB, controlled by `TRANSCRIPT_MAX_BYTES`. With `TRANSCRIPT_DELETE_AFTER_PARSE=true`, the pipeline is configured to remove the uploaded original after parsing. Parsed records are separate database entries; this setting is not a policy for deleting all derived data.

## Main configuration

[.env.example](.env.example) is the starting point for configuration.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `ACCESS_MODE` | Shared API access mode; keep `invite` for session-based transcript features |
| `ADMIN_EMAILS` | Comma-separated emails allowed to use administrator functions |
| `GEOCODER_PROVIDER` | `stub` for fixtures or `census` for the implemented external geocoder |
| `DEFAULT_WAGE_YEAR` | Wage year requested by default |
| `DEFAULT_IS_ACWIA` | Default ACWIA dataset selection |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_URL` | Embedding provider configuration |
| `EMBEDDING_API_KEY` | Embedding credential; also used by the current Gemini transcript providers |
| `STORAGE_PROVIDER` | `local` or `vercel_blob` |
| `REDIS_URL` | Optional Redis connection |
| `AUDIT_LOG_TTL_DAYS` | Audit retention setting used by the cleanup tooling |

To create a local account, the repository provides:

~~~bash
pnpm admin:add-user -- --email you@example.com --password YOUR_LOCAL_PASSWORD
~~~

Replace the password placeholder before running the command. For administrator access, add the same email to `ADMIN_EMAILS`.

## Tests and maintenance

Use a disposable test database for integration, browser, and acceptance tests because they create or change database records.

| Command | Purpose |
| --- | --- |
| `pnpm test:unit` | Unit tests |
| `pnpm test:integration` | Database integration tests |
| `pnpm test:coverage` | Vitest suite with coverage |
| `pnpm typecheck` | TypeScript checking |
| `pnpm lint` | Linting |
| `pnpm test` | Tracked-import check, stub embedding check, coverage, lint, and build |
| `pnpm test:e2e` | Playwright browser tests |
| `pnpm acceptance:all` | Data and application acceptance scripts |
| `pnpm admin:datasets:list` | List imported datasets |
| `pnpm cleanup:course-cache` | Clean up course cache entries |
| `pnpm cleanup:audit-logs` | Run audit log cleanup |

For browser tests, install the Playwright browser first:

~~~bash
pnpm exec playwright install chromium
pnpm test:e2e
~~~

See [.github/workflows/ci.yml](.github/workflows/ci.yml), [playwright.config.ts](playwright.config.ts), and the scripts themselves for required environment settings. Test commands are provided here as project tooling, not as a claim that every environment or provider configuration has been validated.

## Repository guide

| Path | Contents |
| --- | --- |
| [app/](app/) | Pages and API routes |
| [src/lib/](src/lib/) | Lookup, matching, access, auditing, storage, and transcript logic |
| [src/lib/embeddings/](src/lib/embeddings/) | Embedding providers and occupation embedding generation |
| [src/lib/ska/](src/lib/ska/) | Skills inference and occupational scoring |
| [prisma/](prisma/) | Schema, migrations, and fixture seed |
| [scripts/](scripts/) | Ingestion, administration, cleanup, smoke, and acceptance tooling |
| [tests/](tests/) and [e2e/](e2e/) | Unit, integration, and browser tests |
| [docs/](docs/) | Implementation plans and design notes |

Useful implementation notes:

- [SOC recommender repository map](docs/repo-map-soc-recommender.md)
- [SOC recommender implementation](docs/soc-recommender-implementation.md)
- [Transcript and skills implementation plan](docs/transcript-skills-onet-implementation-plan.md)
- [Wage schema snapshot](docs/wage-schema.md)

Planning documents and historical snapshots may describe intermediate states. Check the current source and migrations when they differ.

## Contributing

Contributions are welcome in data ingestion, geographic resolution, matching evaluation, transcript extraction, accessibility, documentation, and tests.

1. Open an issue describing the problem or proposed change.
2. Make a focused change with a clear explanation of the resulting behavior.
3. Add relevant tests or reproducible examples for changes to matching, wages, parsing, or access controls.
4. Use synthetic or properly de-identified fixtures.
5. Run the applicable checks and include the results and any limitations in your pull request.

Potential future work includes independent provider credentials, additional transcript providers, calibrated matching evaluations, and clearer contributor setup. These are improvement areas, not claims of existing functionality.

Keep credentials and identifiable transcripts out of commits and public issue reports.

## Data attribution and scope

The MIT license covers this project's source code and accompanying project documentation. Upstream datasets, third-party dependencies, service terms, and trademarks retain their own terms.

O*NET data originate from the U.S. Department of Labor, Employment and Training Administration. Follow the [O*NET database license and attribution instructions](https://www.onetcenter.org/license_db.html), including the actual release version used and any required notice of modifications. O*NET is a trademark of USDOL/ETA.

Wage results depend on the imported OFLC release, selected year and geography, and data quality. Verify the relevant official source before using a result in a filing or other consequential decision. The application is independent of government agencies and does not determine legal eligibility.

## License

[MIT](LICENSE). Copyright (c) 2026 zhent2023.
