'use strict';

/**
 * Minimal MHTML (.mhtml / MIME multipart) -> HTML extractor.
 *
 * Chrome's "Save as > Web Page, Single File" produces a multipart/related MIME
 * archive. We only need the primary text/html part. Chromium sandboxes MHTML
 * documents (blocking executeJavaScript), so we decode the HTML part ourselves
 * and hand plain HTML to the browser instead.
 *
 * @param {Buffer|string} raw
 * @returns {string} the decoded HTML of the root document
 */
function mhtmlToHtml(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('binary') : raw;

  // Top-level boundary from the MIME headers.
  const boundaryMatch = text.match(/boundary="?([^"\r\n]+)"?/i);
  if (!boundaryMatch) {
    // Not multipart — maybe it's already HTML.
    return text;
  }
  const boundary = '--' + boundaryMatch[1];
  const parts = text.split(boundary);

  let best = null;
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n') >= 0 ? part.indexOf('\r\n\r\n') + 4
      : part.indexOf('\n\n') >= 0 ? part.indexOf('\n\n') + 2 : -1;
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd).toLowerCase();
    if (!headers.includes('text/html')) continue;

    let body = part.slice(headerEnd);
    // Trim trailing boundary terminator / whitespace.
    body = body.replace(/\r\n--\s*$/, '').replace(/\s+$/, '');

    const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/) || [])[1] || '';
    if (enc.includes('quoted-printable')) {
      body = decodeQuotedPrintable(body);
    } else if (enc.includes('base64')) {
      body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    // Prefer the largest html part (the root document, not an embedded frame).
    if (!best || body.length > best.length) best = body;
  }

  if (best == null) throw new Error('no text/html part found in MHTML');
  return best;
}

/** Decode quoted-printable, handling soft line breaks and UTF-8 =XX sequences. */
function decodeQuotedPrintable(input) {
  // Soft line breaks: "=" at end of line.
  const unfolded = input.replace(/=\r?\n/g, '');
  // Collect =XX bytes into a byte array so multi-byte UTF-8 decodes correctly.
  const bytes = [];
  for (let i = 0; i < unfolded.length; i++) {
    const ch = unfolded[i];
    if (ch === '=' && i + 2 < unfolded.length && /[0-9A-Fa-f]{2}/.test(unfolded.substr(i + 1, 2))) {
      bytes.push(parseInt(unfolded.substr(i + 1, 2), 16));
      i += 2;
    } else {
      // Push the raw byte(s) of this character.
      const buf = Buffer.from(ch, 'binary');
      for (const b of buf) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

module.exports = { mhtmlToHtml, decodeQuotedPrintable };
