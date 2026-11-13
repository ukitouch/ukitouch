import { useState } from "react";
import { Button } from "./Button";

export interface EditableFieldProps {
  label: string;
  /** Value on non-editing */
  value: string;
  placeholder?: string;
  onSave: (value: string) => Promise<void>;
}

/** Inline editable text field. Edit button and input are on the same row. */
export function EditableField({
  label,
  value,
  placeholder,
  onSave,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = async () => {
    try {
      await onSave(draft);
    } catch {
      return;
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <>
      <span className="text-sm w-32 shrink-0 text-3">{label}</span>
      <div className="flex items-center gap-3 pb-2">

        {editing ? (
          <>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md text-sm outline-none input-border"
            />
            <Button variant="primary" onClick={commit} className="shrink-0">
              Save
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm ml-3 truncate text-2">
              {value || <span className="text-3">{placeholder ?? "Not set"}</span>}
            </span>
            <Button onClick={startEdit} className="shrink-0">
              Edit
            </Button>
          </>
        )}
      </div>
    </>
  );
}