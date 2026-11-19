const cyrillic: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * A project slug suggested from its name: Russian letters transliterated, accents dropped,
 * everything else collapsed to single hyphens; at most 64 characters, as `slugSchema` allows.
 */
export function slugFromName(name: string): string {
  const latin = [...name.toLowerCase()]
    .map((letter) => cyrillic[letter] ?? letter)
    .join('')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '');
  return latin
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .replace(/-+$/u, '');
}

/**
 * A new project's slug follows its name until someone types a different slug: an empty slug,
 * or one still equal to the suggestion for the previous name, is replaced.
 */
export function followName(previous: { name: string; slug: string }, name: string): string {
  return previous.slug === '' || previous.slug === slugFromName(previous.name)
    ? slugFromName(name)
    : previous.slug;
}
