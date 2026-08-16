import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, Citation } from '../types/models';
import { api } from '../api';
import { AiService, SUGGESTIONS } from '../services/aiService';

interface Msg extends ChatMessage {
  citations?: Citation[];
}

export function AIPanel({ onOpenCitation }: { onOpenCitation: (c: Citation) => void }) {
  const service = useMemo(() => new AiService(api), []);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hosted, setHosted] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.aiEnabled().then(setHosted).catch(() => setHosted(false));
  }, []);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;

    // The whole thread is sent, not just this question — that is what makes a
    // follow-up like "and the week before?" resolvable.
    const thread: Msg[] = [...messages, { role: 'user', text: question }];
    setMessages(thread);
    setInput('');
    setBusy(true);
    try {
      const answer = await service.chat(thread.map(({ role, text }) => ({ role, text })));
      setMessages([...thread, { role: 'assistant', text: answer.text, citations: answer.citations }]);
    } catch (err) {
      setMessages([
        ...thread,
        { role: 'assistant', text: `Could not answer that: ${(err as Error).message}` },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  };

  return (
    <aside className="aipanel" aria-label="AI assistant">
      <div className="aipanel__head">
        <span>✨ Assistant</span>
        {messages.length > 0 && (
          <button
            type="button"
            className="linkbtn"
            onClick={() => setMessages([])}
            disabled={busy}
          >
            New conversation
          </button>
        )}
      </div>

      <div className="aipanel__body" ref={bodyRef}>
        {messages.length === 0 && (
          <>
            <div className="aimsg aimsg--bot">
              Ask about anything you have written. I search your notes first, then answer from what I
              find — and you can follow up without repeating yourself.
            </div>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="aisuggest" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`aimsg aimsg--${m.role === 'user' ? 'user' : 'bot'}`}>
            {m.text}
            {m.citations && m.citations.length > 0 && (
              <span className="aicites">
                {m.citations.map((c, j) => (
                  <button key={j} type="button" className="aicite" onClick={() => onOpenCitation(c)}>
                    {c.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        ))}

        {busy && <div className="aimsg aimsg--bot">Reading your notes…</div>}
      </div>

      <div className="aipanel__foot">
        <input
          className="form-control aipanel__input"
          placeholder="Ask about your notes…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask(input)}
        />
        <button type="button" className="btn btn-primary aipanel__send" onClick={() => ask(input)}>
          Ask
        </button>
      </div>

      <div className="aipanel__note">
        {hosted === null
          ? 'Checking which model is available…'
          : hosted
            ? 'Answers come from a hosted model reading your notes through a read-only tool layer. It can search and count; it cannot edit anything.'
            : 'Running on the local extractive provider — answers are assembled from your own notes, on device, with no network call. Configure GEMINI_API_KEY on the backend for conversational answers.'}
      </div>
    </aside>
  );
}
