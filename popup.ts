'use strict';
declare const chrome: any;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
type Bottle = { id: string; bin: string };
let rows: Bottle[] = [], completed = new Set<string>(), running = false, source = '';
const log = (message: string) =>
{
  $('log').textContent += message + '\n';
  $('log').scrollTop = $('log').scrollHeight;
};

function parseCsvLine(line: string): string[]
{
  const fields: string[] = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++)
  {
    const c = line[i];
    if (c === '"')
    {
      if (quoted && line[i + 1] === '"')
      {
        value += '"';
        i++;
      }
      else
        quoted = !quoted;
    }
    else if ((c === ',' || c === '\t') && !quoted)
    {
      fields.push(value.trim());
      value = '';
    }
    else
      value += c;
  }
  if (quoted)
    throw Error('Unclosed CSV quote');
  fields.push(value.trim());
  return fields;
}

function validate(text: string): { parsed: Bottle[]; bins: number }
{
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length)
    throw Error('File is empty');
  const first = parseCsvLine(lines[0]);
  const header = first[0]?.toLowerCase() === 'inventoryid' && first[1]?.toLowerCase() === 'bin';
  const data = header ? lines.slice(1) : lines;
  const parsed = data.map(
    (line, i) =>
    {
      const values = parseCsvLine(line), lineNumber = i + (header ? 2 : 1);
      if (values.length !== 2 || !/^\d+$/.test(values[0]) || !/^[A-Za-z0-9 _.-]{1,40}$/.test(values[1]))
        throw Error(`Line ${lineNumber}: expected numeric inventory ID and bin (1–40 letters/numbers/spaces/_.-).`);
      return { id: values[0], bin: values[1] };
    });
  if (!parsed.length)
    throw Error('No bottle rows');
  const ids = new Set<string>(), counts = new Map<string, number>();
  for (const row of parsed)
  {
    if (ids.has(row.id))
      throw Error(`Duplicate inventory ID: ${row.id}`);
    ids.add(row.id);
    counts.set(row.bin, (counts.get(row.bin) || 0) + 1);
  }
  if (($('two') as HTMLInputElement).checked)
  {
    const invalid = [...counts].filter(([, n]) => n !== 2);
    if (invalid.length)
      throw Error(`Bins without exactly two bottles: ${invalid.slice(0, 12).map(([b, n]) => `${b} (${n})`).join(', ')}`);
  }
  return { parsed, bins: counts.size };
}

function refresh()
{
  rows = [];
  completed.clear();
  $('summary').textContent = '';
  $('error').textContent = '';
  ($('test') as HTMLButtonElement).disabled = ($('all') as HTMLButtonElement).disabled = true;
  try
  {
    if (!source)
      return;
    const result = validate(source);
    rows = result.parsed;
    $('summary').textContent = `${rows.length} bottles in ${result.bins} bins. First: ${rows[0].id} → ${rows[0].bin}. Last: ${rows.at(-1)!.id} → ${rows.at(-1)!.bin}.`;
    ($('test') as HTMLButtonElement).disabled = false;
  }
  catch (e)
  {
    $('error').textContent = String(e instanceof Error ? e.message : e);
  }
}

$('csv').addEventListener('input', e => {
  source = ((e.target as HTMLTextAreaElement).value || '');
  $('log').textContent = '';
  $('status').textContent = '';
  refresh();
});
$('two').addEventListener('change', refresh);

async function activeTab()
{
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/www\.cellartracker\.com\//.test(tab.url || ''))
    throw Error('Open a logged-in https://www.cellartracker.com/ tab first.');
  return tab.id;
}

async function relocate(tabId: number, row: Bottle): Promise<{ status: number }>
{
  // MAIN world shares the page origin and its browser-managed cookies. No cookie access is requested.
  const results = await chrome.scripting.executeScript(
    {
      target: { tabId },
      world: 'MAIN',
      args: [row],
      func: async ({ id, bin }: Bottle) =>
      {
        const url = new URL('/relocate.asp', location.origin);
        url.searchParams.set('SetLocation', '(use current)');
        url.searchParams.set('SetBin', bin);
        const response = await fetch(
          url,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: new URLSearchParams({ BulkAction: '', iInventory: id })
          });
        const body = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          redirected: response.redirected,
          url: response.url,
          login: /<form[^>]*(login|signin)|name=["']?(password|PW)/i.test(body),
          snippet: body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 180)
        };
      }
    });
  const result = results[0]?.result as { ok: boolean; status: number; redirected: boolean; login: boolean; url: string; snippet: string } | undefined;
  if (!result || !result.ok || result.redirected || result.login || !new URL(result.url).pathname.endsWith('/relocate.asp'))
    throw Error(`Unexpected response (HTTP ${result?.status ?? '?'}): ${result?.snippet ?? 'no result'}`);
  return result;
}

async function run(onlyFirst: boolean): Promise<void>
{
  if (running)
    return;
  running = true;
  ($('test') as HTMLButtonElement).disabled = ($('all') as HTMLButtonElement).disabled = true;
  $('error').textContent = '';
  try
  {
    const tabId = await activeTab();
    const pending = rows.filter(row => !completed.has(row.id));
    if (!onlyFirst && !confirm(`Submit ${pending.length} relocations? This changes your CellarTracker inventory.`))
      return;
    for (const row of (onlyFirst ? pending.slice(0, 1) : pending))
    {
      const result = await relocate(tabId, row);
      completed.add(row.id);
      log(`${completed.size}/${rows.length}: ${row.id} → ${row.bin} (HTTP ${result.status})`);
      $('status').textContent = `${completed.size} submitted; verify the first bottle in CellarTracker before continuing.`;
      if (!onlyFirst)
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (onlyFirst)
      ($('all') as HTMLButtonElement).disabled = completed.size === rows.length;
    if (completed.size === rows.length)
      $('status').textContent = `All ${rows.length} requests submitted. Verify locations in CellarTracker.`;
  }
  catch (e)
  {
    const message = e instanceof Error ? e.message : String(e);
    $('error').textContent = `Stopped: ${message}`;
    log(`STOPPED: ${message}`);
  }
  finally
  {
    running = false;
    ($('test') as HTMLButtonElement).disabled = completed.size > 0 || !rows.length;
  }
}

$('test').addEventListener('click', () => run(true));
$('all').addEventListener('click', () => run(false));

// Single relocate: use the provided InventoryId and Bin to perform one relocate
$('single').addEventListener('click', async () => {
  if (running) return;
  running = true;
  ($('test') as HTMLButtonElement).disabled = true;
  ($('all') as HTMLButtonElement).disabled = true;
  ($('single') as HTMLButtonElement).disabled = true;
  $('error').textContent = '';
  try {
    const id = ((document.getElementById('singleId') as HTMLInputElement).value || '').trim();
    const bin = ((document.getElementById('singleBin') as HTMLInputElement).value || '').trim();
    if (!/^\d+$/.test(id)) throw Error('Inventory ID must be numeric');
    if (!/^[A-Za-z0-9 _.\-]{1,40}$/.test(bin)) throw Error('Bin must be 1–40 letters/numbers/spaces/_.-');
    const tabId = await activeTab();
    const result = await relocate(tabId, { id, bin });
    completed.add(id);
    log(`${completed.size}/${rows.length || 1}: ${id} → ${bin} (HTTP ${result.status})`);
    $('status').textContent = `Relocated ${id} → ${bin}.`;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    $('error').textContent = `Stopped: ${message}`;
    log(`STOPPED: ${message}`);
  } finally {
    running = false;
    ($('test') as HTMLButtonElement).disabled = completed.size > 0 || !rows.length;
    ($('single') as HTMLButtonElement).disabled = false;
  }
});
