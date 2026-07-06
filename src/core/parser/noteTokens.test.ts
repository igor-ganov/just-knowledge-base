import { describe, expect, test } from 'bun:test';
import { idLinkFor, parseTags, parseWikiLinks } from './noteTokens';

describe('wiki-link parsing (AC-3.5, AC-3.2)', () => {
  test('parses id-form links produced by autocomplete', () => {
    const id = '01234567-89ab-4cde-8f01-23456789abcd';
    const links = parseWikiLinks(`see ${idLinkFor(id, 'My Note')} for details`);
    expect(links).toEqual([
      { kind: 'id', noteId: id, label: 'My Note', raw: `[[${id}|My Note]]` },
    ]);
  });

  test('parses title-form links typed by hand', () => {
    const links = parseWikiLinks('see [[Some Note]] and [[Другая заметка]]');
    expect(links.map((link) => (link.kind === 'title' ? link.title : ''))).toEqual([
      'Some Note',
      'Другая заметка',
    ]);
  });

  test('handles multiple links and ignores malformed ones', () => {
    const links = parseWikiLinks('[[A]] middle [[B]] and [[ ]] not [[');
    expect(links).toHaveLength(3);
  });
});

describe('tag parsing (AC-4.1)', () => {
  test('extracts unicode tags, lowercased and deduplicated', () => {
    expect(parseTags('#Alpha text #beta #Alpha #русский-тег')).toEqual([
      'alpha',
      'beta',
      'русский-тег',
    ]);
  });

  test('does not treat mid-word hashes or headings as tags', () => {
    expect(parseTags('foo#bar')).toEqual([]);
    expect(parseTags('# Heading')).toEqual([]);
  });
});
