import { Fragment, createElement, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Marked } from 'marked';
import type { MarkedToken, Token, Tokens } from 'marked';
import './c6-teaching-reading.css';

const markdown = new Marked({ gfm: true, breaks: false });

function linkTarget(value: string): string | undefined {
  if (
    [...value].some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) ||
    value.includes('\\') ||
    value.startsWith('//')
  )
    return;
  if (/^(?:https?:|mailto:)/iu.test(value) || !/^[^/?#]*:/u.test(value)) return value;
}

/** Course images are bundled assets; reading never requests third-party image hosts. */
function imageTarget(value: string): string | undefined {
  const relative = value.replace(/^\.?\//u, '');
  if (/^content\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.(?:png|jpe?g|gif|webp|svg)$/iu.test(relative))
    return `${import.meta.env.BASE_URL}${relative}`;
}

function CourseImage({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="c6-reading-figure">
      <img src={src} alt={alt} title={title} loading="lazy" decoding="async" />
      <button className="button button-secondary" type="button" onClick={() => setExpanded(true)}>
        放大图解
      </button>
      {expanded &&
        createPortal(
          <dialog
            className="c6-figure-dialog"
            aria-label={alt}
            ref={(dialog) => {
              if (dialog && !dialog.open) dialog.showModal();
            }}
            onClose={() => setExpanded(false)}
            onCancel={() => setExpanded(false)}
          >
            <div className="c6-figure-toolbar">
              <p>{alt}</p>
              <form method="dialog">
                <button className="button button-secondary">关闭图解</button>
              </form>
            </div>
            <p className="muted">横向滚动查看完整图解</p>
            <div
              className="c6-figure-zoom"
              tabIndex={0}
              role="region"
              aria-label="放大图解，可横向滚动"
            >
              <img src={src} alt={alt} />
            </div>
          </dialog>,
          document.querySelector('.p05-app') ?? document.body,
        )}
    </span>
  );
}

/** Retain the complete fenced source, including its final newlines. */
function codeText(token: Tokens.Code): string {
  const fenced = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*(?:\n|$)/mu.exec(token.raw);
  return fenced ? fenced[2] : token.text;
}

function renderTokens(tokens: readonly Token[]): ReactNode {
  return tokens.map((generic, index) => {
    const token = generic as MarkedToken;
    let child: ReactNode;
    switch (token.type) {
      case 'space':
      case 'def':
        return null;
      case 'heading':
        child = createElement(`h${token.depth}`, {}, renderTokens(token.tokens));
        break;
      case 'paragraph':
        child = <p>{renderTokens(token.tokens)}</p>;
        break;
      case 'text':
        child = token.tokens ? renderTokens(token.tokens) : token.text;
        break;
      case 'escape':
      case 'html':
        child = token.text;
        break;
      case 'strong':
        child = <strong>{renderTokens(token.tokens)}</strong>;
        break;
      case 'em':
        child = <em>{renderTokens(token.tokens)}</em>;
        break;
      case 'del':
        child = <del>{renderTokens(token.tokens)}</del>;
        break;
      case 'codespan':
        child = <code>{token.text}</code>;
        break;
      case 'br':
        child = <br />;
        break;
      case 'hr':
        child = <hr />;
        break;
      case 'blockquote':
        child = <blockquote>{renderTokens(token.tokens)}</blockquote>;
        break;
      case 'code': {
        const language = token.lang?.split(/\s/u)[0] ?? '';
        child = (
          <pre tabIndex={0} aria-label={language === 'c' ? '完整 C 源码' : '文本与输出'}>
            <code data-language={language}>{codeText(token)}</code>
          </pre>
        );
        break;
      }
      case 'link': {
        // Bare GFM URLs can swallow adjacent Chinese explanations; authors mark links explicitly.
        const explicit = token.raw.startsWith('[') || token.raw.startsWith('<');
        const href = explicit ? linkTarget(token.href) : undefined;
        child = href ? (
          <a href={href} title={token.title ?? undefined} rel="noreferrer">
            {renderTokens(token.tokens)}
          </a>
        ) : (
          renderTokens(token.tokens)
        );
        break;
      }
      case 'image': {
        const src = imageTarget(token.href);
        child = src ? (
          <CourseImage src={src} alt={token.text} title={token.title ?? undefined} />
        ) : (
          <span>{token.text}</span>
        );
        break;
      }
      case 'list': {
        const items = token.items.map((item, i) => (
          <li key={i}>
            {item.task && (
              <input
                type="checkbox"
                checked={item.checked ?? false}
                disabled
                aria-label="清单状态"
              />
            )}
            {renderTokens(item.tokens)}
          </li>
        ));
        child = token.ordered ? <ol start={Number(token.start)}>{items}</ol> : <ul>{items}</ul>;
        break;
      }
      case 'list_item':
        child = <li>{renderTokens(token.tokens)}</li>;
        break;
      case 'checkbox':
        child = <input type="checkbox" checked={token.checked} disabled aria-label="清单状态" />;
        break;
      case 'table':
        child = (
          <div className="c6-reading-table-wrap">
            <p className="c6-reading-scroll-hint">左右滑动查看完整表格</p>
            <div
              className="c6-reading-table"
              tabIndex={0}
              role="region"
              aria-label="正文表格，可横向滚动"
            >
              <table>
                <thead>
                  <tr>
                    {token.header.map((cell, i) => (
                      <th key={i} scope="col" style={{ textAlign: cell.align ?? undefined }}>
                        {renderTokens(cell.tokens)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {token.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} style={{ textAlign: cell.align ?? undefined }}>
                          {renderTokens(cell.tokens)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
        break;
      default:
        child = generic.raw;
    }
    return <Fragment key={index}>{child}</Fragment>;
  });
}

/** Markdown becomes React text/elements; source HTML is never interpreted. */
export function C6TeachingReading({
  text,
  repeatedTitle,
}: {
  readonly text: string;
  readonly repeatedTitle?: string;
}) {
  const tokens = useMemo(() => {
    const parsed = markdown.lexer(text);
    const first = parsed.findIndex((token) => token.type !== 'space' && token.type !== 'def');
    const heading = parsed[first];
    if (repeatedTitle && heading?.type === 'heading' && heading.depth === 1) {
      const plain = (parts: readonly Token[]): string =>
        parts
          .map((part) => {
            const token = part as MarkedToken;
            if ('tokens' in token && token.tokens) return plain(token.tokens);
            return 'text' in token ? token.text : '';
          })
          .join('');
      const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
      if (normalize(plain(heading.tokens ?? [])) === normalize(repeatedTitle))
        parsed.splice(first, 1);
    }
    return parsed;
  }, [text, repeatedTitle]);
  return <article className="c6-teaching-reading">{renderTokens(tokens)}</article>;
}
