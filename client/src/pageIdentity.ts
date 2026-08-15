import { useEffect } from "react";

export function normalizedPageLabel(value: string, fallback = "无央") {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, 120);
}

export function brandedPageTitle(label: string) {
  return `${normalizedPageLabel(label)}｜无央`;
}

export function usePageTitle(label: string) {
  useEffect(() => {
    document.title = brandedPageTitle(label);
  }, [label]);
}
