// Robinhood CSV parsing helpers (extracted from App.jsx)
export const normalizeDesc = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export const parseCSV = (text) => {
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

export const parseInstrument = (instrument) => {
    if (!instrument) return { ticker: '', strike: null, type: '', expiry: '' };
    const s = instrument.replace(/\s+/g, ' ').trim();
    const res = { ticker: '', strike: null, type: '', expiry: '' };

    const dollarStrike = s.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if (dollarStrike) {
        res.strike = Number(dollarStrike[1]);
    } else {
        const beforeType = s.match(/(\d+(?:\.\d+)?)\s+(?=Put|Call|P\b|C\b)/i);
        if (beforeType) res.strike = Number(beforeType[1]);
    }

    const expMatch = s.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/) || s.match(/(\d{4}-\d{2}-\d{2})/);
    if (expMatch) {
        const p = expMatch[1];
        const m = p.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) {
            let [, mm, dd, yy] = m;
            if (yy.length === 2) yy = '20' + yy;
            res.expiry = `${yy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        } else {
            const n = p.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (n) res.expiry = `${n[1]}-${n[2]}-${n[3]}`;
        }
    }

    const typeMatch = s.match(/\b(put|call|p|c)\b/i);
    if (typeMatch) res.type = /put/i.test(typeMatch[1]) || /^p$/i.test(typeMatch[1]) ? 'Put' : 'Call';

    const firstToken = s.split(' ')[0];
    if (/^[A-Za-z\.]{1,6}$/.test(firstToken)) res.ticker = firstToken.toUpperCase();
    if (!res.ticker) {
        const tokens = s.split(' ');
        for (const t of tokens) {
            if (/^[A-Za-z\.]{1,6}$/.test(t) && !/\b(put|call|sold|buy|to|close|option|expiration|cusip|for|price)\b/i.test(t)) {
                res.ticker = t.toUpperCase();
                break;
            }
        }
    }

    return res;
};

export const derivePrice = (row) => {
    const amt = Number((row.amount || '').replace(/[^0-9\.-]/g, '')) || 0;
    const qty = Math.abs(Number(row.quantity)) || 1;
    const absAmt = Math.abs(amt);

    // Heuristic: if the amount is small (e.g., $0.22) treat it as a per-share price already.
    // Otherwise assume it's the total dollars for the contract(s) and divide by (qty * 100).
    if (absAmt > 0 && absAmt < 10) {
        return absAmt;
    }

    const price = absAmt / (qty * 100) || 0;
    return price;
};

export const detectFormat = (headers) => {
    const lower = headers.map(h => h.toLowerCase());
    if (lower.includes('activity date') || lower.includes('activitydate') || lower.includes('instrument')) return 'Robinhood';
    if (lower.includes('ticker') || lower.includes('type')) return 'Optional';
    return 'Optional';
};

export const parseRobinhoodRows = (rows) => {
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

    stoRows.forEach(sto => {
        const parsed = parseInstrument(sto.description || sto.instrument);
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
            // Preserve original descriptor and transaction code for matching/upserts
            description: sto.description || '',
            trans: sto.trans || '',
        };

        const norm = normalizeDesc(sto.description);
        const candidate = btcRows.find(btc => {
            if (normalizeDesc(btc.description) !== norm) return false;
            const stoDate = new Date(openedDate);
            const btcDate = new Date(btc.activityDate);
            if (isNaN(stoDate) || isNaN(btcDate)) return false;
            if (btcDate < stoDate) return false;
            const btcParsed = parseInstrument(btc.description || btc.instrument);
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

    return trades;
};