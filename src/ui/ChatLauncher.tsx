import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { IconChat } from './icons';

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
