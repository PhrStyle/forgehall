/** Inline error under a field. Pair with aria-invalid and aria-describedby on the input. */
export function FieldError({ id, msg }: { id: string; msg: string | null | undefined }) {
  return msg ? <span id={id} className="field-err" role="alert">{msg}</span> : null;
}

/** Focus the first field (in order) whose error is set. Returns true when something was focused. */
export function focusFirstInvalid(entries: [string | null | undefined, HTMLElement | null][]): boolean {
  for (const [err, el] of entries) {
    if (err && el) { el.focus(); return true; }
  }
  return false;
}
