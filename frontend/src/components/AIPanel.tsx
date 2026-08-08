import { useMemo, useRef, useState } from 'react';
import { api } from '../api/localApi';
import { AiService, SUGGESTIONS, type Citation } from '../services/aiService';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
}

export function AIPanel({ onOpenCitation }: { onOpenCitation: (c: Citation) => void }) {
  const service = useMemo(() => new AiService(api), []);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const answer = await service.ask(question);
      setMessages((m) => [...m, { role: 'assistant', text: answer.text, citations: answer.citations }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
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
      </div>

      <div className="aipanel__body" ref={bodyRef}>
        {messages.length === 0 && (
          <>
            <div className="aimsg aimsg--bot">
              Ask about anything you have written. I search your notes first, then answer from what I
              find.
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

        {busy && <div className="aimsg aimsg--bot">Searching your notes…</div>}
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
        Running on the local extractive provider — answers are assembled from your own notes, on
        device, with no network call. A hosted model can be configured once the backend lands.
      </div>
    </aside>
  );
}
