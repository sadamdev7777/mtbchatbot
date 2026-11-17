/** Turns "[nama] ... [destinasi]" into Meta's {{1}} ... {{2}} and builds the components array. */
export function buildTemplateComponents(body: string, buttons: string[], examples: Record<string, string>) {
  const names: string[] = [];
  const text = body.replace(/\[([^\]]+)\]/g, (_m, n: string) => {
    const key = n.trim();
    let i = names.indexOf(key);
    if (i < 0) { names.push(key); i = names.length - 1; }
    return `{{${i + 1}}}`;
  });
  const components: any[] = [{ type: "BODY", text, ...(names.length ? { example: { body_text: [names.map((n) => examples[n] || n)] } } : {}) }];
  const btns = buttons.map((b) => b.trim()).filter(Boolean).slice(0, 10);
  if (btns.length) components.push({ type: "BUTTONS", buttons: btns.map((b) => ({ type: "QUICK_REPLY", text: b.slice(0, 25) })) });
  return { components, variables: names };
}

export function validTemplateName(n: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(n);
}
