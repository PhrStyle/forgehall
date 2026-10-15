import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useApp } from "../context";
import { api, HUMAN, type Question } from "../api";
import { Avatar, ErrorBox } from "../ui";
import { ago, clock, splitQuestion } from "../util";

/** Scroll the timeline to a message and flash it. */
export function jumpTo(messageId: string) {
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  // Instant: a smooth scroll gets cancelled when the clicked button takes focus. The flash shows where it landed.
  el.scrollIntoView({ block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("flash");
  window.setTimeout(() => el.classList.remove("flash"), 1700);
}

function useAnswer(threadId: string, onDone?: () => void) {
  const qc = useQueryClient();
  const app = useApp();
  return useMutation({
    mutationFn: (b: { to: string; body: string; replyTo: string }) => api.postMessage(threadId, { ...b, type: "answer" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thread", threadId] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["agents"] });
      app.toast("Answer sent");
      onDone?.();
    },
  });
}

/** One open question: the short question in large text, context folded, answer buttons and a free-text reply. */
function NeedsYouCard({ threadId, q, nameOf }: { threadId: string; q: Question; nameOf: (a: string) => string }) {
  const [text, setText] = useState("");
  const m = useAnswer(threadId, () => setText(""));
  const { head, rest } = splitQuestion(q.body);
  const send = (body: string) => { if (body.trim()) m.mutate({ to: q.from_actor, body: body.trim(), replyTo: q.message_id }); };
  const submit = (e: FormEvent) => { e.preventDefault(); send(text); };
  return (
    <section className="needs-you" aria-label={`Question from ${nameOf(q.from_actor)}`}>
      <div className="ny-head">
        <Avatar id={q.from_actor} name={nameOf(q.from_actor)} />
        <b>{nameOf(q.from_actor)}</b><span className="muted">asks you</span>
        <span className="wait-badge"><i aria-hidden="true" />Needs you</span>
        <time className="faint mono" title={clock(q.created_at)}>{ago(q.created_at)}</time>
      </div>
      <p className="ny-q">{head}</p>
      {rest && (
        <details className="ny-ctx">
          <summary>Show context</summary>
          <pre>{rest}</pre>
        </details>
      )}
      {q.options && q.options.length > 0 && (
        <div className="ny-opts" role="group" aria-label="Answer options">
          {q.options.map((o) => <button key={o} type="button" className="btn" disabled={m.isPending} onClick={() => send(o)}>{o}</button>)}
        </div>
      )}
      <form className="ny-reply" onSubmit={submit}>
        <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or write a reply…" aria-label={`Reply to ${nameOf(q.from_actor)}`} disabled={m.isPending} />
        <button className="btn sm primary" type="submit" disabled={!text.trim() || m.isPending}>{m.isPending ? "Sending…" : "Send"}</button>
        <button className="btn sm ghost" type="button" onClick={() => jumpTo(q.message_id)}>Jump to message</button>
      </form>
      <ErrorBox error={m.error} />
    </section>
  );
}

export function NeedsYou({ threadId, questions, nameOf }: { threadId: string; questions: Question[]; nameOf: (a: string) => string }) {
  const open = questions.filter((q) => !q.answered_by);
  if (open.length === 0) return null;
  return <div className="needs-you-list">{open.map((q) => <NeedsYouCard key={q.message_id} threadId={threadId} q={q} nameOf={nameOf} />)}</div>;
}

/** Every question of the thread, open and answered, with jump links. */
export function QuestionsHistory({ questions, nameOf }: { questions: Question[]; nameOf: (a: string) => string }) {
  if (questions.length === 0) return null;
  const open = questions.filter((q) => !q.answered_by).length;
  return (
    <details className="card qhist" open={open > 0}>
      <summary><h3>Questions <span className="mono">{questions.length}</span></h3>{open > 0 && <span className="wait-badge"><i aria-hidden="true" />{open} open</span>}</summary>
      <ul>
        {questions.map((q) => (
          <li key={q.message_id}>
            <div className="qh-top">
              <span className={`qh-st ${q.answered_by ? "done" : "open"}`}>{q.answered_by ? "Answered" : "Open"}</span>
              <span className="faint mono">{nameOf(q.from_actor)} · {ago(q.created_at)}</span>
            </div>
            <div className="qh-text">{splitQuestion(q.body).head}</div>
            <div className="qh-links">
              <button type="button" className="linkbtn" onClick={() => jumpTo(q.message_id)}>Question</button>
              {q.answered_by && <button type="button" className="linkbtn" onClick={() => jumpTo(q.answered_by!)}>Answer</button>}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

export { HUMAN };
