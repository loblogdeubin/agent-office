import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImage, attachImage } from '../extensions/chatgpt-relay/attachments.js';

const image = { name: 'sample.png', type: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64') };
const nonce = '12345678-1234-1234-1234-123456789012';

test('local image attachment accepts supported signatures, not SVG, empty or oversized data', () => {
  assert.equal(validateImage(image).name, 'sample.png');
  for (const bad of [{ ...image, type: 'image/svg+xml' }, { ...image, data: '' }, { ...image, data: 'YWJj' }, { ...image, data: 'a'.repeat(7000000) }]) {
    assert.throws(() => validateImage(bad));
  }
});

test('image joins only its explicit Send request, and the private marker is removed', () => {
  const staged = { nonce, image };
  assert.equal(attachImage({ prompt: 'normal text' }, staged).images, undefined);
  const request = attachImage({ prompt: `[cosmo-image:${nonce}]\nWhat color?` }, staged);
  assert.equal(request.prompt, 'What color?');
  assert.deepEqual(request.images, [image]);
  assert.throws(() => attachImage({ prompt: `[cosmo-image:${nonce}]\nWhat color?` }, undefined));
  assert.throws(() => attachImage({ prompt: `[cosmo-image:${nonce}]\n` }, staged));
});
