import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { clusterCandidatesSchema } from '../src/schemas/cluster-candidates-v1.mjs';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.resolve('.env.local'));

const args = process.argv.slice(2);
const clusterSlug = args.find((arg) => !arg.startsWith('--')) || 'fliegen';
const generate = args.includes('--generate');
const refresh = args.includes('--refresh');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`\nProblemGelöst Batch v2\n\nKandidaten planen:\n  npm run batch:cluster -- fliegen\n\nLetzte Kandidaten generieren/resumen:\n  npm run batch:cluster -- fliegen --generate\n\nNeu planen + generieren:\n  npm run batch:cluster -- fliegen --generate --refresh\n\nBereits vorhandene Drafts werden automatisch übersprungen.`);
  process.exit(0);
}

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPENAI_API_KEY'];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Fehlende .env.local Werte: ${missing.join(', ')}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PLANNER_MODEL = process.env.OPENAI_PLANNER_MODEL || 'gpt-5.6-luna';
const PLANNER_REASONING = process.env.OPENAI_PLANNER_REASONING || 'none';
const PLANNER_TIMEOUT_MS = Number(process.env.OPENAI_PLANNER_TIMEOUT_MS || 90000);
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.BATCH_CONCURRENCY || 2)));

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchWithRetry(url, options = {}, label = 'Request', maxAttempts = 2, timeoutMs = 90000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${label} Timeout nach ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      const body = await response.text();
      lastError = new Error(`${label} ${response.status}: ${body}`);
      if (attempt === maxAttempts) throw lastError;
      console.warn(`⚠ ${label} ${response.status}; Retry ${attempt}/${maxAttempts - 1} ...`);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === maxAttempts) throw error;
      const cause = error?.cause?.code || error?.cause?.message || error?.message || String(error);
      console.warn(`⚠ ${label} Netzwerk/Timeout: ${cause}; Retry ${attempt}/${maxAttempts - 1} ...`);
    }
    await sleep(1000 * attempt);
  }
  throw lastError;
}

async function supabase(pathname, options = {}) {
  const response = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    }
  }, 'Supabase', 2, 30000);
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
      if (content.type === 'refusal') throw new Error(`OpenAI refusal: ${content.refusal}`);
    }
  }
  throw new Error('OpenAI hat keinen auswertbaren Structured Output geliefert.');
}

function validateCandidates(data, existingProblems, { allowNowExisting = false } = {}) {
  const errors = [];
  const existingSlugs = new Set(existingProblems.map((p) => p.slug));
  const seenSlugs = new Set();
  if (data.cluster_slug !== clusterSlug) errors.push(`cluster_slug muss '${clusterSlug}' sein.`);
  if (data.candidates.length !== 10) errors.push('Batch muss exakt 10 Kandidaten enthalten.');

  for (const c of data.candidates) {
    if (seenSlugs.has(c.slug)) errors.push(`Kandidaten-Slug doppelt: '${c.slug}'.`);
    seenSlugs.add(c.slug);
    if (existingSlugs.has(c.slug) && !c.duplicate_of_slug && !allowNowExisting) {
      errors.push(`Kandidat '${c.slug}' existiert bereits, aber duplicate_of_slug ist leer.`);
    }
    if (c.duplicate_of_slug && !existingSlugs.has(c.duplicate_of_slug)) {
      errors.push(`Kandidat '${c.slug}' verweist auf unbekannte Dublette '${c.duplicate_of_slug}'.`);
    }
    if (c.duplicate_of_slug && c.decision !== 'skip') errors.push(`Kandidat '${c.slug}' mit Dublette muss decision='skip' haben.`);
  }
  if (errors.length) throw new Error(`Kandidaten-Validierung fehlgeschlagen:\n- ${errors.join('\n- ')}`);
}

async function generateCandidateList(cluster, existingProblems) {
  const existing = existingProblems.map((p) => ({
    name: p.name, slug: p.slug, main_keyword: p.main_keyword, user_question: p.user_question, status: p.status
  }));
  const instructions = `Du planst neue Seiten für ProblemGelöst, eine deutschsprachige Problem→Lösung→Produkt-Engine.\n\nAUFGABE:\n- Erzeuge exakt 10 mögliche neue Problemseiten für den angegebenen Cluster.\n- Die Kandidaten müssen klar unterschiedliche Suchintentionen haben.\n- Vergleiche jeden Kandidaten mit ALLEN vorhandenen Problemen.\n- Bloße Keyword-, Raum- oder Formulierungsvariationen sind keine neue Seite, wenn Nutzerfrage und Lösung im Wesentlichen gleich sind.\n- Wenn ausreichend abgedeckt: duplicate_of_slug setzen und decision='skip'.\n- decision='generate' nur bei eigenständiger hilfreicher Suchintention.\n- Bevorzuge konkrete Alltagsprobleme mit klarer Diagnose-/Lösungslogik und sinnvoller Produktnähe.\n- Keine erfundenen Suchvolumina oder Wettbewerbszahlen.\n- Deutscher Content, Slugs ASCII mit ae/oe/ue.\n- Ergebnis exakt nach JSON-Schema.`;
  const payload = { cluster: { name: cluster.name, slug: cluster.slug, description: cluster.description }, existing_problems: existing, target_candidate_count: 10 };

  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      store: false,
      reasoning: { effort: PLANNER_REASONING },
      max_output_tokens: 5000,
      instructions,
      input: JSON.stringify(payload, null, 2),
      text: { format: { type: 'json_schema', name: 'problemgeloest_cluster_candidates_v1', description: 'Zehn geprüfte Kandidaten.', strict: true, schema: clusterCandidatesSchema } }
    })
  }, 'OpenAI Planner', 2, PLANNER_TIMEOUT_MS);

  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const data = JSON.parse(extractOutputText(body));
  validateCandidates(data, existingProblems);
  return { data, responseId: body.id, model: body.model || PLANNER_MODEL, usage: body.usage || null };
}

function batchPaths() {
  const outDir = path.resolve('generated', 'batches');
  fs.mkdirSync(outDir, { recursive: true });
  return { outDir, latest: path.join(outDir, `${clusterSlug}-latest.json`) };
}

function saveBatch(generated) {
  const { outDir, latest } = batchPaths();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const versioned = path.join(outDir, `${clusterSlug}-${stamp}.json`);
  const content = JSON.stringify({ generated_at: new Date().toISOString(), openai_response_id: generated.responseId, model: generated.model, usage: generated.usage, data: generated.data }, null, 2);
  fs.writeFileSync(versioned, content);
  fs.writeFileSync(latest, content);
  return { versioned, latest };
}

function loadLatestBatch() {
  const { latest } = batchPaths();
  if (!fs.existsSync(latest)) throw new Error(`Keine Kandidatenliste gefunden: ${path.relative(process.cwd(), latest)}`);
  return JSON.parse(fs.readFileSync(latest, 'utf8'));
}

function printCandidates(batch, existingSlugs = new Set()) {
  console.log('\nKandidaten:');
  batch.data.candidates.forEach((c, i) => {
    const already = existingSlugs.has(c.slug);
    const marker = already ? '↷' : (c.decision === 'generate' && !c.duplicate_of_slug ? '✓' : '–');
    console.log(`${String(i + 1).padStart(2, ' ')}. ${marker} ${c.name}`);
    if (already) console.log('    RESUME: bereits in Supabase vorhanden → wird übersprungen');
    else console.log(`    ${c.decision.toUpperCase()}: ${c.decision_reason}`);
    if (c.duplicate_of_slug) console.log(`    Dublette von: ${c.duplicate_of_slug}`);
  });
}

function prefixStream(stream, prefix) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) console.log(`${prefix} ${line}`);
  });
  stream.on('end', () => { if (buffer.trim()) console.log(`${prefix} ${buffer}`); });
}

function runCandidate(candidate, ordinal, total) {
  return new Promise((resolve) => {
    const start = Date.now();
    const prefix = `[${ordinal}/${total} ${candidate.slug}]`;
    console.log(`\n▶ ${prefix} ${candidate.name}`);
    const child = spawn(process.execPath, [
      path.resolve('scripts', 'generate-problem.mjs'), candidate.name,
      '--cluster', clusterSlug,
      '--expected-slug', candidate.slug
    ], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });

    prefixStream(child.stdout, prefix);
    prefixStream(child.stderr, prefix);
    child.on('error', (error) => resolve({ candidate, ok: false, error: error.message, seconds: (Date.now() - start) / 1000 }));
    child.on('close', (code) => {
      const seconds = (Date.now() - start) / 1000;
      console.log(`${code === 0 ? '✓' : '✗'} ${prefix} ${code === 0 ? 'fertig' : `fehlgeschlagen (Code ${code})`} nach ${seconds.toFixed(0)}s`);
      resolve({ candidate, ok: code === 0, code, seconds });
    });
  });
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

async function generateDrafts(batch, existingProblems) {
  const existingSlugs = new Set(existingProblems.map((p) => p.slug));
  const eligible = batch.data.candidates.filter((c) => c.decision === 'generate' && !c.duplicate_of_slug);
  const pending = eligible.filter((c) => !existingSlugs.has(c.slug));
  const resumed = eligible.filter((c) => existingSlugs.has(c.slug));

  console.log(`\nBatch v2: ${pending.length} offen, ${resumed.length} bereits vorhanden, Parallelität=${CONCURRENCY}.`);
  if (!pending.length) {
    console.log('✓ Nichts mehr zu tun. Alle freigegebenen Kandidaten sind bereits in Supabase.');
    return;
  }

  const started = Date.now();
  const results = await runPool(pending, CONCURRENCY, (candidate, index) => runCandidate(candidate, index + 1, pending.length));
  const created = results.filter((r) => r?.ok).map((r) => r.candidate.slug);
  const failed = results.filter((r) => r && !r.ok).map((r) => r.candidate.slug);
  const duration = (Date.now() - started) / 1000;

  console.log('\n================ BATCH V2 ================');
  console.log(`Neu erfolgreich:             ${created.length}`);
  console.log(`Schon vorhanden (Resume):    ${resumed.length}`);
  console.log(`Fehlgeschlagen:              ${failed.length}`);
  console.log(`Gesamtdauer:                 ${(duration / 60).toFixed(1)} min`);
  if (failed.length) {
    console.log(`Fehlgeschlagen: ${failed.join(', ')}`);
    console.log(`Einfach denselben Befehl erneut starten. Erfolgreiche Seiten werden übersprungen, nur offene/fehlgeschlagene werden erneut versucht.`);
  }
}

async function main() {
  console.log('\nProblemGelöst Batch Engine v2');
  console.log(`Cluster:      ${clusterSlug}`);
  console.log(`Planner:      ${PLANNER_MODEL} (reasoning=${PLANNER_REASONING})`);
  console.log(`Problemseite: ${process.env.OPENAI_PROBLEM_MODEL || 'gpt-5.6-terra'} (reasoning=${process.env.OPENAI_PROBLEM_REASONING || 'none'})`);
  console.log(`Parallelität: ${CONCURRENCY}`);
  console.log(`Modus:        ${generate ? 'Drafts generieren/resumen' : 'nur Kandidaten planen'}\n`);

  const clusters = await supabase(`clusters?select=*&slug=eq.${encodeURIComponent(clusterSlug)}&limit=1`, { method: 'GET' });
  const cluster = clusters?.[0];
  if (!cluster) throw new Error(`Cluster '${clusterSlug}' nicht gefunden.`);

  let existingProblems = await supabase(`problems?select=id,name,slug,main_keyword,user_question,status&cluster_id=eq.${cluster.id}&order=name.asc`, { method: 'GET' });
  console.log(`Kontext: ${existingProblems.length} bestehende Probleme.`);

  let batch;
  if (!generate || refresh) {
    console.log('Erzeuge und prüfe 10 Kandidaten ...');
    const generated = await generateCandidateList(cluster, existingProblems);
    const paths = saveBatch(generated);
    batch = JSON.parse(fs.readFileSync(paths.latest, 'utf8'));
    console.log(`Gespeichert: ${path.relative(process.cwd(), paths.versioned)}`);
  } else {
    batch = loadLatestBatch();
    validateCandidates(batch.data, existingProblems, { allowNowExisting: true });
    console.log(`Verwende geprüfte Liste: generated/batches/${clusterSlug}-latest.json`);
  }

  const existingSlugs = new Set(existingProblems.map((p) => p.slug));
  printCandidates(batch, existingSlugs);

  if (!generate) {
    console.log(`\nNoch NICHTS gespeichert. Danach:\n  npm run batch:cluster -- ${clusterSlug} --generate`);
    return;
  }

  // Direkt vor dem Start noch einmal lesen: Resume soll auch zwischenzeitliche Inserts erkennen.
  existingProblems = await supabase(`problems?select=id,name,slug,main_keyword,user_question,status&cluster_id=eq.${cluster.id}&order=name.asc`, { method: 'GET' });
  await generateDrafts(batch, existingProblems);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  const cause = error?.cause?.code || error?.cause?.message;
  if (cause) console.error(`  Ursache: ${cause}`);
  process.exit(1);
});
