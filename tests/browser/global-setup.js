const fs = require('node:fs');
const path = require('node:path');

module.exports = async () => {
  const fixtures = path.join(__dirname, 'fixtures');
  for (const name of ['gallery-comments.json', 'review.md.review.json']) {
    fs.rmSync(path.join(fixtures, name), {force: true});
  }
  for (const name of ['shortcut-folder', 'shortcut-folder-2', 'shortcut-folder-3', 'shortcut-folder-4']) {
    fs.rmSync(path.join(fixtures, name), {recursive: true, force: true});
    fs.mkdirSync(path.join(fixtures, name));
  }
  const searchDirectory = path.join(fixtures, 'search-nested');
  fs.rmSync(searchDirectory, {recursive: true, force: true});
  fs.mkdirSync(searchDirectory);
  fs.copyFileSync(path.join(fixtures, '03-square.svg'), path.join(searchDirectory, 'nested-portrait.svg'));
  fs.writeFileSync(path.join(searchDirectory, 'portrait-notes.txt'), 'nested search result\n');
  fs.writeFileSync(path.join(searchDirectory, '.hidden-portrait.txt'), 'hidden file\n');
  for (const parent of ['tiana/bootstrap/caddy', 'other/caddy', 'unrelated']) {
    fs.mkdirSync(path.join(searchDirectory, parent), {recursive: true});
    fs.writeFileSync(path.join(searchDirectory, parent, 'root.crt'), 'certificate fixture\n');
  }
  fs.mkdirSync(path.join(searchDirectory, '.hidden-directory'));
  fs.writeFileSync(path.join(searchDirectory, '.hidden-directory', 'portrait-secret.txt'), 'hidden directory\n');
};
