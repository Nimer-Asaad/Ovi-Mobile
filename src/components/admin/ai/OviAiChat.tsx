"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";
import { sendOviAiMessage } from "@/app/admin/ai/actions";
import { EMPTY_OVI_AI_CONTEXT, type OviAiChatMessage, type OviAiChip, type OviAiContext } from "@/lib/ai/types";
import { ChatBubble } from "@/components/admin/ai/ChatBubble";
import { SuggestionChips } from "@/components/admin/ai/SuggestionChips";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
}

const STARTER_SUGGESTIONS: OviAiChip[] = [
  { label: "شو قرب يخلص بالمخزون؟", message: "شو قرب يخلص بالمخزون؟" },
  { label: "شو عنا جفرات A26؟", message: "شو عنا جفرات A26؟" },
  { label: "مين معه مخزون بالسيارات؟", message: "مين معه مخزون بالسيارات؟" },
  { label: "أعلى التجار مديونية", message: "أعلى التجار مديونية" },
  { label: "مبيعات اليوم", message: "مبيعات اليوم" },
];

const FALLBACK_ERROR_MESSAGE = "صار خلل مؤقت بالمساعد، جرّب مرة ثانية.";

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `ovi-ai-msg-${messageIdCounter}`;
}

/** The Ovi AI chat surface — all conversation state lives in this one
 * client component's memory for the current browser session only (see the
 * feature report: request-scoped conversation, nothing persisted server-
 * side). Every send re-sends a bounded slice of recent messages plus the
 * structured OviAiContext returned by the previous turn — never the full
 * unbounded history — so follow-ups like "طيب الجلد بس" work without the
 * prompt growing unbounded. */
export function OviAiChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [context, setContext] = useState<OviAiContext>(EMPTY_OVI_AI_CONTEXT);
  const [chips, setChips] = useState<OviAiChip[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chips, isPending]);

  function send(rawText: string) {
    const text = rawText.trim();
    if (!text || isPending) return;

    const history: OviAiChatMessage[] = messages
      .filter((message) => message.role !== "error")
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

    setMessages((previous) => [...previous, { id: nextMessageId(), role: "user", content: text }]);
    setChips([]);
    setInput("");

    startTransition(async () => {
      try {
        const result = await sendOviAiMessage({ message: text, history, context });
        if (result.ok && result.data) {
          setMessages((previous) => [...previous, { id: nextMessageId(), role: "assistant", content: result.data!.reply }]);
          setContext(result.data.context);
          setChips(result.data.candidates ?? result.data.suggestions ?? []);
        } else {
          setMessages((previous) => [...previous, { id: nextMessageId(), role: "error", content: result.error ?? FALLBACK_ERROR_MESSAGE }]);
        }
      } catch {
        setMessages((previous) => [...previous, { id: nextMessageId(), role: "error", content: FALLBACK_ERROR_MESSAGE }]);
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  function handleNewConversation() {
    setMessages([]);
    setContext(EMPTY_OVI_AI_CONTEXT);
    setChips([]);
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-card border border-navy-soft bg-navy-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-navy-soft px-4 py-3">
        <span className="text-sm text-neutral-bg/60">{messages.length > 0 ? "محادثة جارية" : "محادثة جديدة"}</span>
        <Button type="button" variant="ghost" size="sm" onClick={handleNewConversation} disabled={messages.length === 0 || isPending}>
          محادثة جديدة
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-sm text-sm text-neutral-bg/60">اسأل عن المخزون، الأصناف، التجار، المبيعات...</p>
            <SuggestionChips chips={STARTER_SUGGESTIONS} onPick={send} />
          </div>
        ) : (
          messages.map((message) => <ChatBubble key={message.id} role={message.role} content={message.content} />)
        )}

        {isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-card border border-navy-soft bg-navy-surface px-4 py-2.5 text-sm text-neutral-bg/60">
              <Spinner />
              يفكر...
            </div>
          </div>
        )}

        {!isPending && chips.length > 0 && <SuggestionChips chips={chips} onPick={send} />}

        <div ref={bottomRef} />
      </div>

      <div className="flex shrink-0 items-end gap-2 border-t border-navy-soft p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
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
