import { cn } from "@/lib/utils";

export interface ChatBubbleProps {
  /** Ovi AI local V1 renders assistant answers via StructuredAnswer.tsx
   * instead (a native card, never Markdown/plain text) — this bubble is now
   * only for the user's own typed messages and a transient network/server
   * error string (e.g. the server action itself failing before it can
   * return a StructuredResponse at all). */
  role: "user" | "error";
  content: string;
}

/** One plain-text chat bubble — user messages align end (RTL-aware via the
 * page's own dir), error messages align start. `error` is a distinct visual
 * variant (rose-tinted), so a network/server failure is never mistaken for
 * a real business answer. */
export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-card px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
          isUser && "bg-gold-champagne text-white",
          !isUser && "border border-rose-500/40 bg-rose-500/10 text-rose-300",
        )}
      >
        {content}
      </div>
    </div>
  );
}
