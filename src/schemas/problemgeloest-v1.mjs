export const problemGeloestSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'duplicate_of_slug',
    'problem',
    'diagnostic_flow',
    'solution_paths',
    'seo',
    'product_slots',
    'related_problem_slugs'
  ],
  properties: {
    schema_version: { type: 'integer', enum: [1] },
    duplicate_of_slug: { type: ['string', 'null'] },
    problem: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'slug', 'main_keyword', 'search_intent', 'user_question', 'keywords'],
      properties: {
        name: { type: 'string' },
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        main_keyword: { type: 'string' },
        search_intent: { type: 'string', enum: ['problem_solution', 'diagnosis', 'how_to', 'prevention'] },
        user_question: { type: 'string' },
        keywords: {
          type: 'array',
          minItems: 3,
          maxItems: 10,
          items: { type: 'string' }
        }
      }
    },
    diagnostic_flow: {
      type: 'object',
      additionalProperties: false,
      required: ['start_question_id', 'questions'],
      properties: {
        start_question_id: { type: 'string' },
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'question', 'options'],
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              options: {
                type: 'array',
                minItems: 2,
                maxItems: 5,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'label', 'next_question_id', 'result_path_id'],
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    next_question_id: { type: ['string', 'null'] },
                    result_path_id: { type: ['string', 'null'] }
                  }
                }
              }
            }
          }
        }
      }
    },
    solution_paths: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'title', 'assessment', 'immediate_action', 'free_solution',
          'recommended_solution', 'premium_solution', 'prevention', 'warnings'
        ],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          assessment: { type: 'string' },
          immediate_action: { type: 'string' },
          free_solution: { type: 'string' },
          recommended_solution: { type: 'string' },
          premium_solution: { type: 'string' },
          prevention: { type: 'string' },
          warnings: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string' }
          }
        }
      }
    },
    seo: {
      type: 'object',
      additionalProperties: false,
      required: ['seo_title', 'meta_description', 'h1', 'faq'],
      properties: {
        seo_title: { type: 'string' },
        meta_description: { type: 'string' },
        h1: { type: 'string' },
        faq: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'answer'],
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' }
            }
          }
        }
      }
    },
    product_slots: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'solution_path_id', 'slot', 'product_type_slug', 'product_type_name',
          'product_type_description', 'cta', 'sort_order'
        ],
        properties: {
          solution_path_id: { type: 'string' },
          slot: { type: 'string', enum: ['cheap', 'recommended', 'premium'] },
          product_type_slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          product_type_name: { type: 'string' },
          product_type_description: { type: 'string' },
          cta: { type: 'string' },
          sort_order: { type: 'integer', minimum: 0, maximum: 1000 }
        }
      }
    },
    related_problem_slugs: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }
    }
  }
};
