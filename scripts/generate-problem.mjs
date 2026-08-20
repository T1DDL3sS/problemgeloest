import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { problemGeloestSchema } from '../src/schemas/problemgeloest-v1.mjs';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.resolve('.env.local'));

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const clusterArgIndex = args.indexOf('--cluster');
const clusterSlug = clusterArgIndex >= 0 ? args[clusterArgIndex + 1] : 'fliegen';
const dryRun = args.includes('--dry-run');
const expectedSlugIndex = args.indexOf('--expected-slug');
const expectedSlug = expectedSlugIndex >= 0 ? args[expectedSlugIndex + 1] : null;

if (!input) {
  console.error('Fehlt: Problemname. Beispiel: npm run generate:problem -- "Fliegen im Schlafzimmer"');
  process.exit(1);
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
const OPENAI_MODEL = process.env.OPENAI_PROBLEM_MODEL || 'gpt-5.6-terra';
const OPENAI_REASONING_EFFORT = process.env.OPENAI_PROBLEM_REASONING || 'none';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 120000);
const OPENAI_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.OPENAI_MAX_ATTEMPTS || 2)));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, label = 'Request', maxAttempts = OPENAI_MAX_ATTEMPTS, timeoutMs = OPENAI_TIMEOUT_MS) {
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
      console.warn(`⚠ ${label} fehlgeschlagen (${response.status}). Retry ${attempt}/${maxAttempts - 1} ...`);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === maxAttempts) throw error;
      const cause = error?.cause?.code || error?.cause?.message || error?.message || String(error);
      console.warn(`⚠ ${label} Netzwerk/Timeout: ${cause}. Retry ${attempt}/${maxAttempts - 1} ...`);
    }
    await sleep(1000 * attempt);
  }
  throw lastError;
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function validateGraph(data, context) {
  const errors = [];
  const questionIdList = data.diagnostic_flow.questions.map((q) => q.id);
  const pathIdList = data.solution_paths.map((p) => p.id);
  const questionIds = new Set(questionIdList);
  const pathIds = new Set(pathIdList);
  const existingProblemSlugs = new Set(context.existingProblems.map((p) => p.slug));

  if (questionIds.size !== questionIdList.length) errors.push('Diagnosefrage-IDs müssen eindeutig sein.');
  if (pathIds.size !== pathIdList.length) errors.push('Solution-Path-IDs müssen eindeutig sein.');
  if (new Set(data.problem.keywords.map((k) => k.toLowerCase())).size !== data.problem.keywords.length) {
    errors.push('Keywords dürfen keine Dubletten enthalten.');
  }
  if (data.seo.seo_title.length > 70) errors.push('seo_title ist länger als 70 Zeichen.');
  if (data.seo.meta_description.length > 170) errors.push('meta_description ist länger als 170 Zeichen.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.problem.slug)) errors.push('Problem-Slug ist nicht ASCII/kebab-case.');
  for (const slug of data.related_problem_slugs) {
    if (!existingProblemSlugs.has(slug)) errors.push(`Unbekannter related_problem_slug '${slug}'.`);
  }

  if (!questionIds.has(data.diagnostic_flow.start_question_id)) {
    errors.push(`start_question_id '${data.diagnostic_flow.start_question_id}' existiert nicht.`);
  }

  for (const question of data.diagnostic_flow.questions) {
    for (const option of question.options) {
      const hasNext = Boolean(option.next_question_id);
      const hasResult = Boolean(option.result_path_id);
      if (hasNext === hasResult) {
        errors.push(`${question.id}/${option.id}: genau next_question_id ODER result_path_id muss gesetzt sein.`);
      }
      if (hasNext && !questionIds.has(option.next_question_id)) {
        errors.push(`${question.id}/${option.id}: unbekannte next_question_id '${option.next_question_id}'.`);
      }
      if (hasResult && !pathIds.has(option.result_path_id)) {
        errors.push(`${question.id}/${option.id}: unbekannte result_path_id '${option.result_path_id}'.`);
      }
    }
  }

  for (const slot of data.product_slots) {
    if (!pathIds.has(slot.solution_path_id)) {
      errors.push(`Product Slot verweist auf unbekannten solution_path_id '${slot.solution_path_id}'.`);
    }
  }

  if (errors.length) throw new Error(`Lokale Validierung fehlgeschlagen:\n- ${errors.join('\n- ')}`);
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

async function generateWithOpenAI(context) {
  const existingProblemSummary = context.existingProblems.map((p) => ({
    name: p.name,
    slug: p.slug,
    main_keyword: p.main_keyword,
    user_question: p.user_question
  }));

  const productTypeSummary = context.productTypes.map((p) => ({
    name: p.name,
    slug: p.slug,
    description: p.description
  }));

  const instructions = `Du erzeugst strukturierte Datensätze für ProblemGelöst, eine deutschsprachige Mobile-First Problem→Lösung→Produkt-Engine.\n\nREGELN:\n- Eine Seite entspricht einer klar unterscheidbaren Suchintention, nicht bloß einer Keywordvariation.\n- Prüfe die vorhandenen Probleme. Wenn der neue Input im Wesentlichen dieselbe Suchintention wie ein bestehendes Problem hat, setze duplicate_of_slug auf dessen Slug. Erzeuge trotzdem einen vollständigen Datensatz zur Prüfung.\n- Diagnosefragen müssen kurz, laienverständlich und per Button beantwortbar sein.\n- Jeder Antwortpfad endet eindeutig in genau einem solution_path.\n- Lösungen priorisieren Ursachenbeseitigung und kostenlose Sofortmaßnahmen vor Produkten.\n- Produkte nur vorschlagen, wenn sie sachlich sinnvoll sind. product_type beschreibt eine langlebige Produktkategorie, niemals ein konkretes Marken-/Shopprodukt oder einen Affiliate-Link.\n- Verwende vorhandene product_type_slugs, wenn sie semantisch passen; erfinde nur bei echter Lücke einen neuen Typ.\n- related_problem_slugs dürfen nur Slugs aus der Liste vorhandener Probleme enthalten.\n- Keine erfundenen Studien, Garantien oder übertriebenen Gesundheits-/Sicherheitsbehauptungen.\n- SEO natürlich und hilfreich, kein Keyword-Stuffing.\n- Deutscher Content, Slugs ASCII mit ae/oe/ue statt Umlauten.\n- Das Ergebnis muss exakt dem JSON-Schema entsprechen.`;

  const userPayload = {
    cluster: { name: context.cluster.name, slug: context.cluster.slug, description: context.cluster.description },
    requested_problem: input,
    existing_problems: existingProblemSummary,
    existing_product_types: productTypeSummary
  };

  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      store: false,
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      max_output_tokens: 12000,
      instructions,
      input: JSON.stringify(userPayload, null, 2),
      text: {
        format: {
          type: 'json_schema',
          name: 'problemgeloest_problem_v1',
          description: 'Ein vollständiger ProblemGelöst Problem-Datensatz nach Schema v1.',
          strict: true,
          schema: problemGeloestSchema
        }
      }
    })
  }, 'OpenAI');

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  const data = JSON.parse(extractOutputText(body));
  if (expectedSlug && data.problem.slug !== expectedSlug) {
    throw new Error(`Slug-Guard: erwartet '${expectedSlug}', KI lieferte '${data.problem.slug}'. Nichts gespeichert.`);
  }
  validateGraph(data, context);
  return { data, responseId: body.id, model: body.model || OPENAI_MODEL, usage: body.usage || null };
}

async function upsertProductType(slot) {
  const encodedSlug = encodeURIComponent(slot.product_type_slug);
  const existing = await supabase(`product_types?select=*&slug=eq.${encodedSlug}&limit=1`, { method: 'GET' });
  if (existing?.length) return existing[0];

  // Parallel-safe upsert: zwei Worker dürfen denselben Produkttyp gleichzeitig benötigen.
  const created = await supabase('product_types?on_conflict=slug', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      name: slot.product_type_name,
      slug: slot.product_type_slug,
      description: slot.product_type_description,
      status: 'active'
    })
  });
  return created[0];
}

async function persist(data, context) {
  const slugCheck = await supabase(`problems?select=id,name,slug&cluster_id=eq.${context.cluster.id}&slug=eq.${encodeURIComponent(data.problem.slug)}&limit=1`, { method: 'GET' });
  if (slugCheck?.length) throw new Error(`Problem-Slug '${data.problem.slug}' existiert bereits (${slugCheck[0].name}).`);

  if (data.duplicate_of_slug) {
    throw new Error(`Dubletten-Guard: Die KI hält dieses Problem für dieselbe Suchintention wie '${data.duplicate_of_slug}'. Nichts wurde gespeichert.`);
  }

  let createdProblem = null;
  try {
    const createdProblems = await supabase('problems', {
      method: 'POST',
      body: JSON.stringify({
        cluster_id: context.cluster.id,
        name: data.problem.name,
        slug: data.problem.slug,
        status: 'draft',
        schema_version: 1,
        main_keyword: data.problem.main_keyword,
        search_intent: data.problem.search_intent,
        user_question: data.problem.user_question,
        keywords: data.problem.keywords,
        diagnostic_flow: data.diagnostic_flow,
        solution_paths: data.solution_paths,
        seo_title: data.seo.seo_title,
        meta_description: data.seo.meta_description,
        h1: data.seo.h1,
        faq: data.seo.faq
      })
    });
    createdProblem = createdProblems[0];

    for (const slot of data.product_slots) {
      const productType = await upsertProductType(slot);
      await supabase('problem_product_slots', {
        method: 'POST',
        body: JSON.stringify({
          problem_id: createdProblem.id,
          solution_path_id: slot.solution_path_id,
          slot: slot.slot,
          product_type_id: productType.id,
          cta: slot.cta,
          sort_order: slot.sort_order
        })
      });
    }

    const existingBySlug = new Map(context.existingProblems.map((p) => [p.slug, p]));
    for (const relatedSlug of data.related_problem_slugs) {
      const related = existingBySlug.get(relatedSlug);
      if (!related) continue;
      await supabase('problem_relations', {
        method: 'POST',
        body: JSON.stringify({
          problem_id: createdProblem.id,
          related_problem_id: related.id,
          relation_type: 'related',
          weight: 70
        })
      });
    }

    return createdProblem;
  } catch (error) {
    // Kompensierender Cleanup: keine halbfertige Problemseite stehen lassen.
    try {
      const slug = encodeURIComponent(data.problem.slug);
      await supabase(`problems?cluster_id=eq.${context.cluster.id}&slug=eq.${slug}&status=eq.draft`, { method: 'DELETE' });
    } catch (cleanupError) {
      console.warn(`⚠ Cleanup fehlgeschlagen: ${cleanupError.message}`);
    }
    throw error;
  }
}

async function main() {
  console.log(`\nProblemGelöst Content Engine v1`);
  console.log(`Input:   ${input}`);
  console.log(`Cluster: ${clusterSlug}`);
  console.log(`Model:   ${OPENAI_MODEL} (reasoning=${OPENAI_REASONING_EFFORT})`);
  console.log(`Timeout: ${Math.round(OPENAI_TIMEOUT_MS / 1000)}s, Versuche: ${OPENAI_MAX_ATTEMPTS}\n`);

  const clusters = await supabase(`clusters?select=*&slug=eq.${encodeURIComponent(clusterSlug)}&limit=1`, { method: 'GET' });
  const cluster = clusters?.[0];
  if (!cluster) throw new Error(`Cluster '${clusterSlug}' nicht gefunden.`);

  const [existingProblems, productTypes] = await Promise.all([
    supabase(`problems?select=id,name,slug,main_keyword,user_question,status&cluster_id=eq.${cluster.id}&order=name.asc`, { method: 'GET' }),
    supabase('product_types?select=id,name,slug,description,status&status=eq.active&order=name.asc', { method: 'GET' })
  ]);

  console.log(`Kontext: ${existingProblems.length} bestehende Probleme, ${productTypes.length} aktive Produkttypen.`);
  console.log('Generiere strukturierten Datensatz ...');

  const generated = await generateWithOpenAI({ cluster, existingProblems, productTypes });
  const data = generated.data;

  console.log(`\nErgebnis: ${data.problem.name}`);
  console.log(`Slug:     ${data.problem.slug}`);
  console.log(`Pfade:    ${data.solution_paths.length}`);
  console.log(`Slots:    ${data.product_slots.length}`);
  console.log(`Dublettenhinweis: ${data.duplicate_of_slug || 'nein'}`);

  const outDir = path.resolve('generated');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${data.problem.slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    openai_response_id: generated.responseId,
    model: generated.model,
    usage: generated.usage,
    data
  }, null, 2));
  console.log(`JSON:     ${path.relative(process.cwd(), outFile)}`);

  if (dryRun) {
    console.log('\n--dry-run aktiv: nichts in Supabase gespeichert.');
    return;
  }

  const created = await persist(data, { cluster, existingProblems });
  console.log(`\n✓ Als draft in Supabase gespeichert.`);
  console.log(`Problem-ID: ${created.id}`);
  console.log('Nächster Schritt: im Supabase Table Editor prüfen und erst danach published setzen.');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  const cause = error?.cause?.code || error?.cause?.message;
  if (cause) console.error(`  Ursache: ${cause}`);
  process.exit(1);
});
