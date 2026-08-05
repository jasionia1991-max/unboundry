import { useState } from "react";
import { providerErrorParts } from "./generationErrors";

export function ProviderErrorNotice({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const { raw, summary } = providerErrorParts(message);
  if (!summary) return null;
  return (
    <span className="provider-error-notice">
      <span className="provider-error-summary">{summary}</span>
      {raw && (
        <>
          <button
            aria-expanded={open}
            aria-label={open ? "收起平台原文" : "查看平台原文"}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? "收起原文" : "查看原文"}
          </button>
          {open && (
            <span className="provider-error-detail">
              <code>{raw}</code>
              <button
                aria-label="复制平台原文"
                onClick={() => void navigator.clipboard?.writeText(raw)}
                type="button"
              >
                复制
              </button>
            </span>
          )}
        </>
      )}
    </span>
  );
}
