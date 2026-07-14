let activeAbort: AbortController | null = null;

export function setActiveChatAbort(controller: AbortController): void {
  activeAbort = controller;
}

export function clearActiveChatAbort(controller: AbortController): void {
  if (activeAbort === controller) activeAbort = null;
}

/** Abort the in-flight chat request, if any. Safe to call when idle. */
export function cancelChat(): void {
  activeAbort?.abort();
}
