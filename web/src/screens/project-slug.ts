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
  // Ukrainian and Belarusian letters that the Russian table lacks.
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
  ў: 'u',
};

/**
 * A project slug suggested from its name: Russian letters transliterated, accents dropped,
 * everything else collapsed to single hyphens; at most 64 characters, as `slugSchema` allows.
 */
export function slugFromName(name: string): string {
  // NFC first, so a decomposed «й» (и + breve) maps like the precomposed letter.
  const latin = [...name.normalize('NFC').toLowerCase()]
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
/** Whether a slug is valid as typed, as `slugSchema` checks it. */
export function validSlug(slug: string): boolean {
  return slug.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug);
}

export function followName(previous: { name: string; slug: string }, name: string): string {
  return previous.slug === '' || previous.slug === slugFromName(previous.name)
    ? slugFromName(name)
    : previous.slug;
}
