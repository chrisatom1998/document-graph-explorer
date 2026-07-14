import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';

function IconChat() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** Small always-available entry point; the full chat implementation loads on demand. */
export default function ChatLauncher() {
  const hasNodes = useGraphStore((state) => state.nodes.length > 0);
  const isOpen = useChatStore((state) => state.isOpen);
  const setIsOpen = useChatStore((state) => state.setIsOpen);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const latestMessage = useChatStore((state) => state.messages[state.messages.length - 1]);
  const announcement = isStreaming
    ? 'Thinking…'
    : latestMessage?.role === 'assistant'
      ? 'Answer ready'
      : '';

  if (!hasNodes) return null;

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
      {!isOpen && (
        <button
          type="button"
          className="chat-bubble-btn"
          onClick={() => setIsOpen(true)}
          title="Chat with your documents"
          aria-label="Chat with your documents"
        >
          <IconChat />
          <span className="chat-bubble-btn__badge">AI</span>
        </button>
      )}
    </>
  );
}
