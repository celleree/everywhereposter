import { createContext, runInContext, Script } from 'vm';
import { adaptCookedReviewHtml } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review-html';

const request = '11111111-1111-4111-8111-111111111111', job = '22222222-2222-4222-8222-222222222222';
const fixture = `<head></head><body><div class="left"><div id="stage"></div><div id="txlines"></div></div><script>
fetch('/edits',{method:'POST',body:JSON.stringify(body)});
const txEditable=()=>view.stage==='cut'&&isCur()&&!pending()&&!S.raw&&!!data().transcript;
const noteOk=()=>!!S&&isCur()&&pending()!=='approve'&&!previewOn;
async function load(force){}
load();setInterval(load,3000);
</script><script src="/ask.js"></script></body>`;
const adapted = () => adaptCookedReviewHtml(fixture);
const adapterScript = () => adapted().match(/<script id="ep-review-adapter">([\s\S]*?)<\/script>/)![1];
const receipt = (revision = 0) => ({ requestId: request, jobId: job, revision, status: 'ready', editing: {
  mode: 'quiet-block-v1', wordCuts: false, arbitraryPhrases: false, pauseEdits: false,
  blocks: [[1.123456789, 2.987654321]], removedBlocks: revision ? [[1.123456789, 2.987654321]] : [],
} });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness(initial: any = receipt()) {
  const elements: Record<string, any> = {};
  const element = () => ({ children: [] as any[], hidden: false, disabled: false, textContent: '', setAttribute: jest.fn(), append(...items: any[]) { this.children.push(...items); }, replaceChildren() { this.children = []; } });
  for (const id of ['ep-block-status', 'ep-block-list', 'ep-retry', 'left']) elements[id] = element();
  const events: Record<string, any> = {};
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => initial });
  const state = { revision: 0, busy: false };
  const context = createContext({
    URL, location: { href: 'https://app.test/media/editor/jobs/' + job + '/review?request=' + request, pathname: '/media/editor/jobs/' + job + '/review', origin: 'https://app.test' },
    document: { createElement: element, getElementById: (id: string) => elements[id], querySelector: () => elements.left,
      addEventListener: (name: string, fn: any) => { events[name] = fn; }, body: { getBoundingClientRect: () => ({ height: 742.3 }) } },
    fetch, S: state, isCur: jest.fn(() => true), nativeLoad: jest.fn(async () => undefined), load: () => undefined,
    fmtx: (n: number) => String(n), parent: { postMessage: jest.fn() }, requestAnimationFrame: jest.fn(() => 1), cancelAnimationFrame: jest.fn(),
    queueMicrotask, setInterval: jest.fn(), window: { addEventListener: jest.fn() },
  });
  runInContext(adapterScript(), context);
  return { context, elements, fetch, state, events };
}
describe('Cooked whole-block review adapter', () => {
  it('guards pinned patch anchors, preserves relative URLs and initializes after native globals', () => {
    expect(() => new Script(adapterScript())).not.toThrow();
    expect(adapted()).toContain('const txEditable=()=>false;');
    expect(adapted()).toContain('const noteOk=()=>false;');
    expect(adapted()).toContain("fetch('./edits'");
    expect(adapted()).not.toContain('<script src=');
    expect(adapted().indexOf('id="ep-review-adapter"')).toBeGreaterThan(adapted().indexOf('async function nativeLoad'));
    expect(() => adaptCookedReviewHtml(fixture.replace('async function load(force){', 'async function reload(force){'))).toThrow('UNSUPPORTED_NATIVE_REVIEW');
  });
  it('submits exact receipt ranges once, refreshes the native state and shows restore', async () => {
    const h = harness(); await flush();
    const button = h.elements['ep-block-list'].children[0];
    expect(button.textContent).toContain('Cut block 1');
    let finish!: (value: any) => void;
    h.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = button.onclick(); button.onclick();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ revision: 0, cut: [[1.123456789, 2.987654321]] });
    h.state.revision = 1;
    h.fetch.mockResolvedValueOnce({ ok: true, json: async () => receipt(1) });
    finish({ ok: true, json: async () => ({ event: true, revision: 1 }) });
    await first; await flush();
    expect(h.context.nativeLoad).toHaveBeenCalledTimes(2);
    expect(h.elements['ep-block-list'].children[0].textContent).toContain('Restore block 1');
  });
  it.each([409, 422])('refreshes after rejected %s edits without retrying the mutation', async status => {
    const h = harness(); await flush();
    h.fetch.mockResolvedValueOnce({ ok: false, status });
    await h.elements['ep-block-list'].children[0].onclick();
    expect(h.fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    expect(h.context.nativeLoad).toHaveBeenCalledTimes(2);
    expect(h.elements['ep-block-status'].textContent).toMatch(/revision changed|edit was rejected/);
  });
  it.each([
    { ...receipt(), jobId: 'wrong' }, { ...receipt(), status: 'failed' },
    { ...receipt(), editing: { ...receipt().editing, blocks: [[0, Infinity]] } },
    { ...receipt(), editing: { ...receipt().editing, removedBlocks: [[1, 2]] } },
  ])('fails closed on invalid receipt without replacing the native preview', async bad => {
    const h = harness(bad); await flush();
    expect(h.context.nativeLoad).not.toHaveBeenCalled();
    expect(h.elements['ep-block-list'].children).toHaveLength(0);
    expect(h.elements['ep-retry'].hidden).toBe(false);
    h.fetch.mockResolvedValue({ ok: true, json: async () => receipt() });
    await h.context.load(); expect(h.fetch).toHaveBeenCalledTimes(1);
    await h.elements['ep-retry'].onclick(); await flush();
    expect(h.elements['ep-block-list'].children).toHaveLength(1);
  });
  it('keeps block buttons mounted across receipt refreshes', async () => {
    const h = harness(); await flush();
    const button = h.elements['ep-block-list'].children[0];
    await h.context.load();
    expect(h.elements['ep-block-list'].children[0]).toBe(button);
  });
  it('keeps focusable controls during a receipt read while guarding mutations', async () => {
    const h = harness(); await flush();
    const button = h.elements['ep-block-list'].children[0];
    let finish!: (value: any) => void;
    h.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const loading = h.context.load();
    expect(button.disabled).toBe(false);
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-disabled', 'true');
    await button.onclick();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    finish({ ok: true, json: async () => receipt() }); await loading;
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-disabled', 'false');
  });
  it('leaves focused button keyboard activation to the browser', async () => {
    const h = harness(); await flush();
    const event = { key: ' ', target: { closest: () => true }, stopImmediatePropagation: jest.fn(), preventDefault: jest.fn() };
    h.events.keydown(event);
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('handles no eligible blocks and prevents edits on historic versions', async () => {
    const h = harness({ ...receipt(), editing: { ...receipt().editing, blocks: [] } }); await flush();
    expect(h.elements['ep-block-status'].textContent).toContain('No eligible whole blocks');
    const historic = harness(); await flush();
    historic.context.isCur.mockReturnValue(false); historic.events.click(); await flush();
    expect(historic.elements['ep-block-list'].children[0].disabled).toBe(true);
  });
});
