/**
 * Chat-with-data panel: floating bubble in lower-left that expands into
 * a chat interface. Uses RAG over all uploaded documents.
 */

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import ChatMarkdown from '../chat/ChatMarkdown';
import { cancelChat, sendChatMessage } from '../chat/ragChat';
import { AIRGAP } from '../airgap';
import { useChatStore, type ChatMessage, type ChatSource } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { focusNode } from './focusNode';
import { openDocument } from './openDocument';
import { chatTranscriptMarkdown } from '../persistence/chatHistory';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Chat bubble SVG icon. */
function IconChat() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** Square "stop" icon shown on the send button while a reply is streaming. */
function IconStop() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <rect x="3" y="3" width="14" height="14" rx="2" />
    </svg>
  );
}

function SourceChips({ sources, onSourceClick }: { sources: ChatSource[]; onSourceClick: (id: string) => void }) {
  // nodeIndex lookup, not a rebuilt Map: this renders per streaming delta,
  // and a 4k-doc corpus would pay a 4k-entry Map construction each time.
  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);

  return (
    <div className="chat-sources">
      {sources.map((source) => {
        const node = nodes[nodeIndex[source.docId]];
        const title = node?.title ?? source.docId.slice(0, 12);
        const pct = Math.round(source.score * 100);
        const passage = source.chunkIndex === undefined ? '' : `, passage ${source.chunkIndex + 1}`;
        // Sibling buttons, not nested (nested <button> is invalid HTML): the
        // chip flies to the node, the paired icon opens the document itself.
        return (
          <span key={source.docId} className="chat-source">
            <button
              type="button"
              className="chat-source-chip"
              title={`${pct}% match${passage} — ${source.snippet}`}
              onClick={() => onSourceClick(source.docId)}
            >
              📄 {title.length > 30 ? title.slice(0, 28) + '…' : title}{source.chunkIndex === undefined ? '' : ` · ${source.chunkIndex + 1}`}
            </button>
            <button
              type="button"
              className="chat-source-chip chat-source-chip--open"
              title="Open the source document — the original file if it was kept, otherwise a formatted text view"
              aria-label={`Open ${title}`}
              onClick={() => void openDocument(source.docId)}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="12"
                height="12"
              >
                <path d="M9 2h5v5" />
                <path d="M14 2 L7 9" />
                <path d="M12 9v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H7" />
              </svg>
            </button>
          </span>
        );
      })}
    </div>
  );
}

// memo: streaming updates replace ONE message object per delta; every other
// bubble keeps its identity and must not re-render (or re-parse its markdown).
const MessageBubble = memo(function MessageBubble({
  msg,
  onSourceClick,
}: {
  msg: ChatMessage;
  onSourceClick: (id: string) => void;
}) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const isAssistant = msg.role === 'assistant';

  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      <div className={`chat-bubble chat-bubble--${msg.role}`}>
        {isAssistant ? <ChatMarkdown text={msg.text} /> : <p className="chat-bubble__text">{msg.text}</p>}
        {msg.sources && msg.sources.length > 0 && (
          <SourceChips sources={msg.sources} onSourceClick={onSourceClick} />
        )}
      </div>
      <span className="chat-message__time">
        {isSystem ? '⚠' : isUser ? 'You' : 'AI'} · {formatTime(msg.timestamp)}
      </span>
    </div>
  );
});

export default function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen);
  const setIsOpen = useChatStore((s) => s.setIsOpen);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const docCount = useGraphStore((s) => s.nodes.filter((n) => n.kind === 'document').length);
  const chatProvider = useSettingsStore((s) => s.chatProvider);
  const geminiKey = useSettingsStore((s) => s.geminiKey);
  const openRouterKey = useSettingsStore((s) => s.openRouterKey);
  const offlineMode = useSettingsStore((s) => s.offlineMode);
  const selectedKey = chatProvider === 'openrouter' ? openRouterKey : geminiKey;
  const localMode = AIRGAP || offlineMode || chatProvider === 'local' || selectedKey.trim() === '';

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const handleSend = () => {
    const q = input.trim();
    if (!q || isStreaming) return;
    setInput('');
    // sendChatMessage handles all its own errors (writes them into the chat
    // transcript) and never rejects to the caller — fire-and-forget.
    void sendChatMessage(q);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Stable reference — an inline handler would defeat MessageBubble's memo.
  // (zustand action references are stable, so this never actually re-creates.)
  const handleSourceClick = useCallback((docId: string) => {
    focusNode(docId);
  }, []);

  const exportTranscript = () => {
    const blob = new Blob([chatTranscriptMarkdown(messages)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'knowledge-nebula-chat.md';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!hasNodes) return null;

  // Bubble only
  if (!isOpen) {
    return (
      <button
        type="button"
        className="chat-bubble-btn"
        onClick={() => setIsOpen(true)}
        title="Chat with your documents"
      >
        <IconChat />
        <span className="chat-bubble-btn__badge">AI</span>
      </button>
    );
  }

  return (
    <div className="chat-panel glass-panel">
      {/* Header */}
      <div className="chat-panel__header">
        <div className="chat-panel__title-row">
          <h3 className="chat-panel__title">Chat with your docs</h3>
          <span className="chat-panel__doc-count">{docCount} doc{docCount !== 1 ? 's' : ''}</span>
          {messages.length > 0 && <button type="button" className="chat-panel__export" onClick={exportTranscript}>Export</button>}
        </div>
        <button
          type="button"
          className="chat-panel__close"
          onClick={() => setIsOpen(false)}
          aria-label="Close chat"
          title="Close chat"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            <p className="chat-panel__empty-title">Ask anything about your documents</p>
            <p className="chat-panel__empty-hint">
              Your {docCount} uploaded document{docCount !== 1 ? 's are' : ' is'} the
              knowledge source. Try asking about key topics, comparisons, or specific details.
            </p>
          </div>
        )}
        {messages.length === 0 && (
          <div className="chat-panel__workflows">
            <button type="button" onClick={() => setInput('Compare the main positions and evidence across these documents.')}>Compare documents</button>
            <button type="button" onClick={() => setInput('Identify contradictions or unresolved disagreements in this corpus, with citations.')}>Find contradictions</button>
            <button type="button" onClick={() => setInput('Build a timeline of key events, decisions, and dates with citations.')}>Build a timeline</button>
            <button type="button" onClick={() => setInput('Extract decisions, owners, and action items from these documents with citations.')}>Decisions & actions</button>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onSourceClick={handleSourceClick} />
        ))}
        {isStreaming && (
          <div className="chat-typing">
            <span className="chat-typing__dot" />
            <span className="chat-typing__dot" />
            <span className="chat-typing__dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {localMode && (
        <p className="chat-panel__mode-hint" title="Answers use indexed passages or exported document summaries from your own graph — no AI service, no network.">
          Offline mode — answers use indexed passages and document summaries.
        </p>
      )}

      {/* Input */}
      <div className="chat-panel__input-row">
        <textarea
          ref={inputRef}
          className="chat-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question…"
          title="Ask a question about your documents. Enter to send, Shift+Enter for a new line."
          rows={1}
        />
        <button
          type="button"
          className={`chat-panel__send${isStreaming ? ' is-stop' : ''}`}
          onClick={isStreaming ? () => cancelChat() : handleSend}
          disabled={!isStreaming && input.trim() === ''}
          title={isStreaming ? 'Stop' : 'Send'}
        >
          {isStreaming ? (
            <IconStop />
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
              <path d="M2.94 5.84a.75.75 0 0 1 .98-.52l12.5 4.5a.75.75 0 0 1 0 1.36l-12.5 4.5a.75.75 0 0 1-1.02-.9l1.6-4.78L2.9 6.72a.75.75 0 0 1 .05-.88zm2.1 1.8l-1.04 3.11a.75.75 0 0 1 0 .5l1.04 3.11L14 10z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
