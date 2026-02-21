const TOC_ROOT_SELECTOR = '[data-toc-root="1"]';
const TOC_LINK_SELECTOR = 'a[data-toc-link="1"][href^="#"]';
const TOC_SCROLL_CONTAINER_SELECTOR = '[data-toc-scroll-container="1"]';

const NAVBAR_GAP_PX = 16;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const getTopOffset = (): number => {
  const header = document.querySelector("header");
  const headerHeight = header?.getBoundingClientRect().height ?? 0;
  return Math.ceil(headerHeight + NAVBAR_GAP_PX);
};

const decodeAnchorId = (href: string | null): string | null => {
  if (!href?.startsWith("#")) {
    return null;
  }

  const raw = href.slice(1);
  if (!raw) {
    return null;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

interface TocEntry {
  heading: HTMLElement;
  link: HTMLAnchorElement;
  y: number;
}

const toEntry = (link: HTMLAnchorElement): TocEntry | null => {
  const id = decodeAnchorId(link.getAttribute("href"));
  if (!id) {
    return null;
  }

  // ids like "11-overview" are valid HTML ids but invalid CSS selectors unless escaped.
  // eslint-disable-next-line unicorn/prefer-query-selector
  const heading = document.getElementById(id);
  if (!heading) {
    return null;
  }

  return { heading, link, y: 0 };
};

const buildEntries = (tocRoot: Element): TocEntry[] =>
  [...tocRoot.querySelectorAll(TOC_LINK_SELECTOR)]
    .filter(
      (link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement
    )
    .map(toEntry)
    .filter((entry): entry is TocEntry => entry !== null);

const measureEntries = (entries: TocEntry[]): void => {
  for (const entry of entries) {
    entry.y = entry.heading.getBoundingClientRect().top + window.scrollY;
  }
};

const setScrollMarginTop = (topOffset: number): void => {
  document.documentElement.style.setProperty(
    "--scroll-margin-top",
    `${topOffset}px`
  );
};

const binarySearchLastAtOrAbove = (
  entries: TocEntry[],
  anchorLine: number
): number => {
  let lo = 0;
  let hi = entries.length;

  // Find the first entry with y > anchorLine, then step back one.
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midY = entries[mid]?.y ?? Number.POSITIVE_INFINITY;
    if (midY <= anchorLine) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo - 1;
};

const findActiveIndex = (entries: TocEntry[], topOffset: number): number => {
  const anchorLine = window.scrollY + topOffset + 1;
  const best = binarySearchLastAtOrAbove(entries, anchorLine);
  return Math.max(0, best);
};

const parseTransformValues = (transform: string, prefix: string): number[] =>
  transform
    .slice(prefix.length, -1)
    .split(",")
    .map((value) => Number.parseFloat(value.trim()));

const getNumberAtIndex = (values: number[], index: number): number => {
  const value = values[index] ?? Number.NaN;
  return Number.isFinite(value) ? value : 0;
};

const getMatrix3dTranslateY = (values: number[]): number =>
  getNumberAtIndex(values, 13);

const getMatrixTranslateY = (values: number[]): number =>
  getNumberAtIndex(values, 5);

const getComputedTranslateY = (element: Element): number => {
  const { transform } = window.getComputedStyle(element);
  if (!transform || transform === "none") {
    return 0;
  }

  if (transform.startsWith("matrix3d(")) {
    const values = parseTransformValues(transform, "matrix3d(");
    return getMatrix3dTranslateY(values);
  }

  if (transform.startsWith("matrix(")) {
    const values = parseTransformValues(transform, "matrix(");
    return getMatrixTranslateY(values);
  }

  return 0;
};

const setTranslateY = (element: HTMLElement, next: number): void => {
  element.style.transform = `translate3d(0, ${next}px, 0)`;
};

const getElementCenterY = (element: Element): number => {
  const rect = element.getBoundingClientRect();
  return rect.top + rect.height / 2;
};

const getCenteredTranslateY = (
  scrollContainer: HTMLElement,
  list: HTMLElement,
  link: HTMLAnchorElement
): number => {
  const containerHeight = scrollContainer.clientHeight;
  const listHeight = list.scrollHeight;

  if (listHeight <= containerHeight + 1) {
    return 0;
  }

  const delta = getElementCenterY(scrollContainer) - getElementCenterY(link);
  const currentTranslate = getComputedTranslateY(list);
  const minTranslate = containerHeight - listHeight;
  return clamp(currentTranslate + delta, minTranslate, 0);
};

interface ScrollSpyState {
  activeIndex: number;
  centerActiveItem: boolean;
  entries: TocEntry[];
  isTicking: boolean;
  scrollContainer: HTMLElement | null;
  tocList: HTMLElement | null;
  topOffset: number;
}

const centerLinkIfNeeded = (
  state: ScrollSpyState,
  link: HTMLAnchorElement
): void => {
  const { scrollContainer, tocList } = state;
  if (!scrollContainer || !tocList) {
    return;
  }

  const next = getCenteredTranslateY(scrollContainer, tocList, link);
  const current = getComputedTranslateY(tocList);
  if (Math.abs(current - next) < 0.5) {
    return;
  }

  setTranslateY(tocList, next);
};

const setCurrentLocationAttr = (entry: TocEntry | undefined): void => {
  if (!entry) {
    return;
  }
  entry.link.setAttribute("aria-current", "location");
};

const setActiveLink = (state: ScrollSpyState, index: number): void => {
  if (index === state.activeIndex) {
    return;
  }

  const previous = state.entries[state.activeIndex];
  previous?.link.removeAttribute("aria-current");

  state.activeIndex = index;
  const current = state.entries[state.activeIndex];
  setCurrentLocationAttr(current);

  if (state.centerActiveItem && current) {
    centerLinkIfNeeded(state, current.link);
  }
};

const updateActive = (state: ScrollSpyState): void => {
  setActiveLink(state, findActiveIndex(state.entries, state.topOffset));
};

const scheduleUpdate = (state: ScrollSpyState): void => {
  if (state.isTicking) {
    return;
  }

  state.isTicking = true;
  requestAnimationFrame(() => {
    state.isTicking = false;
    updateActive(state);
  });
};

const refreshLayout = (state: ScrollSpyState): void => {
  state.topOffset = getTopOffset();
  setScrollMarginTop(state.topOffset);
  measureEntries(state.entries);
  updateActive(state);

  if (state.centerActiveItem) {
    const current = state.entries[state.activeIndex];
    if (current) {
      centerLinkIfNeeded(state, current.link);
    }
  }
};

const createState = (): ScrollSpyState | null => {
  const { body } = document;
  const tocRoot = document.querySelector(TOC_ROOT_SELECTOR);
  const entries = tocRoot ? buildEntries(tocRoot) : [];
  if (
    !body ||
    body.dataset.scrollspy !== "1" ||
    !tocRoot ||
    entries.length === 0
  ) {
    return null;
  }

  const centerActiveItem = body.dataset.scrollspyCenter === "1";
  const scrollContainer = tocRoot.querySelector(TOC_SCROLL_CONTAINER_SELECTOR);
  const tocList = scrollContainer?.querySelector("ul") ?? null;

  return {
    activeIndex: -1,
    centerActiveItem,
    entries,
    isTicking: false,
    scrollContainer:
      scrollContainer instanceof HTMLElement ? scrollContainer : null,
    tocList: tocList instanceof HTMLElement ? tocList : null,
    topOffset: getTopOffset(),
  };
};

const start = (state: ScrollSpyState): void => {
  // Disable independent TOC scrolling whenever scrollspy is active.
  // The TOC list position is controlled by JS (either centered or left as-is).
  document.body.dataset.tocFollow = "1";

  window.addEventListener("scroll", () => scheduleUpdate(state), {
    passive: true,
  });
  window.addEventListener("resize", () => refreshLayout(state));
  window.addEventListener("load", () => {
    refreshLayout(state);
    setTimeout(() => refreshLayout(state), 250);
    setTimeout(() => refreshLayout(state), 1000);
  });

  refreshLayout(state);
};

const init = (): void => {
  const state = createState();
  if (!state) {
    return;
  }

  start(state);
};

init();
