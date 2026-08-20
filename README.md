# ProblemGelöst

Mobile-first Problemfinder: wenige Fragen → passende Lösung → Produktempfehlung / kostenlose Alternative.

## Architektur

- **Astro**: statische Website
- **Supabase**: Content + Analytics
- **Vercel**: Hosting + Deployments
- **GitHub**: zentrale Code-Quelle

Mehr: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Lokal starten

```bash
npm ci
npm run dev
```

Erforderliche lokale Konfiguration als `.env.local`; Vorlage: `.env.example`.

## Qualität vor Push

```bash
npm run validate
npm run build
```

## Deployment

Nach Verknüpfung mit Vercel:
- `main` → Production
- andere Branches / Pull Requests → Preview

Details: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Content

Veröffentlichte Problemseiten kommen beim Build aus Supabase. Lokale `generated/`-Dateien sind Review-Artefakte und werden nicht committed.

## Analytics

Anonyme Funnel-Events werden in `public.analytics_events` in Supabase geschrieben. RLS begrenzt die öffentlich erlaubten Inserts.

## SEO

- Canonical Host: `https://www.xn--problemgelst-ejb.com` (= `https://www.problemgelöst.com`)
- `/robots.txt`
- `/sitemap.xml`

## Workflow & Datenbank

- Entwicklungsworkflow: [`docs/WORKFLOW.md`](docs/WORKFLOW.md)
- Datenbank-Regeln: [`docs/DATABASE.md`](docs/DATABASE.md)
- Neue DB-Migrationen: [`supabase/migrations/`](supabase/migrations/)
