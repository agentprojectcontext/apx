// A small records app: entries in the artifact's database, the open view in its state.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const APX = window.APX;

async function ready() {
  if (!APX.db.available) return false;
  await APX.db.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
  await APX.db.exec(
    "CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, title TEXT NOT NULL, amount REAL NOT NULL, created_at TEXT DEFAULT (datetime('now')))",
  );
  await APX.db.exec("INSERT OR IGNORE INTO meta (k, v) VALUES ('schema', '1')");
  return true;
}

function App() {
  const [db, setDb] = useState(null);
  const [rows, setRows] = useState([]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");

  const load = async () => setRows(await APX.db.query("SELECT * FROM entries ORDER BY created_at DESC LIMIT 200"));
  useEffect(() => {
    ready().then((ok) => {
      setDb(ok);
      if (ok) load();
    });
  }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim() || !Number.isFinite(Number(amount))) return;
    await APX.db.exec("INSERT INTO entries (title, amount) VALUES (?, ?)", [title.trim(), Number(amount)]);
    setTitle("");
    setAmount("");
    load();
  };

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <div class="ax-app">
      <div class="ax-shell">
        <header class="ax-topbar">
          <div class="ax-topbar__title">
            Expenses <small>{rows.length} entries</small>
          </div>
        </header>
        <main class="ax-main">
          <div class="ax-main__inner ax-stack">
            {db === false && <div class="ax-empty">Records are kept only inside APX.</div>}
            {db && (
              <>
                <form class="ax-toolbar" onSubmit={add}>
                  <label class="ax-field ax-grow">
                    <span>Title</span>
                    <input class="ax-input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
                  </label>
                  <label class="ax-field">
                    <span>Amount</span>
                    <input
                      class="ax-input"
                      inputMode="decimal"
                      value={amount}
                      onInput={(e) => setAmount(e.currentTarget.value)}
                    />
                  </label>
                  <button class="ax-btn ax-btn--primary" type="submit">
                    Add
                  </button>
                </form>
                <div class="ax-card ax-stat">
                  <div class="ax-stat__label">Total</div>
                  <div class="ax-stat__value ax-num">{total.toFixed(2)}</div>
                </div>
                <table class="ax-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th class="r">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.title}</td>
                        <td class="r">{r.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <div class="ax-empty">No entries yet</div>}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

render(<App />, document.getElementById("root"));
