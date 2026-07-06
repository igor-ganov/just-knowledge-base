import { describe, expect, test } from 'bun:test';
import { renderMarkdown, type ResolveLink } from './render';

const noResolve: ResolveLink = () => undefined;
const resolveAll: ResolveLink = () => ({ noteId: 'resolved-id' });

describe('markdown rendering (AC-2.3)', () => {
  test('renders headings, emphasis, lists, code blocks, links', () => {
    const html = renderMarkdown(
      ['# Title', '', 'some **bold** and *italic* and `code`', '- one', '- two', '1. first', '```', 'raw <code>', '```', '[ext](https://example.com)'].join('\n'),
      noResolve,
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li></ol>');
    expect(html).toContain('<pre><code>raw &lt;code&gt;</code></pre>');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer" target="_blank">ext</a>');
  });

  test('escapes HTML — no script injection (security)', () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=y>', noResolve);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  test('renders resolved wiki-links as navigation (AC-3.1)', () => {
    const html = renderMarkdown('see [[Target Note]]', resolveAll);
    expect(html).toContain('href="#/note/resolved-id"');
    expect(html).toContain('>Target Note</a>');
  });

  test('renders unresolved wiki-links distinctly (AC-3.2)', () => {
    const html = renderMarkdown('see [[No Such Note]]', noResolve);
    expect(html).toContain('wiki-link--unresolved');
    expect(html).toContain('data-create-title="No Such Note"');
  });

  test('renders tags as tag navigation (AC-4.2)', () => {
    const html = renderMarkdown('text #mytag more', noResolve);
    expect(html).toContain('href="#/tag/mytag"');
  });
});
