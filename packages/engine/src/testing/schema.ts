/** The parts of a JSON Schema that undocumented() walks. */
export interface DescribedSchema {
  description?: string;
  properties?: Record<string, DescribedSchema>;
  anyOf?: DescribedSchema[];
  [key: string]: unknown;
}

/**
 * Every property in a JSON Schema that has no description, by dotted path. A property
 * whose anyOf options carry the description (a secret reference) counts as described.
 */
export function undocumented(schema: DescribedSchema, path = ''): string[] {
  const missing: string[] = [];
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const at = path === '' ? name : `${path}.${name}`;
    const described =
      child.description !== undefined ||
      (child.anyOf ?? []).some((option) => option.description !== undefined);
    if (!described) missing.push(at);
    missing.push(...undocumented(child, at));
    for (const option of child.anyOf ?? []) missing.push(...undocumented(option, at));
  }
  return missing;
}
