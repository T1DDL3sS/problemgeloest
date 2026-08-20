# ProblemGelöst – Architektur

## Source of Truth

- **GitHub**: Website-Code, Astro-Komponenten, Routing, Styles, Content-Engine-Code, SEO-Logik.
- **Supabase**: veröffentlichte Problem-/Cluster-Daten, Produkttypen/Affiliate-Angebote und Analytics-Events.
- **Vercel**: Build, Preview Deployments, Production Hosting und Domains.
- **Google Search Console**: Indexierungs-/SEO-Beobachtung; keine operative Datenquelle.

## Deployment-Modell

- `main` = Production.
- Feature-Branches / Pull Requests = Preview Deployments.
- Production wird nach der Git-Anbindung nicht mehr aus einem einzelnen lokalen Ordner per ZIP/CLI verwaltet.
- Vercel-Environment-Variablen werden im Vercel-Projekt verwaltet und niemals committed.

## Datenfluss

1. Code-Änderung wird in Git committed und nach GitHub gepusht.
2. Vercel baut automatisch eine Preview bzw. Production.
3. Beim statischen Build werden veröffentlichte Problemseiten aus Supabase gelesen.
4. Browser-Analytics schreibt ausschließlich erlaubte Events nach Supabase.

## Sicherheitsregeln

Nie committen:
- `.env.local`
- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`
- sonstige Service-/Admin-Secrets

Frontend darf nur den Supabase Publishable/Anon Key verwenden; RLS bleibt aktiv.

## Skalierung

Neue Probleme/Cluster gehören langfristig in Supabase. Der Astro-Code bleibt generisch und rendert die Daten. So wächst der Contentbestand, ohne dass für jede neue Seite Website-Code kopiert werden muss.
