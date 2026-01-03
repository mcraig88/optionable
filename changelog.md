# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-01-03

### Added
- Robinhood CSV import support with robust parsing of quoted CSV fields and embedded newlines. ✅
- `parseInstrument` improved to prioritize `$` strike extraction and explicit expiry detection (mm/dd/yyyy, mm/dd/yy, yyyy-mm-dd). ✅
- Strict STO → BTC roll detection based on normalized description, date ordering, and matching strike/expiry when present. ✅
- Import preview modal with inline editable rows and POST to `/api/trades/import`. ✅
- Preserve `description` (Activity Description) and `trans` (Transaction Code) on Robinhood-parsed trades; include them in import payloads and use them as matching identifiers for conservative upserts. ✅
- `exportToCSV` renamed to `exportTradesToCSV`. ✅
- Unit tests (Vitest) for parser and roll detection added under `test/`. ✅
- "Clear Database" action: **Clear Database** button with confirmation modal that issues `DELETE /api/trades`, reports the number of deleted records, and refreshes the UI. ✅

### Changed
- Extracted parsing logic to `src/lib/robinhoodParser.js` for better testability and reuse. ✅

### Fixed
- Clear Database now works: added `DELETE /api/trades` backend endpoint that deletes all trades and returns `{ deleted: N }`. ✅

### Notes
- Sample CSV download added to the UI for quick examples (Robinhood and generic formats).
- Consider adding more unit tests to cover edge cases and variations in real-world Robinhood CSV files.