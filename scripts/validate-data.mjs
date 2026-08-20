import fs from 'node:fs';

const path = new URL('../src/data/problems.json', import.meta.url);
const problems = JSON.parse(fs.readFileSync(path, 'utf8'));
const errors = [];
const requiredFields = [
  'problem_id', 'category', 'subcategory', 'cluster', 'problem', 'slug',
  'primary_query', 'intent', 'likely_causes', 'immediate_solution',
  'solution_steps', 'prevention', 'seo_title', 'meta_description', 'status'
];

const ids = new Set();
const slugs = new Set();
const queries = new Set();

for (const [index, problem] of problems.entries()) {
  const where = `Datensatz ${index + 1} (${problem.problem_id ?? 'ohne ID'})`;

  for (const field of requiredFields) {
    if (problem[field] === undefined || problem[field] === null || problem[field] === '') {
      errors.push(`${where}: Pflichtfeld "${field}" fehlt.`);
    }
  }

  if (ids.has(problem.problem_id)) errors.push(`${where}: problem_id doppelt: ${problem.problem_id}`);
  ids.add(problem.problem_id);

  if (slugs.has(problem.slug)) errors.push(`${where}: slug doppelt: ${problem.slug}`);
  slugs.add(problem.slug);

  const normalizedQuery = String(problem.primary_query ?? '').trim().toLowerCase();
  if (queries.has(normalizedQuery)) errors.push(`${where}: primary_query doppelt: ${problem.primary_query}`);
  queries.add(normalizedQuery);

  if (!/^[a-z0-9-]+$/.test(problem.slug ?? '')) {
    errors.push(`${where}: slug enthält ungültige Zeichen: ${problem.slug}`);
  }

  if (!Array.isArray(problem.solution_steps) || problem.solution_steps.length < 2) {
    errors.push(`${where}: mindestens 2 solution_steps erforderlich.`);
  }

  if ((problem.meta_description ?? '').length > 170) {
    errors.push(`${where}: meta_description ist länger als 170 Zeichen.`);
  }
}

for (const problem of problems) {
  for (const relatedId of problem.related_problem_ids ?? []) {
    if (!ids.has(relatedId)) {
      console.warn(`Hinweis: ${problem.problem_id} verweist auf noch nicht vorhandenes Problem ${relatedId}. Link wird ausgelassen.`);
    }
  }
}

if (errors.length) {
  console.error('\nDatenvalidierung fehlgeschlagen:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Daten OK: ${problems.length} Problemdatensätze, ${slugs.size} eindeutige URLs.`);
