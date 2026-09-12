import { useId } from "react";
import { CircleHelp } from "lucide-react";

export function ControlHelp({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  const id = useId();
  return (
    <span className="control-help">
      <button
        type="button"
        className="control-help-trigger"
        aria-label={`Help for ${label}`}
        aria-describedby={id}
        title={description}
        popoverTarget={id}
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      <span
        id={id}
        popover="auto"
        role="tooltip"
        className="control-help-popover"
      >
        <strong>{label}</strong>
        <span>{description}</span>
        <small>Tap outside or press Escape to close.</small>
      </span>
    </span>
  );
}
