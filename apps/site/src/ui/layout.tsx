import type { LayoutProps } from "idcmd/client";
/* eslint-disable react/no-danger */
import type { JSX } from "preact";
import { render } from "preact-render-to-string";

import { RightRail } from "./right-rail";

type NavItem = LayoutProps["navigation"][number]["items"][number];

const Icon = ({ svg }: { svg: string }): JSX.Element => (
  <span
    class="inline-flex h-[18px] w-[18px]"
    dangerouslySetInnerHTML={{ __html: svg }}
  />
);

const isActiveLink = (item: NavItem, currentPath: string): boolean =>
  currentPath === item.href ||
  (item.href !== "/" && currentPath.startsWith(item.href));

const Sidebar = ({
  siteName,
  navigation,
  currentPath,
}: {
  siteName: LayoutProps["siteName"];
  navigation: LayoutProps["navigation"];
  currentPath: LayoutProps["currentPath"];
}): JSX.Element => (
  <aside class="sidebar">
    <div class="sidebar-header">
      <a
        href="/"
        class="text-sm font-medium tracking-tight"
        data-prefetch="hover"
      >
        <span class="text-muted-foreground">~/</span>
        {siteName}
      </a>
    </div>
    <div class="sidebar-content">
      {navigation.map((group) => (
        <div key={group.id} class="py-2">
          <p class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <nav class="space-y-1">
            {group.items.map((item) => (
              <a
                key={item.href}
                href={item.href}
                data-prefetch="hover"
                class={`flex items-center gap-3 px-3 py-1.5 text-sm transition-colors hover:text-sidebar-foreground ${
                  isActiveLink(item, currentPath)
                    ? "border-l-2 border-sidebar-primary font-medium text-sidebar-foreground"
                    : "border-l-2 border-transparent"
                }`}
              >
                <Icon svg={item.iconSvg} />
                <span>{item.title}</span>
              </a>
            ))}
          </nav>
        </div>
      ))}
    </div>
  </aside>
);

const SearchForm = ({ query }: { query?: string }): JSX.Element => (
  <form
    method="get"
    action="/search/"
    class="flex w-full items-center"
    role="search"
    noValidate
  >
    <label htmlFor="site-search" class="sr-only">
      Search pages
    </label>
    <input
      id="site-search"
      name="q"
      type="search"
      autoComplete="off"
      spellcheck={false}
      placeholder="Search..."
      defaultValue={query ?? ""}
      class="w-full border-b border-input bg-transparent px-1 py-1.5 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none transition-colors"
    />
  </form>
);

const TopNavbar = ({
  query,
  siteName,
}: {
  query?: LayoutProps["searchQuery"];
  siteName: LayoutProps["siteName"];
}): JSX.Element => (
  <header class="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
    <div class="mx-auto max-w-6xl px-8 py-3">
      <div class="flex items-center gap-4">
        <a
          href="/"
          class="text-sm font-mono font-medium tracking-tight lg:hidden"
          data-prefetch="hover"
        >
          <span class="text-muted-foreground">~/</span>
          {siteName}
        </a>
        <div class="not-prose ml-auto w-full max-w-xs">
          <SearchForm query={query} />
        </div>
      </div>
    </div>
  </header>
);

const buildHtmlClass = (
  smoothScroll: LayoutProps["rightRail"]["smoothScroll"]
): string => (smoothScroll ? "smooth-scroll" : "");

const buildScrollSpyDataset = (props: {
  isScrollSpyEnabled: boolean;
  rightRail: LayoutProps["rightRail"];
}): {
  scrollspy?: string;
  scrollspyCenter?: string;
  scrollspyUpdateHash?: string;
} =>
  props.isScrollSpyEnabled
    ? {
        scrollspy: "1",
        scrollspyCenter: props.rightRail.scrollSpy.centerActiveItem
          ? "1"
          : undefined,
        scrollspyUpdateHash: props.rightRail.scrollSpy.updateHash,
      }
    : {};

const Layout = ({
  title,
  siteName,
  description,
  canonicalUrl,
  content,
  cssPath,
  inlineCss,
  currentPath,
  navigation,
  scriptPaths = [],
  searchQuery,
  showRightRail = true,
  rightRail,
  tocItems,
}: LayoutProps): JSX.Element => {
  const resolvedCssPath = inlineCss ? undefined : (cssPath ?? "/styles.css");
  const shouldShowRightRail = showRightRail && rightRail.enabled;
  const isScrollSpyEnabled =
    shouldShowRightRail && rightRail.scrollSpy.enabled && tocItems.length > 0;
  const scrollSpyDataset = buildScrollSpyDataset({
    isScrollSpyEnabled,
    rightRail,
  });

  return (
    <html lang="en" class={buildHtmlClass(rightRail.smoothScroll)}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {description ? <meta name="description" content={description} /> : null}
        {canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {inlineCss ? <style>{inlineCss}</style> : null}
        {resolvedCssPath ? (
          <link rel="stylesheet" href={resolvedCssPath} />
        ) : null}
      </head>
      <body
        class="bg-background font-sans text-foreground"
        data-scrollspy={scrollSpyDataset.scrollspy}
        data-scrollspy-center={scrollSpyDataset.scrollspyCenter}
        data-scrollspy-update-hash={scrollSpyDataset.scrollspyUpdateHash}
      >
        <Sidebar
          siteName={siteName}
          navigation={navigation}
          currentPath={currentPath}
        />
        <div class="main-wrapper">
          <TopNavbar query={searchQuery} siteName={siteName} />
          <main class="main-content">
            <div class="mx-auto flex w-full max-w-6xl items-start gap-10">
              <article
                class={`prose min-w-0 flex-1${
                  currentPath === "/" ? " prose-home" : ""
                }`}
                dangerouslySetInnerHTML={{ __html: content }}
              />
              {shouldShowRightRail ? (
                <RightRail
                  canonicalUrl={canonicalUrl}
                  currentPath={currentPath}
                  tocItems={tocItems}
                  rightRailConfig={rightRail}
                />
              ) : null}
            </div>
          </main>
          <footer class="site-footer">
            <a href="https://rusty.wtf">rusty.wtf</a>
          </footer>
        </div>
        {scriptPaths.map((scriptPath) => (
          <script key={scriptPath} defer src={scriptPath} />
        ))}
      </body>
    </html>
  );
};

export const renderLayout = (props: LayoutProps): string =>
  `<!DOCTYPE html>${render(<Layout {...props} />)}`;
