import assert from 'node:assert/strict';
import test from 'node:test';
import {
  articlePlainText, articleVideoSource, emptyArticleDoc, legacyArticleDoc,
  readArticleContent, safeArticleUrl, validateArticleDoc, validateArticleInput,
} from '../lib/articleContent.ts';
import { articleImageType, MAX_ARTICLE_IMAGE_BYTES } from '../lib/articleUploads.ts';

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

test('drafts allow unfinished title and body, while publication requires both', () => {
  const draft = validateArticleInput({ titleDoc: emptyArticleDoc(), bodyDoc: emptyArticleDoc() });
  assert.equal(draft.title, 'Untitled article');
  assert.equal(draft.published, false);
  assert.throws(() => validateArticleInput({ titleDoc: emptyArticleDoc(), bodyDoc: doc('Text'), published: true }), /title/);
  assert.throws(() => validateArticleInput({ titleDoc: doc('Title'), bodyDoc: emptyArticleDoc(), published: true }), /content/);
  assert.throws(() => validateArticleInput({ published: 'false' }), /status/);
});

test('rich titles, inline images, videos and formatting survive serialization', () => {
  const titleDoc = doc('A final to remember');
  titleDoc.content[0].attrs = { textAlign: 'center' };
  titleDoc.content[0].content[0].marks = [{ type: 'bold' }, { type: 'italic' }];
  const bodyDoc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Highlights' }] },
    { type: 'image', attrs: { src: 'https://example.com/image.png', alt: 'Final court' } },
    { type: 'articleVideo', attrs: { src: 'https://youtu.be/dQw4w9WgXcQ' } },
  ] };
  const input = validateArticleInput({ titleDoc, bodyDoc, coverUrl: 'https://example.com/cover.jpg', published: true });
  assert.equal(input.title, 'A final to remember');
  const saved = readArticleContent(input.body);
  assert.deepEqual(saved.titleDoc, titleDoc);
  assert.equal(saved.bodyDoc.content[1].attrs.alt, 'Final court');
  assert.equal(saved.bodyDoc.content[2].attrs.src, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(input.coverUrl, 'https://example.com/cover.jpg');
});

test('legacy articles remain readable and editable without losing bold or links', () => {
  assert.equal(readArticleContent('Old article body.'), null);
  const converted = legacyArticleDoc('**Final** with [highlights](https://example.com/video)\nSecond paragraph');
  assert.equal(articlePlainText(converted), 'Final with highlights\nSecond paragraph');
  assert.equal(converted.content[0].content[0].marks[0].type, 'bold');
  assert.equal(converted.content[0].content[2].marks[0].attrs.href, 'https://example.com/video');
  assert.equal(validateArticleInput({ title: 'Legacy', body: '**Bold**' }).title, 'Legacy');
});

test('unsafe links, images, video URLs and unsupported HTML-like nodes are rejected', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://user:pass@example.com']) {
    assert.equal(safeArticleUrl(bad), null);
    assert.throws(() => validateArticleDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: bad } }] }), /URL/);
    const linked = doc('Click');
    linked.content[0].content[0].marks = [{ type: 'link', attrs: { href: bad } }];
    assert.throws(() => validateArticleDoc(linked), /URL/);
  }
  assert.throws(() => validateArticleDoc({ type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] }), /formatting/);
  const image = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/a.png', onerror: 'alert(1)', style: 'bad' } }] };
  assert.deepEqual(validateArticleDoc(image).content[0].attrs, { src: 'https://example.com/a.png', alt: '', title: null });
  assert.throws(() => validateArticleDoc(image, true), /Titles/);
});

test('video embeds are provider-allowlisted and arbitrary sites are links only', () => {
  assert.deepEqual(articleVideoSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
    kind: 'embed', url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  });
  assert.deepEqual(articleVideoSource('https://vimeo.com/123456'), { kind: 'embed', url: 'https://player.vimeo.com/video/123456' });
  assert.equal(articleVideoSource('https://example.com/highlight.mp4').kind, 'file');
  assert.equal(articleVideoSource('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ').kind, 'link');
  assert.equal(articleVideoSource('javascript:alert(1)'), null);
});

test('excessively large or nested article documents are rejected', () => {
  assert.throws(() => validateArticleDoc(doc('x'.repeat(251)), true), /Title/);
  let nested = { type: 'paragraph' };
  for (let i = 0; i < 25; i++) nested = { type: 'blockquote', content: [nested] };
  assert.throws(() => validateArticleDoc({ type: 'doc', content: [nested] }), /complex/);
  assert.throws(() => validateArticleInput({ excerpt: 'x'.repeat(1001) }), /Excerpt/);
});

test('uploads enforce actual image signatures rather than filenames or declared types', () => {
  assert.equal(articleImageType(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(articleImageType(Uint8Array.from([255, 216, 255, 1])), 'image/jpeg');
  assert.equal(articleImageType(new TextEncoder().encode('GIF89a123456')), 'image/gif');
  assert.equal(articleImageType(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp');
  assert.equal(articleImageType(new TextEncoder().encode('<svg onload="alert(1)">')), null);
  assert.equal(MAX_ARTICLE_IMAGE_BYTES, 4 * 1024 * 1024);
});
