import { useState } from "react";
import { Button } from "./Button";

/** Inline editable text field. Edit button and input are on the same row. */
export default function EditableField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => Promise<void>;
}) {
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
      <span className="text-sm text-gray-400 w-32 shrink-0">{label}</span>
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
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md bg-gray-800 text-gray-100 text-sm outline-none focus:ring-1 focus:ring-indigo-500 border border-gray-700 placeholder:text-gray-500"
            />
            <Button variant="primary" onClick={commit} className="shrink-0">
              Save
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm ml-3 text-gray-200 truncate">
              {value || <span className="text-gray-500">{placeholder ?? "Not set"}</span>}
            </span>
            <Button variant="ghost" onClick={startEdit} className="shrink-0">
              Edit
            </Button>
          </>
        )}
      </div>
    </>
  );
}