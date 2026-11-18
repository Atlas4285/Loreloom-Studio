export function parseImagePrompts(markdown: string): Record<string, string> {
  const prompts: Record<string, string> = {};
  let project = "";
  let image = "";
  let fence = "";
  let lines: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (
        closing &&
        closing[1][0] === fence[0] &&
        closing[1].length >= fence.length
      ) {
        const slot = `${project}.${image}`;
        const prompt = lines.join("\n").trim();
        if (!project || !image || !prompt || Object.hasOwn(prompts, slot)) {
          throw new Error(`Invalid or duplicate image prompt: ${slot}`);
        }
        prompts[slot] = prompt;
        fence = "";
        lines = [];
      } else {
        lines.push(line);
      }
      continue;
    }
    const projectHeading = /^##\s+([a-z0-9-]+)\s*$/.exec(line);
    const imageHeading = /^###\s+([a-z0-9-]+)\s*$/.exec(line);
    const opening = /^\s*(`{3,}|~{3,})[^\n]*$/.exec(line);
    if (projectHeading) {
      project = projectHeading[1];
      image = "";
    } else if (imageHeading) {
      image = imageHeading[1];
    } else if (opening) {
      fence = opening[1];
    }
  }
  if (fence) throw new Error("Image prompt contains an unclosed code block.");
  return prompts;
}
