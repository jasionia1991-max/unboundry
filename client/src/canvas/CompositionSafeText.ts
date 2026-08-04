import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type CompositionSafeTextOptions = {
  onCommit: (value: string) => void;
  onEditSessionStart?: () => void;
  value: string;
};

type CompositionSafeTextControl = {
  blur: () => { rolledBack: boolean; value: string };
  change: (value: string, nativeComposing?: boolean) => void;
  committedValue: string;
  composing: boolean;
  compositionEnd: (value: string) => void;
  compositionStart: () => void;
  keyDown: (event: ReactKeyboardEvent<HTMLElement>) => string | undefined;
  value: string;
};

export type CompositionSafeRichTextValue = {
  html: string;
  text: string;
};

type CompositionSafeRichTextOptions = {
  onCommit: (value: CompositionSafeRichTextValue) => void;
  onEditSessionStart?: () => void;
  value: CompositionSafeRichTextValue;
};

type CompositionSafeRichTextControl = {
  blur: () => { rolledBack: boolean; value: CompositionSafeRichTextValue };
  change: (
    value: CompositionSafeRichTextValue,
    nativeComposing?: boolean,
  ) => void;
  committedValue: CompositionSafeRichTextValue;
  composing: boolean;
  compositionEnd: (value: CompositionSafeRichTextValue) => void;
  compositionStart: () => void;
  keyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => CompositionSafeRichTextValue | undefined;
  value: CompositionSafeRichTextValue;
};

const HISTORY_LIMIT = 100;

type CompositionSafeValueOptions<Value> = {
  equal: (left: Value, right: Value) => boolean;
  onCommit: (value: Value) => void;
  onEditSessionStart?: () => void;
  value: Value;
};

type CompositionSafeValueControl<Value> = {
  blur: () => { rolledBack: boolean; value: Value };
  change: (value: Value, nativeComposing?: boolean) => void;
  committedValue: Value;
  composing: boolean;
  compositionEnd: (value: Value) => void;
  compositionStart: () => void;
  keyDown: (event: ReactKeyboardEvent<HTMLElement>) => Value | undefined;
  value: Value;
};

function useCompositionSafeValue<Value>({
  equal,
  onCommit,
  onEditSessionStart,
  value,
}: CompositionSafeValueOptions<Value>): CompositionSafeValueControl<Value> {
  const [draft, setDraft] = useState(value);
  const [composing, setComposing] = useState(false);
  const draftRef = useRef(value);
  const committed = useRef(value);
  const composingRef = useRef(false);
  const ignoreCompositionEnd = useRef(false);
  const sessionStarted = useRef(false);
  const undo = useRef<Value[]>([]);
  const redo = useRef<Value[]>([]);
  const equalRef = useRef(equal);
  const onCommitRef = useRef(onCommit);
  const onEditSessionStartRef = useRef(onEditSessionStart);

  equalRef.current = equal;
  onCommitRef.current = onCommit;
  onEditSessionStartRef.current = onEditSessionStart;

  const updateDraft = (nextValue: Value) => {
    draftRef.current = nextValue;
    setDraft(nextValue);
  };

  useEffect(() => {
    if (equalRef.current(value, committed.current)) return;
    // The focused control owns its edit session. A parent render can briefly
    // carry the previous persisted value while React Flow propagates the local
    // node update; treating that stale echo as authoritative loses keystrokes.
    if (sessionStarted.current) return;
    committed.current = value;
    draftRef.current = value;
    composingRef.current = false;
    ignoreCompositionEnd.current = false;
    sessionStarted.current = false;
    undo.current = [];
    redo.current = [];
    setComposing(false);
    setDraft(value);
  }, [value]);

  const beginEditSession = () => {
    if (sessionStarted.current) return;
    sessionStarted.current = true;
    onEditSessionStartRef.current?.();
  };

  const commit = (nextValue: Value, recordUndo: boolean) => {
    const previous = committed.current;
    updateDraft(nextValue);
    if (equalRef.current(nextValue, previous)) return nextValue;
    beginEditSession();
    if (recordUndo) {
      undo.current.push(previous);
      if (undo.current.length > HISTORY_LIMIT) undo.current.shift();
      redo.current = [];
    }
    committed.current = nextValue;
    onCommitRef.current(nextValue);
    return nextValue;
  };

  const applyUndo = () => {
    const previous = undo.current.pop();
    if (previous === undefined) return undefined;
    redo.current.push(committed.current);
    return commit(previous, false);
  };

  const applyRedo = () => {
    const next = redo.current.pop();
    if (next === undefined) return undefined;
    undo.current.push(committed.current);
    return commit(next, false);
  };

  return {
    blur: () => {
      const rolledBack =
        composingRef.current ||
        !equalRef.current(draftRef.current, committed.current);
      composingRef.current = false;
      ignoreCompositionEnd.current = rolledBack;
      sessionStarted.current = false;
      undo.current = [];
      redo.current = [];
      setComposing(false);
      updateDraft(committed.current);
      return { rolledBack, value: committed.current };
    },
    change: (nextValue, nativeComposing = false) => {
      updateDraft(nextValue);
      if (composingRef.current || nativeComposing) return;
      commit(nextValue, true);
    },
    committedValue: committed.current,
    composing,
    compositionEnd: (nextValue) => {
      composingRef.current = false;
      setComposing(false);
      if (ignoreCompositionEnd.current) {
        ignoreCompositionEnd.current = false;
        updateDraft(committed.current);
        return;
      }
      commit(nextValue, true);
    },
    compositionStart: () => {
      composingRef.current = true;
      ignoreCompositionEnd.current = false;
      setComposing(true);
    },
    keyDown: (event) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (!commandKey || event.key.toLocaleLowerCase() !== "z") {
        return undefined;
      }
      event.preventDefault();
      event.stopPropagation();
      if (composingRef.current || event.nativeEvent.isComposing) {
        composingRef.current = false;
        ignoreCompositionEnd.current = true;
        setComposing(false);
        updateDraft(committed.current);
        return committed.current;
      }
      return event.shiftKey ? applyRedo() : applyUndo();
    },
    value: draft,
  };
}

/**
 * Keeps IME pre-edit text local to the focused control. Only a completed
 * composition is committed, and the control owns logical undo/redo while it
 * remains focused. Canvas history receives one checkpoint per focus session.
 */
export function useCompositionSafeText({
  onCommit,
  onEditSessionStart,
  value,
}: CompositionSafeTextOptions): CompositionSafeTextControl {
  return useCompositionSafeValue({
    equal: (left, right) => left === right,
    onCommit,
    onEditSessionStart,
    value,
  });
}

/**
 * Contenteditable companion to useCompositionSafeText. The logical history
 * stores both plain text and safe rich markup, so formatting never disappears
 * when the focused editor handles undo/redo.
 */
export function useCompositionSafeRichText({
  onCommit,
  onEditSessionStart,
  value,
}: CompositionSafeRichTextOptions): CompositionSafeRichTextControl {
  return useCompositionSafeValue({
    equal: (left, right) =>
      left.text === right.text && left.html === right.html,
    onCommit,
    onEditSessionStart,
    value,
  });
}
