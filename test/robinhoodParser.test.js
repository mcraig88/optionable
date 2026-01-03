import { describe, it, expect } from 'vitest';
import { parseInstrument, parseRobinhoodRows, derivePrice, parseCSV } from '../src/lib/robinhoodParser.js';

describe('parseInstrument', () => {
    it('parses strike, expiry, ticker and type from description with $ strike', () => {
        const s = 'IREN 1/16/2026 Put $37.00';
        const parsed = parseInstrument(s);
        expect(parsed.ticker).toBe('IREN');
        expect(parsed.strike).toBe(37);
        expect(parsed.expiry).toBe('2026-01-16');
        expect(parsed.type).toBe('Put');
    });

    it('parses strike and expiry from various formats', () => {
        expect(parseInstrument('OKLO 12/12/2025 Put $100.00').strike).toBe(100);
        expect(parseInstrument('SOFI 1/16/26 Put $25.00').expiry).toBe('2026-01-16');
    });
});

describe('derivePrice', () => {
    it('derives price from amount and quantity', () => {
        const price = derivePrice({ amount: '$116.97', quantity: '1' });
        expect(Number(price.toFixed(4))).toBeCloseTo(1.1697, 4);
        const p2 = derivePrice({ amount: '($223.02)', quantity: '1' });
        expect(Number(p2.toFixed(4))).toBeCloseTo(2.2302, 4);
    });
});

describe('parseRobinhoodRows', () => {
    it('detects pitched STO and matches BTC rolls strictly', () => {
        const rows = [
            { 'Activity Date': '12/24/2025', 'Description': 'CRWV 1/2/2026 Put $76.00', 'Amount': '$199.97', 'Quantity': '1', 'Instrument': 'CRWV 1/2/2026 Put $76.00', 'Trans Code': 'STO' },
            { 'Activity Date': '12/31/2025', 'Description': 'CRWV 1/2/2026 Put $76.00', 'Amount': '($395.02)', 'Quantity': '1', 'Instrument': 'CRWV 1/2/2026 Put $76.00', 'Trans Code': 'BTC' }
        ];
        const trades = parseRobinhoodRows(rows);
        expect(trades.length).toBe(1);
        expect(trades[0].status).toBe('Rolled');
        expect(trades[0].strike).toBe(76);
        expect(trades[0].closedDate).toBe('12/31/2025');
    });

    it('parses CSV text into rows with parseCSV then processes them', () => {
        const csv = '"Activity Date","Description","Amount","Quantity","Instrument","Trans Code"\n"1/2/2026","Sold 1 Put AAPL 01/17/2026 145 Put","-50.00","1","AAPL 01/17/2026 145 Put","STO"';
        const rows = parseCSV(csv);
        const trades = parseRobinhoodRows(rows);
        expect(trades.length).toBe(1);
    });
});