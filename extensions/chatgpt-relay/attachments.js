export function validateImage(image) {
  if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || typeof image.data !== 'string' || !image.data.length || image.data.length > 6990508 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
    throw new Error('Foto harus PNG, JPG, atau WebP, maksimal 5 MB.');
  }
  const bytes = atob(image.data);
  if (bytes.length > 5 * 1024 * 1024 || !bytes.length) throw new Error('Foto maksimal 5 MB.');
  const signature = image.type === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
    : image.type === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff')
    : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!signature) throw new Error('Isi file tidak cocok dengan format gambar.');
  return { name: String(image.name || 'foto').replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 120), type: image.type, data: image.data };
}

export function attachImage(request, staged) {
  const marker = /\[cosmo-image:([a-f0-9-]{36})\]\n/;
  const m = request.prompt.match(marker);
  if (!m) return request;
  if (!staged || staged.nonce !== m[1]) throw new Error('Lampiran lokal tidak tersedia. Tempel ulang gambar sebelum mengirim.');
  const prompt = request.prompt.replace(m[0], '').trim();
  if (!prompt) throw new Error('Tulis pertanyaan untuk gambar sebelum mengirim.');
  return { ...request, prompt, imageNonce: staged.nonce, images: [validateImage(staged.image)] };
}
