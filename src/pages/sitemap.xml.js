import { getPublishedProblemPages } from '../lib/supabase-rest';

const SITE_URL = 'https://www.xn--problemgelst-ejb.com';

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function GET() {
  const pages = await getPublishedProblemPages();
  const paths = new Set(['/']);

  for (const problem of pages) {
    if (!problem.cluster?.slug) continue;

    paths.add(`/${problem.cluster.slug}/`);

    if (problem.slug) {
      paths.add(`/${problem.cluster.slug}/${problem.slug}/`);
    }
  }

  const urls = Array.from(paths)
    .sort()
    .map((path) => {
      const loc = escapeXml(new URL(path, SITE_URL).href);
      return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
}
