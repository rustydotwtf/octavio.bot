import { $ } from "bun";

const MARKDOWN_EXTENSION = ".md";
const GENERATED_PREFIX = "prompts-";
const GENERATED_GROUP = "prompts";
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u;

const appRootUrl = new URL("../", import.meta.url);
const sourceDirUrl = new URL("../../packages/prompts/prompts/", appRootUrl);
const destinationDirUrl = new URL("content/", appRootUrl);
const legacyDestinationDirUrl = new URL("content/prompts/", appRootUrl);
const sourceDirPath = Bun.fileURLToPath(sourceDirUrl);
const destinationDirPath = Bun.fileURLToPath(destinationDirUrl);
const legacyDestinationDirPath = Bun.fileURLToPath(legacyDestinationDirUrl);

interface ParsedMarkdown {
  body: string;
  frontmatter: string;
}

const parseMarkdown = (markdown: string): ParsedMarkdown => {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { body: markdown, frontmatter: "" };
  }

  const frontmatter = match[1]?.trim() ?? "";
  const body = markdown.slice(match[0].length).replace(/^\n+/u, "");
  return { body, frontmatter };
};

const hasFrontmatterKey = (frontmatter: string, key: string): boolean =>
  new RegExp(`^${key}:`, "mu").test(frontmatter);

const formatTitleFromSlug = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");

const mergeFrontmatter = (input: {
  baseFrontmatter: string;
  order: number;
  slug: string;
}): string => {
  const lines = input.baseFrontmatter.length > 0 ? [input.baseFrontmatter] : [];

  if (!hasFrontmatterKey(input.baseFrontmatter, "title")) {
    lines.push(`title: ${JSON.stringify(formatTitleFromSlug(input.slug))}`);
  }

  if (!hasFrontmatterKey(input.baseFrontmatter, "group")) {
    lines.push(`group: ${JSON.stringify(GENERATED_GROUP)}`);
  }

  if (!hasFrontmatterKey(input.baseFrontmatter, "order")) {
    lines.push(`order: ${input.order}`);
  }

  return lines.join("\n");
};

const collectMarkdownFilenames = async (
  directory: string
): Promise<string[]> => {
  const glob = new Bun.Glob(`*${MARKDOWN_EXTENSION}`);
  const fileNames: string[] = [];
  for await (const fileName of glob.scan({ cwd: directory, onlyFiles: true })) {
    fileNames.push(fileName);
  }

  return fileNames.toSorted((a, b) => a.localeCompare(b));
};

const toGeneratedFileName = (sourceFileName: string): string =>
  `${GENERATED_PREFIX}${sourceFileName}`;

const syncPrompt = async (input: {
  fileName: string;
  index: number;
}): Promise<void> => {
  const sourcePath = new URL(input.fileName, sourceDirUrl);
  const destinationPath = new URL(
    toGeneratedFileName(input.fileName),
    destinationDirUrl
  );
  const sourceMarkdown = await Bun.file(sourcePath).text();
  const { body, frontmatter } = parseMarkdown(sourceMarkdown);
  const slug = input.fileName.slice(0, -MARKDOWN_EXTENSION.length);
  const mergedFrontmatter = mergeFrontmatter({
    baseFrontmatter: frontmatter,
    order: input.index + 1,
    slug,
  });

  const output = `---\n${mergedFrontmatter}\n---\n\n${body}`;
  await Bun.write(destinationPath, output);
};

const removeStaleGeneratedFiles = async (
  sourceFiles: string[]
): Promise<void> => {
  const destinationFiles = await collectMarkdownFilenames(destinationDirPath);
  const sourceSet = new Set(sourceFiles.map(toGeneratedFileName));

  for (const destinationFile of destinationFiles) {
    if (!destinationFile.startsWith(GENERATED_PREFIX)) {
      continue;
    }

    if (sourceSet.has(destinationFile)) {
      continue;
    }

    await $`rm -f ${new URL(destinationFile, destinationDirUrl)}`;
  }
};

const syncPrompts = async (): Promise<void> => {
  await $`mkdir -p ${destinationDirPath}`;
  const sourceFiles = await collectMarkdownFilenames(sourceDirPath);

  for (const [index, fileName] of sourceFiles.entries()) {
    await syncPrompt({ fileName, index });
  }

  await removeStaleGeneratedFiles(sourceFiles);
  await $`rm -rf ${legacyDestinationDirPath}`;
};

await syncPrompts();
