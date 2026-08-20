# Deployment

## Production

Nach GitHub/Vercel-Verknüpfung deployt ein Push/Merge auf `main` automatisch nach Production.

## Preview

Jeder andere Branch bzw. Pull Request erzeugt ein Vercel Preview Deployment. Änderungen zuerst dort testen, dann nach `main` mergen.

## Vercel Environment Variables

Für Website-Build/Frontend erforderlich:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Diese Variablen müssen mindestens für **Production und Preview** gesetzt sein.

Für lokale Content-Engine, nicht für Browser/Production nötig, sofern keine Server-Automation läuft:
- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`

Secrets niemals in GitHub-Quellcode schreiben.
