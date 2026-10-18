import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import { AppErrorFallback, ErrorBoundary } from "./ui/ErrorBoundary";
import "./styles.css";

const appFallback = () => <AppErrorFallback />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary fallback={appFallback} label="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
