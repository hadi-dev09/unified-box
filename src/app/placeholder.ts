/** Finds an unfilled template placeholder such as "[Your name]" or "[date]" (but not a markdown link "[text](url)"). */
export function findPlaceholder(text: string): string | null {
  const m = text.match(/\[[A-Za-z][^\]\n]{1,40}\](?!\()/);
  return m ? m[0] : null;
}
/** Asks before sending a message that still contains a placeholder. Returns true when it's OK to send. */
export function confirmNoPlaceholder(text: string): boolean {
  const p = findPlaceholder(text);
  return !p || window.confirm(`Your message still contains ${p}. Send it anyway?`);
}
export const fillNameClient = (text: string, name: string) =>
  name ? text.replace(/\[(your|my) (full )?name\]|\[name\]|\[sender'?s? name\]/gi, name) : text;
