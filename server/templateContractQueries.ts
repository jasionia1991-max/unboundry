import type { DatabaseSync } from "node:sqlite";

export function publishedTemplateIdsUsingModel(
  store: DatabaseSync,
  modelId: string,
) {
  return (store.prepare(`
    SELECT DISTINCT public_templates.id
    FROM public_templates
    JOIN json_tree(
      CASE WHEN json_valid(public_templates.graph)
        THEN public_templates.graph ELSE '{}'
      END
    ) AS value
    WHERE
      public_templates.status = 'published'
      AND value.type = 'text'
      AND value.value = ?
    ORDER BY public_templates.id
  `).all(modelId) as Array<{ id: string }>).map((row) => row.id);
}

export function publishedTemplateGraphs(store: DatabaseSync) {
  return store.prepare(`
    SELECT id, graph FROM public_templates
    WHERE status = 'published' ORDER BY id
  `).all() as Array<{ graph: string; id: string }>;
}
