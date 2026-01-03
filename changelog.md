# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-01-03

### Added
- Robinhood CSV import support with robust parsing of quoted CSV fields and embedded newlines. ✅
- `parseInstrument` improved to prioritize `$` strike extraction and explicit expiry detection (mm/dd/yyyy, mm/dd/yy, yyyy-mm-dd). ✅
- Strict STO → BTC roll detection based on normalized description, date ordering, and matching strike/expiry when present. ✅
- Import preview modal with inline editable rows and POST to `/api/trades/import`. ✅
- `exportToCSV` renamed to `exportTradesToCSV`. ✅
- Unit tests (Vitest) for parser and roll detection added under `test/`. ✅

### Changed
- Extracted parsing logic to `src/lib/robinhoodParser.js` for better testability and reuse. ✅

### Notes
- Sample CSV download added to the UI for quick examples (Robinhood and generic formats).
- Consider adding more unit tests to cover edge cases and variations in real-world Robinhood CSV files.