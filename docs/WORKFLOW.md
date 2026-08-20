# Entwicklungs- und Release-Workflow

## Branches

- `main`: einziges Production-Release-Branch.
- `feature/<name>`: Änderungen und neue Funktionen.
- `fix/<name>`: Fehlerbehebungen.

## Ablauf

1. Neue Branch erstellen.
2. Änderung lokal durchführen.
3. `npm run validate`.
4. Commit + Push.
5. Vercel Preview prüfen.
6. Erst nach erfolgreichem Test nach `main` mergen.
7. Vercel deployed `main` automatisch nach Production.

## Grundregel

Nach Einrichtung der Git-Integration keine normalen Production-Deploys mehr aus zufälligen lokalen Ordnern per `vercel --prod`. GitHub muss nachvollziehen können, welcher Commit live ist.

## Secrets

`.env.local` bleibt lokal. Vercel-Environment-Variablen werden im Vercel-Projekt verwaltet. Secrets nie in Issues, Commits, Screenshots oder Quellcode posten.

## Datenbank

Schemaänderungen immer mit einer Datei unter `supabase/migrations/`. Siehe `docs/DATABASE.md`.
