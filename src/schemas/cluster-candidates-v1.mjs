export const clusterCandidatesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['batch_version', 'cluster_slug', 'candidates'],
  properties: {
    batch_version: { type: 'integer', enum: [1] },
    cluster_slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    candidates: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'slug',
          'main_keyword',
          'search_intent',
          'intent_summary',
          'why_distinct',
          'duplicate_of_slug',
          'decision',
          'decision_reason'
        ],
        properties: {
          name: { type: 'string' },
          slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          main_keyword: { type: 'string' },
          search_intent: { type: 'string', enum: ['problem_solution', 'diagnosis', 'how_to', 'prevention'] },
          intent_summary: { type: 'string' },
          why_distinct: { type: 'string' },
          duplicate_of_slug: { type: ['string', 'null'] },
          decision: { type: 'string', enum: ['generate', 'skip'] },
          decision_reason: { type: 'string' }
        }
      }
    }
  }
};
