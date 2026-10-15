export function assertPitchLabEpisodePilotText(text: string): string {
  const clean = text.trim();
  if (!clean) throw new Error("Episode 1 pilot is empty.");
  return clean;
}

export function parsePitchLabEpisodePilots(raw: string, expectedCount = 4): Array<{ title: string; ideaText: string }> {
  const marker = /(?:^|\n)\s*(?:---\s*)?(?:PILOT\s+OPTION|OPTION|VARIANT)\s*(\d+)\s*(?:---\s*)?\s*(?=\n|$)/gi;
  const matches = [...raw.matchAll(marker)];
  if (matches.length < expectedCount) throw new Error(`The model returned ${matches.length} pilot options; expected ${expectedCount}.`);
  return matches.slice(0, expectedCount).map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : raw.length;
    const section = raw.slice(start, end).trim();
    const lines = section.split(/\r?\n/);
    const first = lines.findIndex((line) => line.trim());
    if (first < 0) throw new Error(`Pilot option ${index + 1} is empty.`);
    const heading = lines[first].trim();
    const hasTitle = heading.length <= 80 && heading.split(/\s+/).length <= 10 && !/[.!?]$/.test(heading)
      && (/^Title\s*:/i.test(heading) || /^#+\s+/.test(heading) || !/^(?:she|he|they|fl|ml|a|an|the)\b/i.test(heading));
    const title = hasTitle ? heading.replace(/^#+\s*/, "").replace(/^Title\s*:\s*/i, "").trim() : `Pilot ${index + 1}`;
    const body = lines.slice(hasTitle ? first + 1 : first).join("\n").replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "");
    return { title, ideaText: assertPitchLabEpisodePilotText(body) };
  });
}
