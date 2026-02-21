import type { RightRailProps } from "idcmd/client";
import type { JSX } from "preact";

const CaretDownIcon = (): JSX.Element => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M7 10l5 5 5-5"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

const CopyIcon = (): JSX.Element => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M9 9h10v12H9V9z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

const buildSlugFromCurrentPath = (currentPath: string): string => {
  if (currentPath === "/") {
    return "index";
  }

  const trimmed = currentPath.replaceAll(/^\/+|\/+$/g, "");
  return trimmed || "index";
};

const buildAskUrls = ({
  canonicalUrl,
  currentPath,
}: {
  canonicalUrl?: string;
  currentPath: string;
}): { chatgptUrl: string; claudeUrl: string; markdownPath: string } => {
  const slug = buildSlugFromCurrentPath(currentPath);
  const markdownPath = `/${slug}.md`;
  const markdownUrl = canonicalUrl
    ? new URL(markdownPath, canonicalUrl).toString()
    : markdownPath;

  const llmsTxtUrl = canonicalUrl
    ? new URL("/llms.txt", canonicalUrl).toString()
    : "/llms.txt";

  const prompt = `Investigate this document and explain it to the user: ${markdownUrl}\ndirectory for further exploration: ${llmsTxtUrl}`;

  const chatgpt = new URL("https://chatgpt.com/");
  chatgpt.searchParams.set("prompt", prompt);

  const claude = new URL("https://claude.ai/new");
  claude.searchParams.set("q", prompt);

  return {
    chatgptUrl: chatgpt.toString(),
    claudeUrl: claude.toString(),
    markdownPath,
  };
};

const AskInDropdown = ({
  claudeUrl,
  chatgptUrl,
  markdownPath,
}: {
  claudeUrl: string;
  chatgptUrl: string;
  markdownPath: string;
}): JSX.Element => (
  <details class="llm-menu relative">
    <summary class="flex w-full cursor-pointer select-none items-center justify-between gap-3 rounded-full border border-white/20 bg-card/30 px-4 py-2 text-sm shadow-sm hover:border-white/30 hover:bg-card/40">
      <span class="flex items-center gap-2">
        <img
          src="/openai-white.svg"
          alt=""
          width={18}
          height={18}
          class="shrink-0"
        />
        <span>Ask in ChatGPT</span>
      </span>
      <span class="text-muted-foreground">
        <CaretDownIcon />
      </span>
    </summary>

    <div class="absolute left-0 right-0 z-50 mt-2 rounded-xl border border-border bg-popover p-1 shadow-sm">
      <a
        href={chatgptUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
      >
        <img
          src="/openai-white.svg"
          alt=""
          width={18}
          height={18}
          class="shrink-0"
        />
        <span>Ask in ChatGPT</span>
      </a>
      <a
        href={claudeUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
      >
        <img
          src="/anthropic-white.svg"
          alt=""
          width={18}
          height={18}
          class="shrink-0"
        />
        <span>Ask in Claude</span>
      </a>
      <a
        href={markdownPath}
        target="_blank"
        rel="noopener noreferrer"
        data-copy-markdown="1"
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
      >
        <span class="shrink-0 text-muted-foreground">
          <CopyIcon />
        </span>
        <span data-copy-markdown-label="1">Copy Markdown to Clipboard</span>
      </a>
    </div>
  </details>
);

const OnThisPage = ({
  items,
}: {
  items: RightRailProps["tocItems"];
}): JSX.Element => (
  <section class="flex min-h-0 flex-1 flex-col" data-toc-root="1">
    <div class="px-0.5 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      On this page
    </div>
    <nav aria-label="Table of contents" class="min-h-0 flex flex-1 flex-col">
      <div class="toc-scroll min-h-0 flex-1" data-toc-scroll-container="1">
        <ul class="space-y-2 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item.id} class={item.level >= 3 ? "pl-3" : ""}>
              <a
                href={`#${encodeURIComponent(item.id)}`}
                class="hover:text-foreground"
                data-toc-link="1"
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  </section>
);

const getVisibilityClass = (
  visibleFrom: RightRailProps["rightRailConfig"]["visibleFrom"]
): string => {
  switch (visibleFrom) {
    case "always": {
      return "block";
    }
    case "never": {
      return "hidden";
    }
    case "md": {
      return "hidden md:block";
    }
    case "lg": {
      return "hidden lg:block";
    }
    default: {
      return "hidden xl:block";
    }
  }
};

const getPanelClass = (
  placement: RightRailProps["rightRailConfig"]["placement"]
): string =>
  placement === "viewport"
    ? "fixed top-24 bottom-0 right-8 z-20 w-64 flex flex-col gap-6 min-h-0"
    : "sticky top-24 h-[calc(100vh-6rem)] flex flex-col gap-6 min-h-0";

export const RightRail = ({
  canonicalUrl,
  currentPath,
  tocItems,
  rightRailConfig,
}: RightRailProps): JSX.Element => {
  const { chatgptUrl, claudeUrl, markdownPath } = buildAskUrls({
    canonicalUrl,
    currentPath,
  });

  return (
    <aside
      class={`${getVisibilityClass(rightRailConfig.visibleFrom)} w-64 shrink-0`}
    >
      <div class={getPanelClass(rightRailConfig.placement)}>
        <AskInDropdown
          chatgptUrl={chatgptUrl}
          claudeUrl={claudeUrl}
          markdownPath={markdownPath}
        />
        {tocItems.length > 0 ? <OnThisPage items={tocItems} /> : null}
      </div>
    </aside>
  );
};
