import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent text rendered as Markdown: lists, code, emphasis, tables, and bare URLs as links.
 * Raw HTML in the text is not rendered (react-markdown's default), so agent output cannot
 * inject markup. Links open in a new tab.
 */
export function Markdown({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`md${compact ? " md-compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
