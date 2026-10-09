import type { ReactNode } from "react";

// Both modes render the same operational page; database mode must never replace
// the children with the old read-only snapshot and hide the manual actions.
export default function ClientesLayout({ children }: { children: ReactNode }) {
  return children;
}
