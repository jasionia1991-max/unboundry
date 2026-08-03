import { NodeToolbar, Position } from "@xyflow/react";

export function EmptyMediaUploadToolbar({
  label,
  onUpload,
  testId,
  visible,
}: {
  label: string;
  onUpload: () => void;
  testId: string;
  visible: boolean;
}) {
  return (
    <NodeToolbar
      className="media-node-upload-toolbar nodrag nopan nowheel"
      data-testid={testId}
      isVisible={visible}
      offset={16}
      position={Position.Top}
    >
      <button aria-label={label} onClick={onUpload} type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 16V4M8 8l4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
        </svg>
        <span>上传</span>
      </button>
    </NodeToolbar>
  );
}
