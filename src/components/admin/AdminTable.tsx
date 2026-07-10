import type { ReactNode } from "react";

export function AdminTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-navy-soft">
      <table className="w-full text-start text-sm">{children}</table>
    </div>
  );
}

export function AdminTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-navy-surface text-xs uppercase text-neutral-bg/60">
      <tr>{children}</tr>
    </thead>
  );
}

export function AdminTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-navy-soft [&>tr]:transition-colors [&>tr:hover]:bg-navy-soft/40">{children}</tbody>;
}

export function AdminEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-neutral-bg/60">
        {message}
      </td>
    </tr>
  );
}
