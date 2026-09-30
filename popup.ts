'use strict';

(() =>
{

  const chrome = (globalThis as any).chrome;

document.getElementById('openRelocate')!.addEventListener('click', () =>
{
  location.href = chrome.runtime.getURL('relocate.html');
});

document.getElementById('openDrink')!.addEventListener('click', () =>
{
  location.href = chrome.runtime.getURL('drink.html');
});

})();
