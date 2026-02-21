(() => {
  const selector = 'a[data-prefetch="hover"][href]';
  const prefetched = new Set<string>();

  const prefetch = (href: string | null | undefined): void => {
    if (!href || prefetched.has(href)) {
      return;
    }
    prefetched.add(href);

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.append(link);
  };

  const onOver = (event: Event): void => {
    const { target } = event;
    if (!(target instanceof Element)) {
      return;
    }
    const link = target.closest(selector);
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }
    prefetch(link.href);
  };

  document.addEventListener("mouseover", onOver, { passive: true });
})();
