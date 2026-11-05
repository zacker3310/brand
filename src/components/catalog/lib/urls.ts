export const systemHref = (slug: string) => `/systems/${encodeURIComponent(slug)}`;
export const componentTypeHref = (slug: string) => `/components/${encodeURIComponent(slug)}`;
export const componentHref = (system: string, slug: string) =>
  `/systems/${encodeURIComponent(system)}/components/${encodeURIComponent(slug)}`;
export const tokensHref = (system: string, q?: string) =>
  `/tokens?system=${encodeURIComponent(system)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
export const compareHref = (type: string, systems: string[]) =>
  `/compare?type=${encodeURIComponent(type)}${systems.length ? `&systems=${systems.map(encodeURIComponent).join(",")}` : ""}`;
export const patternHref = (system: string, slug: string) =>
  `/systems/${encodeURIComponent(system)}/patterns/${encodeURIComponent(slug)}`;
