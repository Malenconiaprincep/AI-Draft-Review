export type ScrollHighlightOptions = {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
};

export function findHighlightElement(root: ParentNode, highlightId: string): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>("[data-highlight-id]");
  return Array.from(candidates).find((element) => element.dataset.highlightId === highlightId) ?? null;
}

export function scrollHighlightIntoView(
  root: ParentNode,
  highlightId: string,
  options: ScrollHighlightOptions = {}
): boolean {
  const element = findHighlightElement(root, highlightId);
  if (!element) return false;

  element.scrollIntoView({
    behavior: options.behavior ?? "smooth",
    block: options.block ?? "center",
    inline: options.inline ?? "nearest"
  });
  return true;
}
