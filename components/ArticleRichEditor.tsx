'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Node, mergeAttributes, type ChainedCommands } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code2, ImagePlus,
  Italic, Link2, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2, Video,
} from 'lucide-react';
import type { ArticleDoc } from '@/lib/articleContent';
import { safeArticleUrl } from '@/lib/articleContent';

type Props = {
  mode: 'title' | 'body';
  value: ArticleDoc;
  onChange: (doc: ArticleDoc) => void;
  label: string;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
};

const ArticleVideo = Node.create({
  name: 'articleVideo',
  group: 'block',
  atom: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-article-video]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-article-video': '' }), 'Video attachment'];
  },
});

function normalizedJson(value: unknown): string {
  const clean = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(clean);
    if (!item || typeof item !== 'object') return item;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) {
      if (child == null) continue;
      const next = clean(child);
      if (key === 'attrs' && next && typeof next === 'object' && !Object.keys(next).length) continue;
      output[key] = next;
    }
    return output;
  };
  return JSON.stringify(clean(value));
}

export default function ArticleRichEditor({ mode, value, onChange, label, disabled = false, onUploadingChange }: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [mediaStatus, setMediaStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const isTitle = mode === 'title';
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: isTitle ? false : undefined,
      bulletList: isTitle ? false : undefined,
      orderedList: isTitle ? false : undefined,
      listItem: isTitle ? false : undefined,
      blockquote: isTitle ? false : undefined,
      codeBlock: isTitle ? false : undefined,
      horizontalRule: isTitle ? false : undefined,
      link: { openOnClick: false },
      underline: {},
    }),
    TextAlign.configure({ types: isTitle ? ['paragraph'] : ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder: isTitle ? 'A headline worth opening…' : 'Start with the moment that changed the match…' }),
    ...(!isTitle ? [Image.configure({ inline: false, allowBase64: false }), ArticleVideo] : []),
  ], [isTitle]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    content: value,
    extensions,
    editorProps: { attributes: { 'aria-label': label, 'aria-multiline': 'true' } },
    onUpdate: ({ editor: active }) => onChange(active.getJSON() as ArticleDoc),
  });
  useEffect(() => {
    if (editor && normalizedJson(editor.getJSON()) !== normalizedJson(value)) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  function command(action: (chain: ChainedCommands) => void) {
    if (!editor || disabled) return;
    action(editor.chain().focus());
  }
  function insertLink() {
    if (!editor || disabled) return;
    const current = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Paste an HTTP or HTTPS link, or leave blank to remove the link', current || 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setMediaStatus('Link removed.');
      return;
    }
    if (!safeArticleUrl(url.trim())) {
      setMediaStatus('Use a valid HTTP or HTTPS link.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    setMediaStatus('Link added.');
  }
  async function uploadImage(file: File) {
    if (uploading || disabled) return;
    if (file.size > 4 * 1024 * 1024) {
      setMediaStatus('Images must be 4 MB or smaller.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setMediaStatus('Choose a JPG, PNG, GIF or WebP image.');
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    setMediaStatus('Uploading image…');
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/articles/images', { method: 'POST', body: form, credentials: 'include' });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Image upload failed.');
      if (editor) editor.chain().focus().insertContentAt(editor.state.selection.to, [
        { type: 'image', attrs: { src: result.url, alt: result.name || file.name } },
        { type: 'paragraph' },
      ]).run();
      setMediaStatus('Image uploaded and inserted.');
    } catch (error) {
      setMediaStatus(error instanceof Error ? error.message : 'Image upload failed.');
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }
  function insertImageUrl() {
    const src = window.prompt('Paste an image URL (HTTP or HTTPS)');
    if (!src || !editor) return;
    if (!safeArticleUrl(src.trim())) {
      setMediaStatus('Use a valid HTTP or HTTPS image URL.');
      return;
    }
    editor.chain().focus().insertContentAt(editor.state.selection.to, [
      { type: 'image', attrs: { src: src.trim() } }, { type: 'paragraph' },
    ]).run();
    setMediaStatus('Image added.');
  }
  function insertVideo() {
    const src = window.prompt('Paste a video URL (YouTube, Vimeo or direct video file)');
    if (!src || !editor) return;
    if (!safeArticleUrl(src.trim())) {
      setMediaStatus('Use a valid HTTP or HTTPS video URL.');
      return;
    }
    editor.chain().focus().insertContentAt(editor.state.selection.to, [
      { type: 'articleVideo', attrs: { src: src.trim() } }, { type: 'paragraph' },
    ]).run();
    setMediaStatus('Video added.');
  }

  if (!editor) return <div className="article-editor-shell" aria-busy="true"><div className="article-editor-loading">Preparing {label.toLowerCase()} editor…</div></div>;
  const tool = (name: string, title: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button key={name} type="button" aria-label={title} title={title} aria-pressed={active} disabled={disabled || uploading} onClick={run}>{icon}</button>
  );
  const align = (value: string) => command(chain => chain.setTextAlign(value).run());
  return (
    <div className="article-editor-wrap">
      <div className="article-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        {tool('bold', 'Bold', <Bold size={16} />, () => command(chain => chain.toggleBold().run()), editor.isActive('bold'))}
        {tool('italic', 'Italic', <Italic size={16} />, () => command(chain => chain.toggleItalic().run()), editor.isActive('italic'))}
        {tool('underline', 'Underline', <Underline size={16} />, () => command(chain => chain.toggleUnderline().run()), editor.isActive('underline'))}
        {tool('strike', 'Strikethrough', <Strikethrough size={16} />, () => command(chain => chain.toggleStrike().run()), editor.isActive('strike'))}
        {isTitle ? null : <>
          <label className="article-heading-select" aria-label="Block style"><ChevronDown size={13} /><select value={editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'} disabled={disabled} onChange={e => e.target.value === 'p' ? command(chain => chain.setParagraph().run()) : command(chain => chain.toggleHeading({ level: Number(e.target.value.slice(1)) as 2 | 3 }).run())}>
            <option value="p">Paragraph</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
          </select></label>
          {tool('bullet', 'Bulleted list', <List size={16} />, () => command(chain => chain.toggleBulletList().run()), editor.isActive('bulletList'))}
          {tool('ordered', 'Numbered list', <ListOrdered size={16} />, () => command(chain => chain.toggleOrderedList().run()), editor.isActive('orderedList'))}
          {tool('quote', 'Blockquote', <span aria-hidden="true">“ ”</span>, () => command(chain => chain.toggleBlockquote().run()), editor.isActive('blockquote'))}
          {tool('code', 'Code block', <Code2 size={16} />, () => command(chain => chain.toggleCodeBlock().run()), editor.isActive('codeBlock'))}
        </>}
        {tool('link', 'Add or edit link', <Link2 size={16} />, insertLink, editor.isActive('link'))}
        {tool('left', 'Align left', <AlignLeft size={16} />, () => align('left'), editor.isActive({ textAlign: 'left' }))}
        {tool('center', 'Align center', <AlignCenter size={16} />, () => align('center'), editor.isActive({ textAlign: 'center' }))}
        {tool('right', 'Align right', <AlignRight size={16} />, () => align('right'), editor.isActive({ textAlign: 'right' }))}
        {!isTitle && tool('justify', 'Justify text', <AlignJustify size={16} />, () => align('justify'), editor.isActive({ textAlign: 'justify' }))}
        {!isTitle && <>
          {tool('image-upload', 'Upload image file', <ImagePlus size={16} />, () => imageInput.current?.click())}
          {tool('image-url', 'Insert image from URL', <span aria-hidden="true">IMG</span>, insertImageUrl)}
          {tool('video', 'Insert video URL', <Video size={16} />, insertVideo)}
        </>}
        {tool('undo', 'Undo', <Undo2 size={16} />, () => command(chain => chain.undo().run()))}
        {tool('redo', 'Redo', <Redo2 size={16} />, () => command(chain => chain.redo().run()))}
        {!isTitle && <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden aria-label="Choose image file" onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void uploadImage(file); e.currentTarget.value = ''; }} />}
      </div>
      <div className={`article-editor-shell ${isTitle ? 'title-editor' : ''}`} aria-label={label}>
        <EditorContent editor={editor} />
      </div>
      {(mediaStatus || !isTitle) && <div className="article-toolbar-note" role="status" aria-live="polite">{mediaStatus || 'Images up to 4 MB · JPG, PNG, GIF or WebP · video URLs are kept as entered.'}</div>}
    </div>
  );
}
