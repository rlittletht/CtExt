'use strict';

(() =>
{

  const chrome = (globalThis as any).chrome;

const $ = (id: string): HTMLElement => document.getElementById(id)!;
type DrinkEntry = { id: string; iWine: string; date: string; note: string };
let running = false;
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

$('back').addEventListener('click', () =>
{
  location.href = chrome.runtime.getURL('popup.html');
});

async function activeTab()
{
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/www\.cellartracker\.com\//.test(tab.url || ''))
    throw Error('Open a logged-in https://www.cellartracker.com/ tab first.');
  return tab.id;
}

async function drinkExecute(tabId: number, entry: DrinkEntry): Promise<{ status: number }>
{
  const results = await chrome.scripting.executeScript(
    {
      target: { tabId },
      world: 'MAIN',
      args: [entry],
      func: async ({ id, iWine, date, note }: DrinkEntry) =>
      {
        const url = new URL('/barcode.asp', location.origin);
        const response = await fetch(
          url,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: new URLSearchParams(
              {
                iWine,
                Choice: 'dbDrink',
                ConsumptionType: '1',
                iInventory: id,
                ConsumptionNote: note,
                DrinkDate: date,
                RevenueCurrency: 'USD',
                Revenue: '',
                AddNote: '0',
                LikeIt: '-1',
                Rating: '',
                TastingNotes: '',
                FoodTags: '',
                BeginConsume: '',
                EndConsume: '',
                AllowComments: '1'
              })
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
  if (!result || !result.ok || result.redirected || result.login || !new URL(result.url).pathname.endsWith('/barcode.asp'))
    throw Error(`Unexpected response (HTTP ${result?.status ?? '?'}): ${result?.snippet ?? 'no result'}`);
  return result;
}

$('drink').addEventListener(
  'click',
  async () =>
  {
    if (running)
      return;
    const text = ((document.getElementById('drinkCsv') as HTMLTextAreaElement).value || '').trim();
    if (!text)
    {
      $('error').textContent = 'No drink entries provided.';
      return;
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line);
    const entries: DrinkEntry[] = lines.map(
      (line, i) =>
      {
        const values = parseCsvLine(line);
        const id = (values[0] || '').trim();
        const iWine = (values[1] || '').trim();
        const date = (values[2] || '').trim();
        const note = (values[3] || '').trim();
        if (!/^\d+$/.test(id))
          throw Error(`Line ${i + 1}: invalid scancode: ${id}`);
        if (!/^\d+$/.test(iWine))
          throw Error(`Line ${i + 1}: invalid iWine: ${iWine}`);
        if (!date)
          throw Error(`Line ${i + 1}: drink date is required.`);
        return { id, iWine, date, note };
      });
    if (!confirm(`Submit ${entries.length} drink entries? This will record consumption on CellarTracker.`))
      return;
    running = true;
    ($('drink') as HTMLButtonElement).disabled = true;
    $('error').textContent = '';
    $('status').textContent = '';
    $('log').textContent = '';
    try
    {
      const tabId = await activeTab();
      let done = 0;
      for (const entry of entries)
      {
        const result = await drinkExecute(tabId, entry);
        done++;
        log(`DRINK ${done}/${entries.length}: ${entry.id} → ${entry.date} (${entry.note || 'no note'}) (HTTP ${result.status})`);
        $('status').textContent = `${done} drink entries submitted.`;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
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
      ($('drink') as HTMLButtonElement).disabled = false;
    }
  });

})();
