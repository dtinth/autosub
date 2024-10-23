export function extractTag(text: string, tag: string) {
  const start = text.indexOf(`<${tag}>`);
  const end = text.indexOf(`</${tag}>`, start + 1);
  if (start === -1 || end === -1) {
    throw new Error(`Tag not found: ${tag}`);
  }
  return text.slice(start + tag.length + 2, end).trim();
}
