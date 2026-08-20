const supabaseUrl = import.meta.env.SUPABASE_URL;
const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY;

function assertConfig() {
  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      'Supabase-Konfiguration fehlt. Setze SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY in .env.local.'
    );
  }
}

async function apiGet(path: string) {
  assertConfig();

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: publishableKey,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase Data API ${response.status}: ${body}`);
  }

  return response.json();
}

function pickBestOffer(offers: any[], productTypeId: string) {
  return offers
    .filter((offer) => offer.product_type_id === productTypeId && offer.status === 'active')
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0] ?? null;
}

export async function getPublishedProblemPages() {
  const [clusters, problems, productTypes, offers, slots, relations] = await Promise.all([
    apiGet('clusters?select=*&status=eq.active'),
    apiGet('problems?select=*&status=eq.published'),
    apiGet('product_types?select=*&status=eq.active'),
    apiGet('affiliate_offers?select=*&status=eq.active'),
    apiGet('problem_product_slots?select=*'),
    apiGet('problem_relations?select=*')
  ]);

  const clusterById = new Map(clusters.map((cluster: any) => [cluster.id, cluster]));
  const problemById = new Map(problems.map((problem: any) => [problem.id, problem]));
  const productTypeById = new Map(productTypes.map((type: any) => [type.id, type]));

  return problems.map((problem: any) => {
    const cluster: any = clusterById.get(problem.cluster_id);

    const enrichedSlots = slots
      .filter((slot: any) => slot.problem_id === problem.id)
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((slot: any) => {
        const productType: any = productTypeById.get(slot.product_type_id);
        const offer = pickBestOffer(offers, slot.product_type_id);

        return {
          ...slot,
          product_type: productType
            ? {
                id: productType.id,
                name: productType.name,
                slug: productType.slug,
                description: productType.description
              }
            : null,
          offer
        };
      });

    const relatedProblems = relations
      .filter((relation: any) => relation.problem_id === problem.id)
      .sort((a: any, b: any) => (b.weight ?? 0) - (a.weight ?? 0))
      .map((relation: any) => {
        const related: any = problemById.get(relation.related_problem_id);
        if (!related) return null;
        const relatedCluster: any = clusterById.get(related.cluster_id);
        if (!relatedCluster) return null;
        return {
          name: related.name,
          slug: related.slug,
          cluster_slug: relatedCluster.slug,
          weight: relation.weight,
          relation_type: relation.relation_type
        };
      })
      .filter(Boolean);

    return {
      ...problem,
      cluster,
      product_slots: enrichedSlots,
      related_problems: relatedProblems
    };
  });
}
