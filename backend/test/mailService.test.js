import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mailService } from '../src/services/mailService.js';

const MAIL_TYPES = ['support-ticket', 'password-reset', 'test'];
const FORBIDDEN_LOGO_REFERENCES = [
  'localhost',
  '/assets',
  '/logo.svg',
  'logo.svg',
  'src="/',
  'src="./',
  'src="../',
];

test('mail previews use the shared CID logo attachment', () => {
  for (const type of MAIL_TYPES) {
    const preview = mailService.previewTemplate(type, {
      resetLink: 'https://shelfiolabs.com/musteri/sifre-sifirla?token=test-token',
    });

    assert.match(preview.html, /src="cid:shelfio-logo"/);
    assert.equal(preview.attachments.length, 1);
    assert.equal(preview.attachments[0].cid, 'shelfio-logo');
    assert.equal(preview.attachments[0].filename, 'shelfio-logo.png');
    assert.equal(preview.attachments[0].contentType, 'image/png');
    assert.equal(preview.attachments[0].contentDisposition, 'inline');
    assert.equal(path.normalize(preview.attachments[0].path).endsWith(path.normalize('backend/public/mail/shelfio-logo.png')), true);
  }
});

test('mail HTML does not use frontend, localhost, SVG, or relative logo paths', () => {
  for (const type of MAIL_TYPES) {
    const preview = mailService.previewTemplate(type, {
      resetLink: 'https://shelfiolabs.com/musteri/sifre-sifirla?token=test-token',
    });

    for (const forbidden of FORBIDDEN_LOGO_REFERENCES) {
      assert.equal(preview.html.includes(forbidden), false, `${type} contains ${forbidden}`);
    }
  }
});
