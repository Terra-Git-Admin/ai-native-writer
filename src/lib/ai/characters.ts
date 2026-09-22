export interface CharacterProfileSection {
  name: string;
  key: string;
  start: number;
  bodyStart: number;
  end: number;
  body: string;
}

export function normalizeCharacterName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isIgnoredCharacterHeading(name: string): boolean {
  return /^(?:Relationships|Character Name)$/i.test(name.trim());
}

export function parseCharacterProfiles(tagged: string): CharacterProfileSection[] {
  const headings = [...tagged.matchAll(/^\[H2\]\s*(.+?)\s*$/gim)];
  const seen = new Set<string>();
  const profiles: CharacterProfileSection[] = [];

  headings.forEach((match, index) => {
    const name = match[1].trim();
    const key = normalizeCharacterName(name);
    if (!name || !key || isIgnoredCharacterHeading(name) || seen.has(key)) return;
    seen.add(key);
    profiles.push({
      name,
      key,
      start: match.index!,
      bodyStart: match.index! + match[0].length,
      end: headings[index + 1]?.index ?? tagged.length,
      body: tagged.slice(match.index! + match[0].length, headings[index + 1]?.index ?? tagged.length),
    });
  });

  return profiles;
}

export function mergeMissingCharacterProfiles(existingTagged: string, nextTagged: string): string {
  const existing = parseCharacterProfiles(existingTagged);
  if (!existing.length) return nextTagged;

  const nextKeys = new Set(parseCharacterProfiles(nextTagged).map((profile) => profile.key));
  const missing = existing.filter((profile) => !nextKeys.has(profile.key));
  if (!missing.length) return nextTagged;

  const additions = missing.map((profile) => {
    const section = existingTagged.slice(profile.start, profile.end).trim();
    return section || `[H2] ${profile.name}`;
  });

  return `${nextTagged.trim()}\n\n${additions.join("\n\n")}`;
}
