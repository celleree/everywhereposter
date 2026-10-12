const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const Uppy = require('@uppy/core').default;
const XHRUpload = require('@uppy/xhr-upload').default;

// Run the real installed Uppy transport with an inert XMLHttpRequest, never a server.
const requests = [];
class TestXHR {
  constructor() { this.upload = {}; this.status = 0; this.responseType = ''; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader() {}
  send() { requests.push(this); }
  abort() { this.aborted = true; }
  progress() { this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 }); }
  respond(status, body) {
    this.status = status;
    this.statusText = status === 413 ? 'Content Too Large' : 'OK';
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload();
  }
}
global.XMLHttpRequest = TestXHR;
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function load(relative, mocks) {
  const filename = path.resolve(__dirname, '../..', relative);
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => id in mocks ? mocks[id] : require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const helper = load('libraries/react-shared-libraries/src/helpers/uppy.upload.ts', {
  '@uppy/xhr-upload': XHRUpload,
  '@uppy/aws-s3': class {},
  '@uppy/transloadit': class {},
});
function harness() {
  requests.length = 0;
  const state = { loading: false, locked: false, issues: [], successes: [] };
  const hook = load('apps/frontend/src/components/media/new.uploader.tsx', {
    react: { useMemo: fn => fn(), useRef: value => ({ current: value }) },
    '@uppy/core': Uppy,
    '@uppy/react': {},
    '@uppy/compressor': class {},
    '@gitroom/react/helpers/uppy.upload': helper,
    '@gitroom/helpers/utils/custom.fetch': { useFetch: () => () => assert.fail('Unexpected API fetch') },
    '@gitroom/react/helpers/variable.context': { useVariables: () => ({ storageProvider: 'local', backendUrl: '/api', disableImageCompression: true, transloadit: [] }) },
    '@gitroom/react/translation/get.transation.service.client': {},
    '@gitroom/react/toaster/toaster': { useToaster: () => ({ show() {} }) },
    '@gitroom/frontend/components/new-launch/store': { useLaunchStore: () => locked => state.locked = locked },
    '@gitroom/frontend/components/media/structural.upload.file.type': { resolveStructurallyValidatedUploadFileType: async file => file.type },
  }).useUppyUploader;
  const uppy = hook({ allowedFileTypes: 'video/mp4,video/quicktime,video/mov',
    onStart: () => state.loading = true, onEnd: () => state.loading = false,
    onUploadIssue: message => state.issues.push(message),
    onUploadSuccess: media => state.successes.push(media),
  });
  const add = name => uppy.addFile({ name, type: name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4', data: new Blob(['fixture']) });
  return { uppy, state, add };
}

test('100% without a response releases controls, retains the file, and accepts late success once', async () => {
  const { uppy, state, add } = harness();
  uppy.getPlugin('XHRUpload').setOptions({ timeout: 20 }); // Test clock only.
  const id = add('iphone.mov');
  await tick();
  const xhr = requests[0];
  xhr.progress();
  // The default Uppy progress timer is advisory, not a failure deadline.
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(uppy.getFile(id).progress.percentage, 100);
  assert.equal(state.loading, false);
  assert.equal(state.locked, false);
  assert.match(state.issues.at(-1), /may still finish/);
  assert.equal(xhr.aborted, undefined);
  assert.equal(requests.length, 1);
  assert.deepEqual(state.successes, []);
  let result;
  uppy.on('complete', value => result = value);
  xhr.respond(201, { id: 'saved-media', path: '/uploads/fixture.mov' });
  await tick();
  assert.equal(state.successes.length, 1);
  assert.equal(state.successes[0][0].id, 'saved-media');
  uppy.emit('complete', result);
  await tick();
  assert.equal(state.successes.length, 1);
  assert.equal(requests.length, 1);
  uppy.destroy();
});

for (const failure of ['413 HTML', 'connection interruption']) {
  test(`${failure} preserves failed selections and never retries them when adding another file`, async () => {
    const { uppy, state, add } = harness();
    const id = add('source.mp4');
    await tick();
    if (failure === '413 HTML') requests[0].respond(413, '<html>Content Too Large</html>');
    else requests[0].onerror();
    await tick();
    assert.equal(state.loading, false);
    assert.equal(state.locked, false);
    assert.ok(uppy.getFile(id).data);
    assert.match(state.issues.at(-1), failure === '413 HTML' ? /too large.*smaller/ : /Check Media Library/);
    assert.deepEqual(state.successes, []);
    // Both caller APIs must recover when the retained file is reselected.
    state.loading = true;
    assert.throws(() => add('source.mp4'), /duplicate/i);
    assert.equal(state.loading, false);
    state.loading = true;
    uppy.addFiles([{ name: 'source.mp4', type: 'video/mp4', data: new Blob(['fixture']) }]);
    assert.equal(state.loading, false);
    assert.ok(uppy.getFile(id).data);
    assert.equal(requests.length, 1);
    add('another.mp4');
    await tick();
    assert.equal(requests.length, 2);
    requests[1].respond(201, { id: 'another-media', path: '/uploads/another.mp4' });
    await tick();
    assert.equal(state.successes.length, 1);
    assert.equal(state.successes[0][0].id, 'another-media');
    assert.ok(uppy.getFile(id).data);
    assert.equal(state.loading, false);
    assert.equal(requests.length, 2);
    uppy.destroy();
  });
}


test('a stale completion cannot attach an old response to a newly selected file with the same ID', async () => {
  const { uppy, state, add } = harness();
  add('same.mp4');
  await tick();
  let oldResult;
  uppy.on('complete', result => oldResult ||= result);
  requests[0].respond(201, { id: 'first-media', path: '/uploads/first.mp4' });
  await tick();
  add('same.mp4');
  await tick();
  uppy.emit('complete', oldResult);
  await tick();
  assert.equal(state.successes.length, 1);
  assert.equal(state.loading, true);
  requests[1].respond(201, { id: 'second-media', path: '/uploads/second.mp4' });
  await tick();
  assert.deepEqual(state.successes.flat().map(media => media.id), ['first-media', 'second-media']);
  uppy.destroy();
});
