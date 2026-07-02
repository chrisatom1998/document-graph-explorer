/**
 * Chat-with-data panel: floating bubble in lower-left that expands into
 * a chat interface. Uses RAG over all uploaded documents.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { sendChatMessage } from '../chat/ragChat';
import { useChatStore, type ChatMessage, type ContentBlock } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

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

const CALLOUT_ICONS: Record<string, string> = {
  note: '💡',
  important: '⚠️',
  tip: '✨',
  source: '📎',
};

/** Renders a single structured content block. */
function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'heading':
      return <h4 className="chat-block-heading">{block.text}</h4>;

    case 'paragraph':
      return <p className="chat-block-paragraph">{block.text}</p>;

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`chat-block-list ${block.ordered ? 'chat-block-list--ordered' : ''}`}>
          {block.items.map((item, i) => (
            <li key={i} className="chat-block-list__item">{item}</li>
          ))}
        </Tag>
      );
    }

    case 'callout': {
      const icon = CALLOUT_ICONS[block.label.toLowerCase()] ?? '💬';
      return (
        <div className={`chat-block-callout chat-block-callout--${block.label.toLowerCase()}`}>
          <span className="chat-block-callout__icon">{icon}</span>
          <div className="chat-block-callout__content">
            <span className="chat-block-callout__label">{block.label}</span>
            <span className="chat-block-callout__text">{block.text}</span>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

function SourceChips({ sources, onSourceClick }: { sources: string[]; onSourceClick: (id: string) => void }) {
  const nodes = useGraphStore((s) => s.nodes);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="chat-sources">
      {sources.map((id) => {
        const node = nodeMap.get(id);
        const title = node?.title ?? id.slice(0, 12);
        return (
          <button
            key={id}
            type="button"
            className="chat-source-chip"
            title={`Open "${title}"`}
            onClick={() => onSourceClick(id)}
          >
            📄 {title.length > 30 ? title.slice(0, 28) + '…' : title}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg, onSourceClick }: { msg: ChatMessage; onSourceClick: (id: string) => void }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const hasBlocks = msg.role === 'assistant' && msg.blocks && msg.blocks.length > 0;

  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      <div className={`chat-bubble chat-bubble--${msg.role}`}>
        {hasBlocks ? (
          <div className="chat-bubble__blocks">
            {msg.blocks!.map((block, i) => (
              <BlockRenderer key={i} block={block} />
            ))}
          </div>
        ) : (
          <p className="chat-bubble__text">{msg.text}</p>
        )}
        {msg.sources && msg.sources.length > 0 && (
          <SourceChips sources={msg.sources} onSourceClick={onSourceClick} />
        )}
      </div>
      <span className="chat-message__time">
        {isSystem ? '⚠' : isUser ? 'You' : 'AI'} · {formatTime(msg.timestamp)}
      </span>
    </div>
  );
}

export default function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen);
  const setIsOpen = useChatStore((s) => s.setIsOpen);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const setSelected = useUiStore((s) => s.setSelected);
  const sendCamera = useUiStore((s) => s.sendCamera);

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
    sendChatMessage(q);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSourceClick = (docId: string) => {
    setSelected(docId);
    sendCamera('frameNode', [docId]);
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

  const docCount = useGraphStore.getState().nodes.filter((n) => n.kind === 'document').length;

  return (
    <div className="chat-panel glass-panel">
      {/* Header */}
      <div className="chat-panel__header">
        <div className="chat-panel__title-row">
          <h3 className="chat-panel__title">Chat with your docs</h3>
          <span className="chat-panel__doc-count">{docCount} doc{docCount !== 1 ? 's' : ''}</span>
        </div>
        <button
          type="button"
          className="chat-panel__close"
          onClick={() => setIsOpen(false)}
          aria-label="Close chat"
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

      {/* Input */}
      <div className="chat-panel__input-row">
        <textarea
          ref={inputRef}
          className="chat-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question…"
          rows={1}
          disabled={isStreaming}
        />
        <button
          type="button"
          className="chat-panel__send"
          onClick={handleSend}
          disabled={isStreaming || input.trim() === ''}
          title="Send"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path d="M2.94 5.84a.75.75 0 0 1 .98-.52l12.5 4.5a.75.75 0 0 1 0 1.36l-12.5 4.5a.75.75 0 0 1-1.02-.9l1.6-4.78L2.9 6.72a.75.75 0 0 1 .05-.88zm2.1 1.8l-1.04 3.11a.75.75 0 0 1 0 .5l1.04 3.11L14 10z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
