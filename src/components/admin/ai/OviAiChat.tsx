"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";
import { sendOviAiMessage, getOviAiAutocomplete } from "@/app/admin/ai/actions";
import { EMPTY_OVI_AI_CONTEXT, type OviAiChip, type OviAiContext, type OviAiSuggestion, type StructuredResponse } from "@/lib/ai/types";
import { ChatBubble } from "@/components/admin/ai/ChatBubble";
import { StructuredAnswer } from "@/components/admin/ai/StructuredAnswer";
import { SuggestionChips } from "@/components/admin/ai/SuggestionChips";
import { loadLearnedAliases, saveLearnedAlias, clearLearnedAliases } from "@/components/admin/ai/learned-aliases";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content?: string;
  response?: StructuredResponse;
}

const STARTER_SUGGESTIONS: OviAiChip[] = [
  { label: "شو قرب يخلص بالمخزون؟", message: "شو قرب يخلص بالمخزون؟" },
  { label: "شو عنا جفرات A26؟", message: "شو عنا جفرات A26؟" },
  { label: "مين معه مخزون بالسيارات؟", message: "مين معه مخزون بالسيارات؟" },
  { label: "أعلى التجار مديونية", message: "أعلى التجار مديونية" },
  { label: "مبيعات اليوم", message: "مبيعات اليوم" },
];

const FALLBACK_ERROR_MESSAGE = "صار خلل مؤقت بالمساعد، جرّب مرة ثانية.";
const AUTOCOMPLETE_DEBOUNCE_MS = 200;
const AUTOCOMPLETE_MIN_LENGTH = 2;

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `ovi-ai-msg-${messageIdCounter}`;
}

/** The Ovi AI chat surface — 100% local/zero-LLM: every send goes to
 * sendOviAiMessage (a deterministic local engine, no network/provider call
 * anywhere behind it) with just the current message + the structured
 * OviAiContext returned by the previous turn (conversation "storage" is
 * entirely request-scoped, nothing persisted server-side) plus an optional
 * client-learned disambiguation hint (see learned-aliases.ts — a bounded,
 * user-confirmed-only localStorage list the server only ever treats as an
 * untrusted ranking hint). */
export function OviAiChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [context, setContext] = useState<OviAiContext>(EMPTY_OVI_AI_CONTEXT);
  const [chips, setChips] = useState<OviAiChip[]>([]);
  const [lastAmbiguousMessage, setLastAmbiguousMessage] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [autocomplete, setAutocomplete] = useState<OviAiSuggestion[]>([]);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRequestId = useRef(0);
  const [hasLearnedAliases, setHasLearnedAliases] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chips, isPending]);

  useEffect(() => {
    setHasLearnedAliases(loadLearnedAliases().length > 0);
  }, []);

  function send(rawText: string) {
    const text = rawText.trim();
    if (!text || isPending) return;

    const learnedHint = findMatchingHint(text);

    setMessages((previous) => [...previous, { id: nextMessageId(), role: "user", content: text }]);
    setChips([]);
    setLastAmbiguousMessage(null);
    setInput("");
    closeAutocomplete();

    startTransition(async () => {
      try {
        const result = await sendOviAiMessage({ message: text, context, learnedHint });
        if (result.ok && result.data) {
          setMessages((previous) => [...previous, { id: nextMessageId(), role: "assistant", response: result.data!.response }]);
          setContext(result.data.context);
          const nextChips = result.data.candidates ?? result.data.suggestions ?? [];
          setChips(nextChips);
          setLastAmbiguousMessage(result.data.candidates && result.data.candidates.length > 0 ? text : null);
        } else {
          setMessages((previous) => [...previous, { id: nextMessageId(), role: "error", content: result.error ?? FALLBACK_ERROR_MESSAGE }]);
        }
      } catch {
        setMessages((previous) => [...previous, { id: nextMessageId(), role: "error", content: FALLBACK_ERROR_MESSAGE }]);
      }
    });
  }

  function findMatchingHint(text: string): { normalizedPhrase: string; entityId: string; entityType: "PRODUCT" | "PHONE_MODEL" | "MERCHANT" | "REP" } | null {
    const target = text.trim().toLowerCase();
    const match = loadLearnedAliases().find((alias) => alias.normalizedPhrase.trim().toLowerCase() === target);
    return match ? { normalizedPhrase: match.normalizedPhrase, entityId: match.entityId, entityType: match.entityType } : null;
  }

  function pickChip(chip: OviAiChip) {
    if (chip.entityId && chip.entityType && lastAmbiguousMessage) {
      saveLearnedAlias({ normalizedPhrase: lastAmbiguousMessage, entityId: chip.entityId, entityType: chip.entityType, label: chip.label, createdAt: Date.now() });
      setHasLearnedAliases(true);
    }
    send(chip.message);
  }

  /** SuggestionChips only ever hands back the picked chip's `message` text
   * (kept string-only so the SAME component works for the starter-question
   * chips too, which pass `send` directly) — this looks the full chip back
   * up (for its entityId/entityType, when learning applies) before
   * delegating to pickChip. */
  function handleChipPick(message: string) {
    const chip = chips.find((candidate) => candidate.message === message);
    pickChip(chip ?? { label: message, message });
  }

  function closeAutocomplete() {
    setAutocomplete([]);
    setAutocompleteOpen(false);
    setHighlightedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  function handleInputChange(value: string) {
    setInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < AUTOCOMPLETE_MIN_LENGTH) {
      setAutocomplete([]);
      setAutocompleteOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++autocompleteRequestId.current;
      getOviAiAutocomplete(trimmed)
        .then((result) => {
          if (requestId !== autocompleteRequestId.current) return; // a newer keystroke already superseded this request
          const suggestions = result.data ?? [];
          setAutocomplete(suggestions);
          setAutocompleteOpen(suggestions.length > 0);
          setHighlightedIndex(-1);
        })
        .catch(() => {
          if (requestId === autocompleteRequestId.current) closeAutocomplete();
        });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  function pickAutocomplete(suggestion: OviAiSuggestion) {
    closeAutocomplete();
    send(suggestion.query);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (autocompleteOpen && autocomplete.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((index) => (index + 1) % autocomplete.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((index) => (index <= 0 ? autocomplete.length - 1 : index - 1));
        return;
      }
      if (event.key === "Escape") {
        closeAutocomplete();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && highlightedIndex >= 0) {
        event.preventDefault();
        pickAutocomplete(autocomplete[highlightedIndex]!);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  function handleNewConversation() {
    setMessages([]);
    setContext(EMPTY_OVI_AI_CONTEXT);
    setChips([]);
    setLastAmbiguousMessage(null);
    setInput("");
    closeAutocomplete();
  }

  function handleClearLearned() {
    clearLearnedAliases();
    setHasLearnedAliases(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-card border border-navy-soft bg-navy-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-navy-soft px-4 py-3">
        <span className="text-sm text-neutral-bg/60">{messages.length > 0 ? "محادثة جارية" : "محادثة جديدة"}</span>
        <div className="flex items-center gap-2">
          {hasLearnedAliases && (
            <Button type="button" variant="ghost" size="sm" onClick={handleClearLearned} disabled={isPending}>
              مسح الاقتراحات المتعلمة
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={handleNewConversation} disabled={messages.length === 0 || isPending}>
            محادثة جديدة
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-sm text-sm text-neutral-bg/60">اسأل عن المخزون، الأصناف، التجار، المبيعات...</p>
            <SuggestionChips chips={STARTER_SUGGESTIONS} onPick={send} />
          </div>
        ) : (
          messages.map((message) =>
            message.role === "assistant" && message.response ? (
              <div key={message.id} className="flex justify-start">
                <StructuredAnswer response={message.response} />
              </div>
            ) : (
              <ChatBubble key={message.id} role={message.role === "assistant" ? "error" : message.role} content={message.content ?? ""} />
            ),
          )
        )}

        {isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-card border border-navy-soft bg-navy-surface px-4 py-2.5 text-sm text-neutral-bg/60">
              <Spinner />
              يفحص البيانات...
            </div>
          </div>
        )}

        {!isPending && chips.length > 0 && <SuggestionChips chips={chips} onPick={handleChipPick} />}

        <div ref={bottomRef} />
      </div>

      <div className="relative flex shrink-0 items-end gap-2 border-t border-navy-soft p-3">
        {autocompleteOpen && autocomplete.length > 0 && (
          <div className="absolute bottom-full start-3 end-3 mb-1 max-h-64 overflow-y-auto rounded-card border border-navy-soft bg-navy-deep shadow-lg">
            {autocomplete.map((suggestion, index) => (
              <button
                key={`${suggestion.type}-${suggestion.query}-${index}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickAutocomplete(suggestion)}
                className={cn(
                  "block w-full px-3 py-2 text-start text-sm text-neutral-bg hover:bg-navy-soft/60",
                  index === highlightedIndex && "bg-navy-soft/60",
                )}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={input}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(closeAutocomplete, 150)}
          rows={1}
          placeholder="اسأل عن المخزون، الأصناف، التجار، المبيعات..."
          disabled={isPending}
          className="min-h-10 flex-1 resize-none rounded-card border border-navy-soft bg-navy-deep px-3 py-2 text-base text-neutral-bg placeholder:text-neutral-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne focus-visible:ring-offset-2 focus-visible:ring-offset-navy-surface"
        />
        <Button type="button" onClick={() => send(input)} disabled={isPending || !input.trim()}>
          إرسال
        </Button>
      </div>
    </div>
  );
}
