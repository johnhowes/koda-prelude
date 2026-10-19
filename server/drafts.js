// Drafts (prelude/design-workspace, R-d3v): each session's unsent message,
// its words and its images, kept until it's sent, so a reload, or another
// session and back, finds it as it was left. A design with no session yet
// has one draft too, under "new".
//
// A draft is the person's, on this machine, like the rest of <home>: nothing
// unsent is committed with the design. Sending moves its images into the
// session's folder (prelude/<design>/sessions/<id>/images/), so they stay with
// the session and the agent can read them.
//
//   <home>/drafts/<folder>/<design>/<session or new>/
//     draft.json     { message, attachments: [{ id, name, type, file }] }
//     <id>.<ext>     each image, as uploaded

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRELUDE_DIR } from './designs.js';
import { isSessionId, listSessions, readEntries, sessionsDir } from './sessions.js';

/** Only images can be attached (R-m2s): known by their first bytes, not their name. */
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const MAX_IMAGE = 20 * 1024 * 1024;

export function imageType(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const newImageId = () => `img-${[...randomBytes(4)].map(byte => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('')}`;
const isImageId = id => /^img-[a-z0-9]{4,12}$/.test(String(id));
const safeName = name => String(name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim().slice(0, 120) || 'image';

/**
 * Where a sent image is, from the path the transcript keeps
 * (prelude/<design>/sessions/…): under the design's own folder, which for a
 * conversation kept on this computer isn't in the project (prelude/fix-something).
 */
export function sentFile(folder, design, designDir, file) {
  const prefix = `${PRELUDE_DIR}/${design.id}/`;
  return file.startsWith(prefix) ? join(designDir, ...file.slice(prefix.length).split('/')) : join(folder.path, ...file.split('/'));
}

/** A session's key in the drafts: its id, or "new" before it starts. */
export const draftKey = sessionId => (sessionId && isSessionId(sessionId) ? sessionId : 'new');

export function createDrafts({ home }) {
  const dirOf = (folder, design, sessionId) =>
    join(home, 'drafts', folder.id, design.id.split('/').join('~'), draftKey(sessionId));

  const read = (folder, design, sessionId) => {
    try {
      const saved = JSON.parse(readFileSync(join(dirOf(folder, design, sessionId), 'draft.json'), 'utf8'));
      return {
        message: typeof saved.message === 'string' ? saved.message : '',
        attachments: Array.isArray(saved.attachments) ? saved.attachments.filter(a => a && isImageId(a.id)) : [],
      };
    } catch {
      return { message: '', attachments: [] };
    }
  };

  const write = (folder, design, sessionId, draft) => {
    const dir = dirOf(folder, design, sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'draft.json'), JSON.stringify(draft, null, 2) + '\n');
    return draft;
  };

  return {
    read,

    /** Keep what's typed. */
    setMessage(folder, design, sessionId, message) {
      return write(folder, design, sessionId, { ...read(folder, design, sessionId), message: String(message ?? '') });
    },

    /**
     * Add an image to the draft: { attachment } or { error }. Anything that
     * isn't a PNG, JPEG, GIF or WebP is refused and changes nothing. With
     * `replacing`, it takes that image's place, if that one is in the draft.
     */
    addImage(folder, design, sessionId, { name, bytes }, { replacing = null } = {}) {
      const type = imageType(bytes);
      if (!type) return { error: 'Only images can be attached: PNG, JPEG, GIF or WebP.' };
      if (bytes.length > MAX_IMAGE) return { error: 'That image is larger than 20 MB.' };
      const id = newImageId();
      const file = `${id}.${IMAGE_TYPES[type]}`;
      const dir = dirOf(folder, design, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), bytes);
      const attachment = { id, name: safeName(name), type, file };
      const draft = read(folder, design, sessionId);
      const at = replacing ? draft.attachments.findIndex(a => a.id === replacing) : -1;
      if (at >= 0) draft.attachments.splice(at, 1, attachment);
      else draft.attachments.push(attachment);
      write(folder, design, sessionId, draft);
      return { attachment };
    },

    /** Take an image out of the draft (its file goes too). */
    remove(folder, design, sessionId, imageId) {
      const draft = read(folder, design, sessionId);
      const gone = draft.attachments.find(a => a.id === imageId);
      if (!gone) return draft;
      rmSync(join(dirOf(folder, design, sessionId), gone.file), { force: true });
      return write(folder, design, sessionId, { ...draft, attachments: draft.attachments.filter(a => a !== gone) });
    },

    /**
     * Send the draft: the posted images that are in it move into the
     * session's folder, and the draft empties. Returns the images as the
     * transcript keeps them: [{ id, name, file }] (file: in the repository).
     */
    send(folder, design, designDir, fromSessionId, toSessionId, ids) {
      const dir = dirOf(folder, design, fromSessionId);
      const draft = read(folder, design, fromSessionId);
      const wanted = ids.map(String).filter((id, i, all) => all.indexOf(id) === i);
      const images = [];
      const target = join(sessionsDir(designDir), toSessionId, 'images');
      for (const id of wanted) {
        const attachment = draft.attachments.find(a => a.id === id);
        if (!attachment || !existsSync(join(dir, attachment.file))) continue;
        mkdirSync(target, { recursive: true });
        const ext = attachment.file.split('.').pop();
        const name = safeName(attachment.name.replace(/\.[^.]+$/, ''));
        const file = `${id}-${name}.${ext}`;
        copyFileSync(join(dir, attachment.file), join(target, file));
        images.push({ id, name: attachment.name, file: `${PRELUDE_DIR}/${design.id}/sessions/${toSessionId}/images/${file}` });
      }
      rmSync(dir, { recursive: true, force: true });
      return images;
    },

    /**
     * Put messages back in the box (Stop, R-9cn): their words after what's
     * there, and their images, moved back out of the session's folder.
     * images: [{ id, name, path }]
     */
    restore(folder, design, sessionId, { message, images = [] }) {
      const draft = read(folder, design, sessionId);
      const typed = draft.message.trim();
      const attachments = [...draft.attachments];
      for (const image of images) {
        if (attachments.some(a => a.id === image.id)) continue;
        const bytes = (() => { try { return readFileSync(image.path); } catch { return null; } })();
        const type = bytes && imageType(bytes);
        if (!type) continue;
        const file = `${image.id}.${IMAGE_TYPES[type]}`;
        mkdirSync(dirOf(folder, design, sessionId), { recursive: true });
        writeFileSync(join(dirOf(folder, design, sessionId), file), bytes);
        rmSync(image.path, { force: true });
        attachments.push({ id: image.id, name: image.name, type, file });
      }
      return write(folder, design, sessionId, { message: [typed, message].filter(Boolean).join('\n\n'), attachments });
    },

    /**
     * Move a design's drafts to another design or folder: a conversation
     * started from the new one's page, or fixed on its branch (prelude/fix-something).
     */
    move(fromFolder, fromDesign, toFolder, toDesign) {
      const from = join(home, 'drafts', fromFolder.id, fromDesign.id.split('/').join('~'));
      const to = join(home, 'drafts', toFolder.id, toDesign.id.split('/').join('~'));
      if (!existsSync(from) || existsSync(to)) return;
      mkdirSync(join(home, 'drafts', toFolder.id), { recursive: true });
      renameSync(from, to);
    },

    /** An image's file in a draft, for queuing: { id, name, path }. */
    pathOf(folder, design, sessionId, imageId) {
      const attachment = read(folder, design, sessionId).attachments.find(a => a.id === imageId);
      return attachment ? { id: attachment.id, name: attachment.name, path: join(dirOf(folder, design, sessionId), attachment.file) } : null;
    },

    /**
     * An image by its id, wherever it is: waiting in a draft of this design,
     * or sent in one of its sessions. { id, name, type, path, sent, draft }
     * (sent: when; draft: the session whose draft holds it), or null.
     */
    find(folder, design, designDir, imageId) {
      if (!isImageId(imageId)) return null;
      const root = join(home, 'drafts', folder.id, design.id.split('/').join('~'));
      let keys = [];
      try { keys = readdirSync(root); } catch { /* no drafts */ }
      for (const key of keys) {
        const attachment = read(folder, design, key === 'new' ? null : key).attachments.find(a => a.id === imageId);
        if (attachment) return { id: imageId, name: attachment.name, type: attachment.type, path: join(root, key, attachment.file), sent: null, draft: key };
      }
      for (const session of listSessions(designDir)) {
        const entry = readEntries(designDir, session.id).find(e => e.type === 'user' && e.images?.some(image => image.id === imageId));
        const image = entry?.images.find(candidate => candidate.id === imageId);
        if (!image) continue;
        const path = sentFile(folder, design, designDir, image.file);
        let type = null;
        try { type = imageType(readFileSync(path).subarray(0, 16)); } catch { continue; }
        return { id: imageId, name: image.name, type, path, sent: entry.at, draft: null };
      }
      return null;
    },
  };
}
