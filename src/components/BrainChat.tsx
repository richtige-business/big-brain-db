'use client';

// Glass Chatbar — ask an LLM (via OpenRouter) about the Brain.
// Ported from the "Glass Chatbar" Claude Design into the app's React/Next stack.
// Talks only to our own API routes (/api/brain/chat|models|spaces|context); the
// OpenRouter key stays server-side. Glass aesthetic, model switcher, and a settings
// panel where the system prompt + RAG context are visible and editable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ACCENT = '#FF7A66';

const DEFAULT_SYSTEM_PROMPT =
  'You are the Brain assistant for this knowledge base. Answer questions using the ' +
  'provided Brain Context as your primary source of truth. Cite the document titles ' +
  'you relied on. If the context does not contain the answer, say so plainly rather ' +
  'than inventing facts.';

interface Model {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: number | null;
  completionPrice: number | null;
}
interface Space {
  scopeType: string;
  scopeId: string;
  name: string;
}
interface Source {
  title: string;
  slug: string;
  type: string;
  brain: string;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}
interface Settings {
  systemPrompt: string;
  useContext: boolean;
  contextLimit: number;
  scopeType: string; // '' = all brains
  scopeId: string;
}

const SETTINGS_KEY = 'brainChat.settings';
const MODEL_KEY = 'brainChat.modelId';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const DEFAULT_SETTINGS: Settings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  useContext: true,
  contextLimit: 8,
  scopeType: '',
  scopeId: '',
};

// Stable dot colour per provider so models read as families in the switcher.
const PROVIDER_DOTS: Record<string, string> = {
  anthropic: '#FF7A66',
  openai: '#34E0C0',
  google: '#8B7CFF',
  'meta-llama': '#4F9DFF',
  mistralai: '#FF4D6D',
  'x-ai': '#cccccc',
  deepseek: '#5B8DEF',
  qwen: '#C77DFF',
};
function providerDot(id: string): string {
  return PROVIDER_DOTS[id.split('/')[0]] ?? '#9aa0a6';
}
function modelTag(m: Model): string {
  const ctx = m.contextLength ? `${Math.round(m.contextLength / 1000)}K ctx` : '';
  return [m.id.split('/')[0], ctx].filter(Boolean).join(' · ');
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const glassPanel: React.CSSProperties = {
  borderRadius: 18,
  background: 'rgba(26,23,36,0.86)',
  backdropFilter: 'blur(28px) saturate(160%)',
  WebkitBackdropFilter: 'blur(28px) saturate(160%)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 24px 60px -16px rgba(0,0,0,0.7)',
};
const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 13,
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.78)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  transition: 'all 0.18s',
};

export function BrainChat() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Context inspector (settings → "Inspect context").
  const [ctxPreview, setCtxPreview] = useState<{ block: string; sources: Source[] } | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate persisted settings + model once on mount.
  useEffect(() => {
    setSettings(loadSettings());
    const savedModel = localStorage.getItem(MODEL_KEY);
    if (savedModel) setModelId(savedModel);
  }, []);

  // Lazy-load models + spaces the first time the chat opens.
  useEffect(() => {
    if (!open || models.length > 0) return;
    fetch('/api/brain/models')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && Array.isArray(j.models)) setModels(j.models);
        else setError(j?.message || 'Could not load models. Is OPENROUTER_API_KEY set?');
      })
      .catch(() => setError('Could not reach /api/brain/models.'));
    fetch('/api/brain/spaces')
      .then((r) => r.json())
      .then((j) => j?.success && setSpaces(j.spaces || []))
      .catch(() => undefined);
  }, [open, models.length]);

  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }, []);

  const selectModel = useCallback((id: string) => {
    setModelId(id);
    setModelOpen(false);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const activeModel = useMemo(
    () => models.find((m) => m.id === modelId) || { id: modelId, name: modelId, contextLength: null, promptPrice: null, completionPrice: null },
    [models, modelId],
  );
  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const list = q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) : models;
    return list.slice(0, 60);
  }, [models, modelQuery]);

  // Auto-grow textarea + keep the transcript scrolled to the bottom.
  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [text]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = useCallback(async () => {
    const question = text.trim();
    if (!question || streaming) return;
    setError(null);
    setText('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    try {
      const res = await fetch('/api/brain/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          model: modelId,
          history,
          systemPrompt: settings.systemPrompt,
          useContext: settings.useContext,
          contextLimit: settings.contextLimit,
          ...(settings.scopeType && settings.scopeId
            ? { scopeType: settings.scopeType, scopeId: settings.scopeId }
            : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || `Request failed (${res.status}).`);
      }
      let sources: Source[] = [];
      try {
        sources = JSON.parse(decodeURIComponent(res.headers.get('X-Brain-Sources') || '%5B%5D'));
      } catch {
        sources = [];
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: acc, sources };
          return next;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chat failed.';
      setError(message);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: `⚠️ ${message}` };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }, [text, streaming, messages, modelId, settings]);

  const inspectContext = useCallback(async () => {
    const question = text.trim() || messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
    if (!question) {
      setCtxPreview({ block: '', sources: [] });
      return;
    }
    setCtxLoading(true);
    try {
      const res = await fetch('/api/brain/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          contextLimit: settings.contextLimit,
          ...(settings.scopeType && settings.scopeId
            ? { scopeType: settings.scopeType, scopeId: settings.scopeId }
            : {}),
        }),
      });
      const j = await res.json();
      setCtxPreview({ block: j?.contextBlock || '(no matching context)', sources: j?.sources || [] });
    } catch {
      setCtxPreview({ block: '(failed to load context)', sources: [] });
    } finally {
      setCtxLoading(false);
    }
  }, [text, messages, settings.contextLimit, settings.scopeType, settings.scopeId]);

  // ── Closed: floating launcher ──────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Ask the Brain"
        style={{
          position: 'fixed',
          bottom: 22,
          right: 22,
          zIndex: 60,
          width: 56,
          height: 56,
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,0.18)',
          cursor: 'pointer',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(140deg, ${ACCENT}, #ff2d75)`,
          boxShadow: `0 12px 30px -8px ${ACCENT}`,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a7 7 0 0 0-7 7c0 2 1 3.5 1 5v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2c0-1.5 1-3 1-5a7 7 0 0 0-7-7Z" />
          <path d="M9 21h6M12 3v18" />
        </svg>
      </button>
    );
  }

  // ── Open: docked glass panel ───────────────────────────────────
  return (
    <div
      className="brainChat"
      style={{ ['--brainAccent' as string]: ACCENT, position: 'fixed', bottom: 18, right: 18, zIndex: 60, width: 'min(440px, calc(100vw - 36px))', display: 'flex', flexDirection: 'column', gap: 12, animation: 'brainChatPanelIn 0.2s ease-out' }}
    >
      {/* Transcript + header card */}
      <div style={{ ...glassPanel, display: 'flex', flexDirection: 'column', maxHeight: 'min(64vh, 620px)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 9px ${ACCENT}` }} />
          <strong style={{ color: '#fff', fontSize: 14, flex: 1 }}>Ask the Brain</strong>
          <button onClick={() => { setSettingsOpen((s) => !s); setCtxPreview(null); }} title="Settings" style={{ ...iconBtn, width: 32, height: 32, borderRadius: 10, background: settingsOpen ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
          </button>
          <button onClick={() => setOpen(false)} title="Close" style={{ ...iconBtn, width: 32, height: 32, borderRadius: 10 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>

        {settingsOpen ? (
          <div className="brainChatScroll" style={{ padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="System prompt">
              <textarea
                value={settings.systemPrompt}
                onChange={(e) => persistSettings({ ...settings, systemPrompt: e.target.value })}
                rows={6}
                style={{ width: '100%', resize: 'vertical', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.5, padding: 10 }}
              />
              <button onClick={() => persistSettings({ ...settings, systemPrompt: DEFAULT_SYSTEM_PROMPT })} style={{ alignSelf: 'flex-start', marginTop: 6, background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Reset to default</button>
            </Field>

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#fff', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.useContext} onChange={(e) => persistSettings({ ...settings, useContext: e.target.checked })} />
              Use Brain context (RAG)
            </label>

            <Field label={`Context documents: ${settings.contextLimit}`}>
              <input type="range" min={1} max={20} value={settings.contextLimit} onChange={(e) => persistSettings({ ...settings, contextLimit: Number(e.target.value) })} style={{ width: '100%', accentColor: ACCENT }} />
            </Field>

            <Field label="Search scope">
              <select
                value={settings.scopeType && settings.scopeId ? `${settings.scopeType}:${settings.scopeId}` : ''}
                onChange={(e) => {
                  const [scopeType, scopeId] = e.target.value.split(':');
                  persistSettings({ ...settings, scopeType: scopeType || '', scopeId: scopeId || '' });
                }}
                style={{ width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 12.5, padding: '8px 10px' }}
              >
                <option value="">All brains</option>
                {spaces.map((s) => (
                  <option key={`${s.scopeType}:${s.scopeId}`} value={`${s.scopeType}:${s.scopeId}`}>{s.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Context sent to the model">
              <button onClick={inspectContext} disabled={ctxLoading} style={{ ...iconBtn, width: 'auto', height: 32, borderRadius: 10, padding: '0 12px', fontSize: 12, fontFamily: 'inherit', gap: 6 }}>
                {ctxLoading ? 'Loading…' : 'Inspect context for current question'}
              </button>
              {ctxPreview && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {ctxPreview.sources.map((s, i) => (
                      <SourceChip key={i} source={s} />
                    ))}
                  </div>
                  <pre className="brainChatScroll" style={{ maxHeight: 200, overflow: 'auto', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 10, color: 'rgba(255,255,255,0.75)', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{ctxPreview.block}</pre>
                </div>
              )}
            </Field>
          </div>
        ) : (
          <div ref={scrollRef} className="brainChatScroll" style={{ padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            {messages.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', padding: '24px 8px' }}>
                Ask anything about your Brain. Answers are grounded in your notes.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 14,
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: '#fff',
                    background: m.role === 'user' ? `linear-gradient(140deg, ${ACCENT}, #ff2d75)` : 'rgba(255,255,255,0.07)',
                    border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {m.role === 'assistant' ? (
                    m.content ? (
                      <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                    ) : (
                      <span style={{ letterSpacing: 2 }}>
                        <span style={{ animation: 'brainChatDots 1.2s infinite' }}>•</span>
                        <span style={{ animation: 'brainChatDots 1.2s infinite 0.2s' }}>•</span>
                        <span style={{ animation: 'brainChatDots 1.2s infinite 0.4s' }}>•</span>
                      </span>
                    )
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                    {m.sources.map((s, j) => (
                      <SourceChip key={j} source={s} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Glass chatbar */}
      <div style={{ position: 'relative', borderRadius: 22, padding: 1, background: 'linear-gradient(150deg, rgba(255,255,255,0.28), rgba(255,255,255,0.04) 45%, rgba(255,255,255,0.16))', boxShadow: '0 22px 60px -18px rgba(0,0,0,0.7)' }}>
        <div style={{ borderRadius: 21, background: 'rgba(22,20,32,0.72)', backdropFilter: 'blur(30px) saturate(160%)', WebkitBackdropFilter: 'blur(30px) saturate(160%)', padding: '12px 12px 10px' }}>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message the Brain…"
            rows={1}
            style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: '#fff', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.5, minHeight: 26, maxHeight: 200, padding: '4px 2px 10px' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <button onClick={() => { setSettingsOpen((s) => !s); }} title="Settings" style={{ ...iconBtn, background: settingsOpen ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {/* Model switcher */}
              <div style={{ position: 'relative' }}>
                <button onClick={() => setModelOpen((s) => !s)} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', maxWidth: 200, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 13, background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: providerDot(activeModel.id), boxShadow: `0 0 9px ${providerDot(activeModel.id)}` }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeModel.name}</span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {modelOpen && (
                  <div style={{ position: 'absolute', bottom: 50, right: 0, width: 300, ...glassPanel, padding: 7, zIndex: 20, animation: 'brainChatPopIn 0.16s ease-out' }}>
                    <input
                      autoFocus
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder={`Search ${models.length} models…`}
                      style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 12.5, padding: '8px 10px', outline: 'none' }}
                    />
                    <div className="brainChatScroll" style={{ maxHeight: 280, overflowY: 'auto' }}>
                      {filteredModels.map((m) => (
                        <button key={m.id} onClick={() => selectModel(m.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: 'none', borderRadius: 11, background: m.id === modelId ? 'rgba(255,255,255,0.08)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: providerDot(m.id), boxShadow: `0 0 8px ${providerDot(m.id)}` }} />
                          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.3, overflow: 'hidden' }}>
                            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{modelTag(m)}</span>
                          </span>
                          {m.id === modelId && (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                          )}
                        </button>
                      ))}
                      {filteredModels.length === 0 && (
                        <div style={{ padding: 12, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No models match “{modelQuery}”.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Send */}
              <button onClick={send} disabled={streaming || !text.trim()} title="Send" style={{ width: 44, height: 44, flexShrink: 0, border: 'none', borderRadius: 14, cursor: streaming || !text.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: text.trim() && !streaming ? 1 : 0.4, background: `linear-gradient(140deg, ${ACCENT}, #ff2d75)`, boxShadow: `0 8px 22px -6px ${ACCENT}` }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ color: '#FF8A8A', fontSize: 11.5, textAlign: 'center' }}>{error}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'rgba(255,255,255,0.34)', fontSize: 11 }}>
        <span>⏎ send</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>⇧⏎ new line</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{settings.useContext ? 'Brain RAG on' : 'RAG off'}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</span>
      {children}
    </div>
  );
}

function SourceChip({ source }: { source: Source }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 9, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.82)', fontSize: 11 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }} />
      {source.title}
      {source.brain && <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {source.brain}</span>}
    </span>
  );
}
