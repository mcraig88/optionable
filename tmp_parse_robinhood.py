import csv
import re
from datetime import datetime

path = '/Users/mcraig/Downloads/robinhood/Individual-a64d70b9-5c97-5ef7-a021-3bf8fed56c8d.csv'

def parse_date(s):
    s = s.strip()
    if not s:
        return None
    for fmt in ('%m/%d/%Y','%m/%d/%y','%Y-%m-%d'):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            pass
    try:
        # try generic
        return datetime.fromisoformat(s).date()
    except Exception:
        return None


def normalize_desc(s):
    return re.sub(r"\s+", " ", (s or '').strip().lower())


def parse_instrument(instr, desc):
    s = (instr or '').strip()
    if not s:
        s = desc or ''
    s = re.sub(r"\s+", " ", s)
    ticker = ''
    strike = None
    type_ = None
    expiry = None

    # Prefer $NN(.NN) for strike
    m = re.search(r"\$\s*([0-9]+(?:\.[0-9]+)?)", s)
    if m:
        strike = float(m.group(1))
    else:
        # fallback: number immediately before Put/Call
        m2 = re.search(r"(\d+(?:\.\d+)?)\s+(?=Put|Call|P\b|C\b)", s, re.I)
        if m2:
            strike = float(m2.group(1))

    # Expiry detection
    exp_m = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4})", s) or re.search(r"(\d{4}-\d{2}-\d{2})", s)
    if exp_m:
        d = parse_date(exp_m.group(1))
        if d:
            expiry = d.isoformat()

    # Type
    type_m = re.search(r"\b(put|call|p|c)\b", s, re.I)
    if type_m:
        type_ = 'Put' if re.search(r"put", type_m.group(1), re.I) or re.search(r"^p$", type_m.group(1), re.I) else 'Call'

    # Ticker: prefer leading token if alphabetic, else first alpha token that's not a common word
    parts = s.split(' ')
    if parts:
        if re.match(r'^([A-Za-z\.]{1,6})$', parts[0]):
            ticker = parts[0].upper()
    if not ticker:
        for t in parts:
            if re.match(r'^[A-Za-z\.]{1,6}$', t) and not re.search(r"\b(put|call|sold|buy|to|close|option|expiration|cusip|for)\b", t, re.I):
                ticker = t.upper()
                break

    return {'ticker': ticker or '', 'strike': strike, 'type': type_, 'expiry': expiry}


def derive_price(amount, quantity):
    # amount like 116.97 or (223.02), quantity int
    if not amount:
        return 0.0
    a = amount.replace('(', '').replace(')', '').replace('$','').replace(',','')
    try:
        amt = float(a)
    except Exception:
        return 0.0
    qty = abs(int(quantity)) if quantity and quantity.strip()!='' else 1
    price = abs(amt) / (qty * 100.0)
    return price

# Read CSV
with open(path, newline='') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

print('Total rows:', len(rows))

# find keys
keys = [k for k in rows[0].keys()]
print('Headers:', keys)

# canonicalize
canonical = []
for r in rows:
    if not r:
        continue
    # Defensive: keys may be missing for some malformed rows
    canonical.append({
        'activityDate': (r.get('Activity Date') or '').strip(),
        'description': (r.get('Description') or '').strip(),
        'amount': (r.get('Amount') or '').strip(),
        'quantity': (r.get('Quantity') or '').strip(),
        'instrument': (r.get('Instrument') or '').strip(),
        'trans': (r.get('Trans Code') or '').strip(),
        'process_date': (r.get('Process Date') or '').strip(),
        'settle_date': (r.get('Settle Date') or '').strip(),
        'raw': r
    })

# Filter out rows that are Process/Settle? The sample has Process Date/Settle Date columns but their presence doesn't mean row should be ignored.
# We'll ignore rows without a trans code or without description containing 'Put'/'Call' for options when looking for STO/BTC.

filtered = canonical
print('Filtered rows (non-empty):', len(filtered))

sto_rows = [r for r in filtered if (r['trans'].upper()=='STO') and re.search(r'put', r['description'], re.I)]
btc_rows = [r for r in filtered if r['trans'].upper()=='BTC']

print('STO rows:', len(sto_rows), 'BTC rows:', len(btc_rows))

trades = []
for sto in sto_rows:
    parsed = parse_instrument(sto['description'] or sto['instrument'], sto['description'])
    qty = abs(int(sto['quantity'])) if sto['quantity'] else 1
    entry = derive_price(sto['amount'], sto['quantity'])
    ticker = parsed['ticker'] or (sto['instrument'] or '').split(' ')[0]
    strike = parsed['strike']
    expiry = parsed['expiry']
    openedDate = sto['activityDate']
    trade = {
        'ticker': (ticker or '').upper(),
        'type':'CSP',
        'strike': strike,
        'quantity': qty,
        'entryPrice': entry,
        'closePrice': 0.0,
        'openedDate': openedDate,
        'expirationDate': expiry,
        'closedDate': None,
        'status': 'Open',
        '_desc': sto['description']
    }
    # detect strict roll
    norm = normalize_desc(sto['description'])
    sto_date = parse_date(sto['activityDate'])
    candidate = None
    for btc in btc_rows:
        if normalize_desc(btc['description']) != norm:
            continue
        btc_date = parse_date(btc['activityDate'])
        if not btc_date or not sto_date:
            continue
        if btc_date < sto_date:
            continue
        btc_parsed = parse_instrument(btc['instrument'] or btc['description'], btc['description'])
        if strike and btc_parsed['strike'] and abs(float(strike) - float(btc_parsed['strike'])) > 1e-6:
            continue
        if expiry and btc_parsed['expiry'] and expiry != btc_parsed['expiry']:
            continue
        candidate = btc
        break
    if candidate:
        trade['status'] = 'Rolled'
        trade['closedDate'] = candidate['activityDate']
        trade['closePrice'] = derive_price(candidate['amount'], candidate['quantity'])
    trades.append(trade)

print('Derived trades:', len(trades))
print('Sample trades (first 10):')
for t in trades[:10]:
    print(t)

rolled = [t for t in trades if t['status']=='Rolled']
print('Rolled count:', len(rolled))
if rolled:
    print('Rolled examples:')
    for r in rolled[:5]:
        print(r)

missing_ticker = [t for t in trades if not t['ticker']]
print('Trades missing ticker:', len(missing_ticker))
if missing_ticker:
    print('Examples missing ticker:', missing_ticker[:3])

print('Done')
