/** A language a code block can be set to: its highlight.js name, the name people see, and other names it goes by. */
export interface CodeLanguage {
  id: string;
  label: string;
  aliases?: string[];
}

/** The languages offered for code blocks, A to Z. All are in highlight.js's common set. */
export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: 'c', label: 'C', aliases: ['h'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'c#'] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'hpp', 'cxx'] },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'graphql', label: 'GraphQL', aliases: ['gql'] },
  { id: 'html', label: 'HTML', aliases: ['xhtml'] },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'lua', label: 'Lua' },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'php', label: 'PHP' },
  { id: 'plaintext', label: 'Plain text', aliases: ['text', 'txt', 'plain'] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'bash', label: 'Shell', aliases: ['sh', 'shell', 'zsh', 'console'] },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx', 'mts'] },
  { id: 'xml', label: 'XML', aliases: ['svg'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
];

/** The offered language a code block's language names (`js` is JavaScript), if it's one of them. */
export function findLanguage(language: string | null | undefined): CodeLanguage | null {
  const name = language?.trim().toLowerCase();
  if (!name) return null;
  return CODE_LANGUAGES.find((l) => l.id === name || l.aliases?.includes(name)) ?? null;
}

/** What to call a code block's language: its usual name, the name as written when it isn't offered, or null for none. */
export function languageLabel(language: string | null | undefined): string | null {
  if (!language?.trim()) return null;
  return findLanguage(language)?.label ?? language.trim();
}
