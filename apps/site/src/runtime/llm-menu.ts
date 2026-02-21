const COPY_SELECTOR = 'a[data-copy-markdown="1"]';
const LABEL_SELECTOR = '[data-copy-markdown-label="1"]';
const RESET_DELAY_MS = 2000;

const setLinkDisabled = (link: HTMLAnchorElement, disabled: boolean): void => {
  if (disabled) {
    link.setAttribute("aria-disabled", "true");
    link.style.pointerEvents = "none";
    link.style.opacity = "0.8";
    return;
  }

  link.removeAttribute("aria-disabled");
  link.style.pointerEvents = "";
  link.style.opacity = "";
};

const setLinkLabel = (link: HTMLAnchorElement, next: string): void => {
  const label = link.querySelector(LABEL_SELECTOR);
  if (label) {
    label.textContent = next;
  }
};

const toAbsoluteUrl = (href: string): string => {
  try {
    return new URL(href, window.location.href).toString();
  } catch {
    return href;
  }
};

const createHiddenTextarea = (text: string): HTMLTextAreaElement => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  return textarea;
};

const safeExecCommandCopy = (): boolean => {
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
};

const copyViaExecCommand = (text: string): boolean => {
  const textarea = createHiddenTextarea(text);
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const ok = safeExecCommandCopy();
  textarea.remove();
  return ok;
};

const copyText = async (text: string): Promise<boolean> => {
  const { clipboard } = navigator;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall back below.
    }
  }

  return copyViaExecCommand(text);
};

const closeMenuIfPresent = (link: HTMLAnchorElement): void => {
  const details = link.closest("details");
  if (details instanceof HTMLDetailsElement) {
    details.open = false;
  }
};

const getOriginalLabel = (link: HTMLAnchorElement): string =>
  link.querySelector(LABEL_SELECTOR)?.textContent ??
  "Copy Markdown to Clipboard";

const fetchMarkdownText = async (href: string): Promise<string | null> => {
  const res = await fetch(toAbsoluteUrl(href), { credentials: "same-origin" });
  if (!res.ok) {
    return null;
  }
  return res.text();
};

const copyMarkdownFromHref = async (href: string): Promise<boolean> => {
  try {
    const text = await fetchMarkdownText(href);
    if (!text) {
      return false;
    }
    return copyText(text);
  } catch {
    return false;
  }
};

const startCopyOperation = (link: HTMLAnchorElement): void => {
  setLinkDisabled(link, true);
  setLinkLabel(link, "Copying...");
};

const finishCopyOperation = (link: HTMLAnchorElement, ok: boolean): void => {
  setLinkLabel(link, ok ? "Copied" : "Copy failed");
  closeMenuIfPresent(link);
};

const scheduleResetOperation = (
  link: HTMLAnchorElement,
  originalLabel: string
): void => {
  window.setTimeout(() => {
    setLinkLabel(link, originalLabel);
    setLinkDisabled(link, false);
  }, RESET_DELAY_MS);
};

const handleCopyClick = async (
  link: HTMLAnchorElement,
  originalLabel: string
): Promise<void> => {
  const href = link.getAttribute("href");
  if (!href) {
    return;
  }

  startCopyOperation(link);
  const ok = await copyMarkdownFromHref(href);
  finishCopyOperation(link, ok);
  scheduleResetOperation(link, originalLabel);
};

const attachCopyHandler = (link: HTMLAnchorElement): void => {
  const originalLabel = getOriginalLabel(link);
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.getAttribute("aria-disabled") === "true") {
      return;
    }
    await handleCopyClick(link, originalLabel);
  });
};

const initCopyMarkdownButtons = (): void => {
  const links = [...document.querySelectorAll(COPY_SELECTOR)].filter(
    (link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement
  );

  for (const link of links) {
    attachCopyHandler(link);
  }
};

initCopyMarkdownButtons();
