import { cn } from "@/lib/utils";

export interface ChatBubbleProps {
  role: "user" | "assistant" | "error";
  content: string;
}

/** One chat message bubble — user messages align end (RTL-aware via the
 * page's own dir), assistant/error messages align start. `error` is a
 * distinct visual variant (rose-tinted) from a normal assistant reply, so a
 * provider/tool failure is never mistaken for a real business answer. */
export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === "user";
  const isError = role === "error";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-card px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
          isUser && "bg-gold-champagne text-white",
          !isUser && !isError && "border border-navy-soft bg-navy-surface text-neutral-bg",
          isError && "border border-rose-500/40 bg-rose-500/10 text-rose-300",
        )}
      >
        {content}
      </div>
    </div>
  );
}
