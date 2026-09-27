# CellarTracker Bin Loader (starter)

1. In Edge, open `edge://extensions`, enable Developer mode, select **Load unpacked**, and choose this directory.
2. Sign into `https://www.cellartracker.com/` and leave that tab active.
3. Open the extension popup and select a UTF-8 CSV:

```csv
InventoryId,Bin
223831307,00030011
223831308,00030011
```

The ID must be the individual bottle's `iInventory` value, **not** the wine ID or a UPC. Keep leading zeros in Bin. Each inventory ID must appear once; by default each bin must have exactly two rows.

Review the summary and select **Update first bottle only**. Check that bottle's bin on CellarTracker before selecting **Update remaining bottles**. Keep the popup open and the CellarTracker tab active until it finishes. The popup tracks completed requests only in memory; closing it loses that progress. If interrupted, verify the submitted entries and make a CSV containing only the remaining bottles. The log reports accepted HTTP responses, not independently verified final inventory state.

This uses the observed, undocumented `relocate.asp` request and preserves each bottle's current Location. The site may change its request or response behavior. No cookies are extracted or stored. Do not place browser cookies or passwords in the CSV or extension files.

## TypeScript development

`popup.ts` is the source. `popup.js` is the compiled file loaded by Edge. 

Run `npm install` followed by `npm run build` after editing the TypeScript. This will create a dist directory where the unpacked extension can be loaded from.

