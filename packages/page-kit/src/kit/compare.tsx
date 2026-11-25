import { objectItems } from "./items.js";
import { useWords } from "./labels.js";
import { imageSource, Picture, text } from "./media.js";

type CompareItem = { title?: string; image?: string; alt?: string; note?: string };
type CompareRow = { label?: string; values?: unknown[]; best?: number | number[] };

const MAX_ITEMS = 4;

/**
 * Two to four things side by side. Each column is headed by its photo and name, then every spec
 * is a small label over one value per column. The best value of a row can be marked. The label
 * sits above its values, not in a column of its own, so four columns still fit a phone.
 */
export function Compare({ items, rows }: { items?: CompareItem[]; rows?: CompareRow[] }) {
  const words = useWords();
  const columns = objectItems(items)
    .filter((item) => text(item.title))
    .slice(0, MAX_ITEMS);
  if (columns.length === 0) return null;
  const specs = objectItems(rows).filter((row) => text(row.label));
  return (
    <div className="rk-compare-wrap">
      <table className="rk-compare" data-columns={columns.length}>
        <thead>
          <tr>
            {columns.map((item, index) => {
              const src = imageSource(item.image);
              const note = text(item.note);
              return (
                <th scope="col" key={index}>
                  {src ? (
                    <div className="rk-compare-photo">
                      <Picture source={src} alt={text(item.alt) || text(item.title)} />
                    </div>
                  ) : null}
                  <span className="rk-compare-name">{text(item.title)}</span>
                  {note ? <span className="rk-compare-note">{note}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        {specs.map((row, rowIndex) => {
          const best = new Set(Array.isArray(row.best) ? row.best : [row.best]);
          const values = Array.isArray(row.values) ? row.values : [];
          return (
            <tbody key={rowIndex}>
              <tr>
                <th className="rk-compare-label" scope="rowgroup" colSpan={columns.length}>
                  {text(row.label)}
                </th>
              </tr>
              <tr>
                {columns.map((_, index) => {
                  const value = text(values[index]);
                  const isBest = value !== "" && best.has(index);
                  return (
                    <td key={index} data-best={isBest || undefined}>
                      {value || "–"}
                      {isBest ? (
                        <span className="rk-visually-hidden">{`, ${words.t("bestValue")}`}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export const COMPARE_CSS = `
.rk-compare-wrap{min-width:0;margin:0 -6px}
.rk-compare{width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px;line-height:20px}
.rk-compare th,.rk-compare td{padding:0;text-align:start;vertical-align:top;font-weight:400;overflow-wrap:anywhere}
.rk-compare thead th{padding:0 6px 12px;font-weight:600}
.rk-compare td{padding:0 6px 12px}
.rk-compare-photo{margin-bottom:8px}
.rk-compare-photo .rk-picture{aspect-ratio:1/1;width:100%;border-radius:14px}
.rk-compare-name{display:block;font-size:15px;line-height:20px;font-weight:600}
.rk-compare-note{display:block;margin-top:2px;font-size:13px;line-height:18px;font-weight:400;color:var(--rk-secondary)}
.rk-compare th.rk-compare-label{padding:12px 6px 4px;background:linear-gradient(var(--rk-hairline),var(--rk-hairline)) 6px 0/calc(100% - 12px) 1px no-repeat;font-size:12px;line-height:16px;color:var(--rk-secondary)}
.rk-compare td[data-best]{font-weight:600;color:var(--rk-success)}
@media print{.rk-compare tbody{break-inside:avoid}}
`;
