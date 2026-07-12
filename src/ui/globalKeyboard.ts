function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Typing suppresses scene shortcuts, but Escape still owns the panel-close cascade. */
export function shouldIgnoreGlobalKey(event: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  return event.key !== 'Escape' && isTypingTarget(event.target);
}
