import { createContext, useContext, type ReactNode } from "react";

const CanvasAccountContext = createContext({
  canManagePublicTemplates: false,
});

export function CanvasAccountProvider({
  canManagePublicTemplates,
  children,
}: {
  canManagePublicTemplates: boolean;
  children: ReactNode;
}) {
  return (
    <CanvasAccountContext.Provider value={{ canManagePublicTemplates }}>
      {children}
    </CanvasAccountContext.Provider>
  );
}

export function useCanvasAccount() {
  return useContext(CanvasAccountContext);
}
