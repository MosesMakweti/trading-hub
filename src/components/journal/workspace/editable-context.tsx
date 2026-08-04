"use client";

import { createContext, useContext } from "react";

// Whether the trade workspace's inline fields may be edited. Defaults to true so
// any field used outside a provider stays editable. An archived day sets this to
// false, making every field in the workspace read-only from one place instead of
// threading a prop through every section.
const WorkspaceEditableContext = createContext(true);

export function WorkspaceEditableProvider({
  editable,
  children,
}: {
  editable: boolean;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceEditableContext.Provider value={editable}>
      {children}
    </WorkspaceEditableContext.Provider>
  );
}

export function useWorkspaceEditable(): boolean {
  return useContext(WorkspaceEditableContext);
}
