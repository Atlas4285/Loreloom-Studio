export interface Section {
  name: string;
  blocks: { section: string; language: string; text: string }[];
}

export function parseMarkdownDocument(source: string) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .split("\n");
  let name = "";
  const sections: Section[] = [];
  let current: Section | undefined;
  let subsection = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^ {0,3}(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
    if (fence) {
      if (!current) throw new Error("Code blocks must belong to a section.");
      const closing = new RegExp(
        `^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`,
      );
      const body: string[] = [];
      while (++index < lines.length && !closing.test(lines[index]))
        body.push(lines[index]);
      if (index === lines.length)
        throw new Error("Unclosed Markdown code fence.");
      current.blocks.push({
        section: subsection,
        language: fence[2],
        text: body.join("\n"),
      });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!heading) continue;
    if (heading[1] === "#") {
      if (name || sections.length)
        throw new Error("Use one document title before all sections.");
      name = heading[2];
    } else if (heading[1] === "##") {
      if (sections.some((section) => section.name === heading[2]))
        throw new Error(`Duplicate section: ${heading[2]}`);
      current = { name: heading[2], blocks: [] };
      sections.push(current);
      subsection = "";
    } else {
      if (!current) throw new Error("Subsections require a parent section.");
      subsection = heading[2];
    }
  }
  if (
    !name ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new Error("Invalid or missing document title.");
  return { name, sections };
}
