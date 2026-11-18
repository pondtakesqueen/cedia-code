import { readFileSync, statSync } from 'node:fs';
import { sniffImage, storeImage } from '../images.ts';
import { fileHead, sniffVideo, videoFrames, videoNote } from '../video.ts';
import { clip, MAX_OUTPUT_CHARS, toolPath, type ToolSpec } from './registry.ts';

const MAX_LINES = 2000;
// Read loads a file whole before it picks lines, so a larger one is refused: a multi-GB log would fill memory to
// show 2,000 lines. grep or a ranged shell read gets at it.
export const MAX_READ_BYTES = 50 * 1024 * 1024;

export const readTool: ToolSpec = {
  name: 'read',
  description:
    'Read a text file, look at an image (PNG, JPEG, GIF, WebP), or look at a video (MP4, MOV, WebM, MKV, AVI) as frames where its picture changes. Returns numbered lines: up to 2000 (limit) or about 30,000 characters, whichever comes first, from offset (default 1); the result says the offset to read on from.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory' },
      offset: { type: 'integer', description: '1-based line to start from' },
      limit: { type: 'integer', description: 'Number of lines to read' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  effect: 'read',
  pathOf: (input) => (typeof input.path === 'string' ? input.path : undefined),
  opensFile: true,
  replay: 'safe',
  async run(input, ctx) {
    const path = String(input.path ?? '');
    if (!path) return { text: 'path is required', isError: true };
    const full = toolPath(path, ctx.cwd);
    let bytes: Buffer;
    try {
      const st = statSync(full);
      if (st.isDirectory()) return { text: `${path} is a directory`, isError: true };
      // A device, FIFO or socket never ends (/dev/zero fills memory) or blocks until a writer comes (a FIFO, /dev/stdin),
      // and the session waits with it. Checked before the video sniff, which opens the file too.
      if (!st.isFile()) return { text: `${path} is not a regular file (a device, FIFO or socket), so read cannot open it`, isError: true };
      if (sniffVideo(fileHead(full))) {
        const v = videoFrames(full, path);
        if ('error' in v) return { text: `cannot show ${path}: ${v.error}`, isError: true };
        return { text: videoNote(path, v), isError: false, images: v.frames };
      }
      // A video is read by ffmpeg from the path; anything else is loaded whole.
      if (st.size > MAX_READ_BYTES)
        return { text: `${path} is ${Math.round(st.size / 1024 / 1024)} MB, more than read loads (${MAX_READ_BYTES / 1024 / 1024} MB). Search it with grep, or read a range with a shell command such as sed -n '1,200p'`, isError: true };
      bytes = readFileSync(full);
    } catch (e) {
      return { text: `cannot read ${path}: ${(e as Error).message}`, isError: true };
    }
    if (sniffImage(bytes)) {
      const image = storeImage(bytes, path);
      if ('error' in image) return { text: `cannot show ${path}: ${image.error}`, isError: true };
      return { text: `${path}: ${image.mime.slice(6)} image, ${image.width}x${image.height} px`, isError: false, images: [image] };
    }
    const content = bytes.toString('utf8');
    const lines = content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (!lines.length) return { text: '(empty file)', isError: false };
    // A number sent as a string is taken; anything else that is not a whole number falls back to the default.
    const whole = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.floor(Number(v)) : fallback);
    const start = Math.max(1, whole(input.offset, 1));
    const limit = Math.max(1, Math.min(whole(input.limit, MAX_LINES), MAX_LINES));
    if (start > lines.length) return { text: `${path} has ${lines.length} lines; offset ${start} is past the end`, isError: true };
    // Whole lines from the start, up to the result's budget: a cut in the middle would hide the lines a model most
    // often came for, and the note says where to go on from.
    const shown: string[] = [];
    let size = 0;
    for (const [i, l] of lines.slice(start - 1, start - 1 + limit).entries()) {
      const row = `${String(start + i).padStart(6)}\t${l}`;
      if (shown.length && size + row.length + 1 > MAX_OUTPUT_CHARS) break;
      shown.push(row);
      size += row.length + 1;
    }
    const next = start + shown.length;
    const more = next <= lines.length ? `\n[${lines.length - next + 1} more lines; read on with offset ${next}]` : '';
    return { text: clip(shown.join('\n')) + more, isError: false };
  },
};
