import { Fragment, createElement, useMemo } from 'react';
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
        const href = linkTarget(token.href);
        child = href ? (
          <a href={href} title={token.title ?? undefined} rel="noreferrer">
            {renderTokens(token.tokens)}
          </a>
        ) : (
          renderTokens(token.tokens)
        );
        break;
      }
      case 'image':
        child = <span>{token.text}</span>;
        break;
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
export function C6TeachingReading({ text }: { readonly text: string }) {
  const tokens = useMemo(() => markdown.lexer(text), [text]);
  return <article className="c6-teaching-reading">{renderTokens(tokens)}</article>;
}
