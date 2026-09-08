import { cn } from "@/lib/utils";
import type { StructuredResponse } from "@/lib/ai/types";

export interface StructuredAnswerProps {
  response: StructuredResponse;
}

const ERROR_KINDS = new Set(["ERROR", "READ_ONLY"]);

/** Renders one native-React StructuredResponse card — replaces the old
 * free-text/Markdown assistant bubble entirely (this is what fixes the
 * production bug where a Markdown table rendered as raw "| الصنف | الكمية
 * |" text). Every field is optional so TEXT/CLARIFICATION/NO_MATCH kinds
 * (summary only) and data kinds (summary + metrics/sections/table) share one
 * renderer without a kind-by-kind switch. Mobile-first, RTL-correct (no
 * explicit `dir` needed — inherits the page's own), wide tables scroll
 * inside their own container rather than the page. */
export function StructuredAnswer({ response }: StructuredAnswerProps) {
  const isError = ERROR_KINDS.has(response.kind);

  return (
    <div
      className={cn(
        "max-w-[90%] rounded-card border px-4 py-3 text-sm leading-relaxed sm:max-w-[80%]",
        isError ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-navy-soft bg-navy-surface text-neutral-bg",
      )}
    >
      {response.title && <div className="mb-1 font-semibold text-neutral-bg">{response.title}</div>}
      <p className="whitespace-pre-wrap">{response.summary}</p>

      {response.metrics && response.metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {response.metrics.map((metric) => (
            <div key={metric.label} className="rounded-card border border-navy-soft bg-navy-deep px-3 py-1.5 text-xs">
              <span className="text-neutral-bg/60">{metric.label}: </span>
              <span className="font-semibold text-neutral-bg">{metric.value}</span>
            </div>
          ))}
        </div>
      )}

      {response.sections && response.sections.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {response.sections.map((section, index) => (
            <div key={section.title ?? index}>
              {section.title && <div className="mb-1 text-xs font-medium text-neutral-bg/70">{section.title}</div>}
              <ul className="flex flex-col gap-1">
                {section.rows.map((row, rowIndex) => (
                  <li key={rowIndex} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-neutral-bg/80">
                      {row.label}
                      {row.subLabel ? ` — ${row.subLabel}` : ""}
                    </span>
                    <span className="font-medium text-neutral-bg">{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {response.table && response.table.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[280px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-navy-soft text-neutral-bg/60">
                {response.table.columns.map((column) => (
                  <th key={column} className="px-2 py-1.5 text-start font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {response.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-navy-soft/50 last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-2 py-1.5 text-neutral-bg">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
