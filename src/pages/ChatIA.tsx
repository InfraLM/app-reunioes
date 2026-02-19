import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

const API_BASE = '/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold text-white mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-white mb-2 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-zinc-200 mb-1.5 mt-2 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="mb-2 last:mb-0 space-y-0.5 pl-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 last:mb-0 space-y-0.5 pl-1 list-decimal list-inside">{children}</ol>,
  li: ({ children }) => (
    <li className="flex gap-2 leading-relaxed">
      <span className="text-yellow-400 mt-0.5 shrink-0">•</span>
      <span>{children}</span>
    </li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-yellow-400 underline underline-offset-2 hover:text-yellow-300 break-all"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="bg-zinc-800 text-yellow-300 px-1.5 py-0.5 rounded text-xs font-mono">
      {children}
    </code>
  ),
  hr: () => <hr className="border-zinc-700 my-3" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-yellow-400/50 pl-3 my-2 text-zinc-400 italic">
      {children}
    </blockquote>
  ),
};

const SUGGESTIONS = [
  'O que rolou ontem?',
  'Quais reuniões tiveram ações pendentes?',
  'Me resume as últimas reuniões',
  'Qual foi a última reunião de governança?',
];

export default function ChatIA() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isStreaming) return;

    const userMsg: Message = { role: 'user', content };
    const newMessages: Message[] = [...messages, userMsg];
    setMessages([...newMessages, { role: 'assistant', content: '' }]);
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    setIsStreaming(true);

    const assistantIndex = newMessages.length;

    try {
      const token = localStorage.getItem('token');
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: newMessages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.type === 'delta') {
              setMessages(prev => {
                const updated = [...prev];
                if (updated[assistantIndex]) {
                  updated[assistantIndex] = {
                    ...updated[assistantIndex],
                    content: updated[assistantIndex].content + parsed.text,
                  };
                }
                return updated;
              });
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        if (updated[assistantIndex]) {
          updated[assistantIndex] = {
            role: 'assistant',
            content: 'Ops, deu um erro aqui. Tenta de novo?',
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, messages, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (isStreaming) {
      abortRef.current?.abort();
    }
    setMessages([]);
    setInput('');
    setIsStreaming(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100vh - 80px)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-5 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Chat IA</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Pergunte sobre reuniões, decisões, ações e tudo mais.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white transition-all duration-150"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.95" />
            </svg>
            Nova conversa
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4 pr-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-lg">
                Oi! Sou o Ialdo, analista de reuniões.
              </p>
              <p className="text-zinc-500 text-sm mt-1 max-w-sm mx-auto">
                Me pergunta sobre qualquer reunião — decisões, ações, participantes, atas...
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg mt-1">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-yellow-400/40 hover:bg-zinc-800/80 rounded-xl text-zinc-400 text-sm transition-all duration-150 cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isLoadingDot =
              msg.role === 'assistant' &&
              !msg.content &&
              isStreaming &&
              i === messages.length - 1;

            return (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-yellow-400/15 border border-yellow-400/25 flex items-center justify-center shrink-0 mr-3 mt-1">
                    <span className="text-yellow-400 text-xs font-bold">I</span>
                  </div>
                )}
                <div
                  className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-yellow-400 text-black font-medium rounded-br-sm'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-sm'
                  }`}
                >
                  {isLoadingDot ? (
                    <span className="flex gap-1 items-center h-4">
                      <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  ) : msg.role === 'assistant' ? (
                    <ReactMarkdown components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 pt-3">
        <div className="flex gap-3 items-end bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 focus-within:border-yellow-400/40 transition-colors duration-150">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre uma reunião..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-transparent text-white text-sm placeholder-zinc-600 outline-none resize-none leading-relaxed disabled:opacity-50"
            style={{ maxHeight: 120, overflowY: 'auto' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isStreaming}
            className="w-9 h-9 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-all duration-150 active:scale-95"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="black"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className="text-zinc-700 text-xs mt-2 text-center">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  );
}
