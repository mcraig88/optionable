const fs = require('fs');
const path = '/Users/mcraig/Downloads/robinhood/Individual-a64d70b9-5c97-5ef7-a021-3bf8fed56c8d.csv';
const text = fs.readFileSync(path, 'utf8');

// parseCSV from App.jsx
const parseCSV = (text) => {
    const rows = [];
    let cur = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"') {
            if (inQuotes && next === '"') { // escaped quote
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            row.push(cur);
            cur = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (cur !== '' || row.length > 0) {
                row.push(cur);
                rows.push(row);
                row = [];
                cur = '';
            }
            if (ch === '\r' && next === '\n') i++;
        } else {
            cur += ch;
        }
    }
    if (cur !== '' || row.length > 0) {
        row.push(cur);
        rows.push(row);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
        const obj = {};
        for (let i = 0; i < headers.length; i++) {
            obj[headers[i]] = (r[i] || '').trim();
        }
        return obj;
    });
};

const normalizeDesc = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const parseInstrument = (instrument) => {
    if (!instrument) return {};
    const res = { ticker: '', strike: null, type: '', expiry: '' };
    const parts = instrument.replace(/\s+/g, ' ').trim().split(' ');
    if (parts.length > 0 && /^[A-Za-z\.]{1,6}$/.test(parts[0])) {
        res.ticker = parts[0].toUpperCase();
    }
    const strikePart = parts.find(p => /^\d+(?:\.\d+)?$/.test(p.replace(/[^0-9.]/g, '')));
    if (strikePart) res.strike = Number(strikePart.replace(/[^0-9.]/g, ''));
    const typePart = parts.find(p => /put|call|p|c/i.test(p));
    if (typePart) res.type = /put/i.test(typePart) || /^p$/i.test(typePart) ? 'Put' : 'Call';
    const expiryPart = parts.find(p => /\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/.test(p) || /\d{4}-\d{2}-\d{2}/.test(p));
    if (expiryPart) {
        const m = expiryPart.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
        if (m) {
            let [_, mm, dd, yy] = m;
            if (yy.length === 2) yy = '20' + yy;
            res.expiry = `${yy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        } else {
            const n = expiryPart.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (n) res.expiry = `${n[1]}-${n[2]}-${n[3]}`;
        }
    }
    return res;
};

const parseRobinhoodRows = (rows) => {
    const sample = rows[0] || {};
    const keys = Object.keys(sample);
    const k = (nameCandidates) => keys.find(h => nameCandidates.some(n => h.toLowerCase().includes(n)));

    const dateKey = k(['activity date', 'activitydate', 'date']);
    const descKey = k(['description', 'desc']);
    const amountKey = k(['amount', 'net amount', 'price']);
    const qtyKey = k(['quantity', 'qty']);
    const instrKey = k(['instrument', 'symbol', 'instrument symbol']);
    const transKey = k(['trans code', 'transcode', 'transaction', 'activity type', 'action']);
    const processKey = k(['process', 'settle', 'process/settle']);

    const canonicalRows = rows.map(r => ({
        activityDate: r[dateKey] || r[dateKey?.toLowerCase()] || '',
        description: r[descKey] || '',
        amount: (r[amountKey] || '').replace(/[^0-9\.-]/g, ''),
        quantity: (r[qtyKey] || '').replace(/[^0-9\.-]/g, ''),
        instrument: r[instrKey] || '',
        trans: r[transKey] || '',
        process: r[processKey] || '',
        raw: r,
    }));

    const filtered = canonicalRows.filter(rr => {
        const p = (rr.process || '').toLowerCase();
        return !(p.includes('process') || p.includes('settle'));
    });

    const stoRows = filtered.filter(rr => (rr.trans || '').toUpperCase() === 'STO' && /put/i.test(rr.description));
    const btcRows = filtered.filter(rr => (rr.trans || '').toUpperCase() === 'BTC');

    const trades = [];

    const derivePrice = (row) => {
        const amt = Number(row.amount) || 0;
        const qty = Math.abs(Number(row.quantity)) || 1;
        const price = Math.abs(amt) / (qty * 100) || 0;
        return price;
    };

    stoRows.forEach(sto => {
        const parsed = parseInstrument(sto.instrument || sto.description);
        const qty = Math.abs(Number(sto.quantity)) || 1;
        const entry = derivePrice(sto);
        const ticker = parsed.ticker || (sto.instrument || '').split(' ')[0] || '';
        const strike = parsed.strike || null;
        const expiry = parsed.expiry || '';
        const openedDate = sto.activityDate;

        const trade = {
            ticker: ticker.toUpperCase(),
            type: 'CSP',
            strike: strike,
            quantity: qty,
            entryPrice: entry,
            closePrice: 0,
            openedDate,
            expirationDate: expiry,
            closedDate: null,
            status: 'Open',
            _desc: sto.description,
        };

        const norm = normalizeDesc(sto.description);
        const candidate = btcRows.find(btc => {
            if (normalizeDesc(btc.description) !== norm) return false;
            const stoDate = new Date(openedDate);
            const btcDate = new Date(btc.activityDate);
            if (isNaN(stoDate) || isNaN(btcDate)) return false;
            if (btcDate < stoDate) return false;
            const btcParsed = parseInstrument(btc.instrument || btc.description);
            if (strike && btcParsed.strike && Number(strike) !== Number(btcParsed.strike)) return false;
            if (expiry && btcParsed.expiry && expiry !== btcParsed.expiry) return false;
            return true;
        });

        if (candidate) {
            trade.status = 'Rolled';
            trade.closedDate = candidate.activityDate;
            trade.closePrice = derivePrice(candidate);
        }

        trades.push(trade);
    });

    return { trades, counts: { sto: stoRows.length, btc: btcRows.length, total: filtered.length } };
};

const rows = parseCSV(text);
console.log('Parsed rows:', rows.length);
const { trades, counts } = parseRobinhoodRows(rows);
console.log('Filtered rows (non-process/settle):', counts.total, 'STO:', counts.sto, 'BTC:', counts.btc);
console.log('Trades derived:', trades.length);
console.log('First 10 trades (JSON):\n', JSON.stringify(trades.slice(0, 10), null, 2));

// Show rolled trades
const rolled = trades.filter(t => t.status === 'Rolled');
console.log('Rolled trades count:', rolled.length);
if (rolled.length) console.log('Rolled sample:\n', JSON.stringify(rolled.slice(0,3), null, 2));

// Check for parsing issues
const missingTicker = trades.filter(t => !t.ticker);
console.log('Trades missing ticker:', missingTicker.length);
if (missingTicker.length) console.log(JSON.stringify(missingTicker.slice(0,3), null, 2));

console.log('Done.');
