export type ChangedSection = {
  name: string;
  changed: boolean;
  save: () => Promise<boolean>;
};

export async function saveChangedSections(sections: readonly ChangedSection[]): Promise<{ name: string; saved: boolean }[]> {
  const results: { name: string; saved: boolean }[] = [];
  for (const section of sections) {
    if (!section.changed) continue;
    try {
      results.push({ name: section.name, saved: await section.save() });
    } catch {
      results.push({ name: section.name, saved: false });
    }
  }
  return results;
}
